import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MindARThree, type Anchor } from '../ar/MindARThree';
import { TARGETS, TARGETS_MIND_URL } from '../content/targets';
import { ModelExperience, addLights, createContactShadow } from '../three/ModelExperience';
import { attachGestures } from '../three/gestures';
import { ModelHUD } from './ModelHUD';

/**
 * - `scanning`: no page seen yet.
 * - `tracking`: the model sits on the recognised page.
 * - `floating`: the page was lost; the model stays on screen in front of the
 *   camera (still fully interactive) until a page is recognised again.
 */
type Status = 'starting' | 'scanning' | 'tracking' | 'floating' | 'error';

export function ARView({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // One experience per target page, created lazily the first time it's seen.
  const [experiences] = useState(() => new Map<number, ModelExperience>());
  const [active, setActive] = useState<{ index: number; heart: ModelExperience } | null>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    let cancelled = false;
    const mindar = new MindARThree({
      container,
      imageTargetSrc: TARGETS_MIND_URL,
      // Slightly smoother than MindAR's defaults to reduce jitter on a static page.
      filterMinCF: 0.0001,
      filterBeta: 0.001,
    });
    const { renderer, scene, camera } = mindar;
    addLights(scene);

    // The model lives in `stage`, a free-standing group whose pose we steer each
    // frame: towards the page while it is tracked, or to a floating spot in
    // front of the camera when it isn't. (MindAR's camera sits at the origin, so
    // world space == camera space.)
    const stage = new THREE.Group();
    stage.visible = false;
    scene.add(stage);

    let current: { index: number; heart: ModelExperience } | null = null;
    let anchoredTo: Anchor | null = null;
    let switching = 0; // bumps on every target switch to drop stale async loads
    let gliding = true; // right after a mode change: glide instead of tight follow
    let glideTime = 0;
    let floatScale = 1;

    const getExperience = (index: number) => {
      let exp = experiences.get(index);
      if (!exp) {
        const t = TARGETS[index];
        exp = new ModelExperience(t.parts, {
          heartbeat: t.heartbeat,
          surfaceParts: t.surfaceParts,
          explodeDistance: t.explodeDistance,
          explodeTurn: t.explodeTurn,
          ct: t.ct,
        });
        experiences.set(index, exp);
      }
      return exp;
    };

    const tmpM = new THREE.Matrix4();
    const tPos = new THREE.Vector3();
    const tQuat = new THREE.Quaternion();
    const tScale = new THREE.Vector3();

    /** Page pose → where the model should sit on that page. */
    const anchorPose = (anchor: Anchor, index: number) => {
      const t = TARGETS[index];
      tmpM.makeTranslation(t.offset.x, t.offset.y, t.lift);
      tmpM.premultiply(anchor.group.matrix);
      tmpM.decompose(tPos, tQuat, tScale);
    };

    /** Floating pose: centred in view, facing the camera, sized to fit the screen. */
    const floatingPose = (exp: ModelExperience) => {
      const dims = exp.dimensions.multiplyScalar(floatScale * 1.15); // 15% margin
      const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const tanH = tanV * camera.aspect;
      const dist = Math.max(dims.y / 2 / tanV, dims.x / 2 / tanH) + dims.z / 2;
      tPos.set(0, dims.y * 0.06, -dist);
      tQuat.identity();
      tScale.setScalar(floatScale);
    };

    const startGlide = () => {
      gliding = true;
      glideTime = 0;
    };

    const anchors = TARGETS.map((target, index) => {
      const anchor = mindar.addAnchor(index);
      const shadow = createContactShadow(target.size * 0.55);
      shadow.position.set(target.offset.x, target.offset.y - 0.03, 0.002);
      anchor.group.add(shadow);

      anchor.onTargetFound = async () => {
        anchoredTo = anchor;
        startGlide();
        setStatus('tracking');
        if (current?.index === index) return;

        // A different page (or the first one): load and swap in its model.
        const ticket = ++switching;
        const exp = getExperience(index);
        await exp.load(target.modelUrl, target.size);
        if (ticket !== switching || cancelled) return;
        if (current) stage.remove(current.heart.root);
        current = { index, heart: exp };
        stage.add(exp.root);
        exp.setSelectListener(setSelected);
        setSelected(null);
        setActive(current);
        if (!stage.visible) {
          // First appearance: jump straight onto the page.
          anchorPose(anchor, index);
          stage.position.copy(tPos);
          stage.quaternion.copy(tQuat);
          stage.scale.copy(tScale);
          stage.visible = true;
        }
      };

      anchor.onTargetLost = () => {
        if (anchoredTo !== anchor) return;
        anchoredTo = null;
        startGlide();
        floatScale = stage.scale.x; // keep the on-page size while floating
        setStatus(current ? 'floating' : 'scanning');
      };
      return anchor;
    });

    const detachGestures = attachGestures(renderer.domElement, {
      onTap: (ndc) => {
        if (stage.visible && current) current.heart.pick(ndc, camera);
      },
      onDrag: (dx, dy) => {
        current?.heart.rotateBy(dx * 0.012);
        current?.heart.tiltBy(dy * 0.008);
      },
      onPinch: (f) => current?.heart.zoomBy(f),
    });

    const clock = new THREE.Clock();
    const tick = () => {
      const dt = Math.min(clock.getDelta(), 0.1);
      if (current && stage.visible) {
        if (anchoredTo) anchorPose(anchoredTo, current.index);
        else floatingPose(current.heart);

        // Glide for ~0.6s after a mode change, then follow the page tightly.
        if (gliding && (glideTime += dt) > 0.6) gliding = false;
        const k = 1 - Math.exp(-dt * (gliding ? 7 : 30));
        stage.position.lerp(tPos, k);
        stage.quaternion.slerp(tQuat, k);
        stage.scale.lerp(tScale, k);

        current.heart.update(dt);
      }
      mindar.render();
    };

    (async () => {
      try {
        // Preload every model in the background (finding a page awaits its own
        // model), so the camera starts without waiting for all downloads.
        TARGETS.forEach((t, i) => getExperience(i).load(t.modelUrl, t.size).catch(console.error));
        await mindar.start();
        if (cancelled) return;
        setStatus((s) => (s === 'starting' ? 'scanning' : s));
        renderer.setAnimationLoop(tick);
      } catch (e) {
        if (cancelled) return;
        console.error(e);
        setError(describeError(e));
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      detachGestures();
      anchors.forEach((a) => {
        a.onTargetFound = undefined;
        a.onTargetLost = undefined;
      });
      if (current) stage.remove(current.heart.root);
      mindar.dispose();
    };
  }, [experiences]);

  const showHud = active !== null && (status === 'tracking' || status === 'floating');

  return (
    <div className="ar-root">
      <div ref={containerRef} className="ar-container" />

      <header className="topbar">
        <button className="icon-btn" onClick={onExit} aria-label="Back">
          ←
        </button>
        <span className="brand">
          BeyondBook
          {active && <small className="chapter">{TARGETS[active.index].title}</small>}
        </span>
        <span className={`status status--${status}`}>{statusLabel(status)}</span>
      </header>

      {status === 'starting' && (
        <div className="overlay">
          <div className="spinner" />
          <p>Starting camera & loading models…</p>
        </div>
      )}

      {status === 'scanning' && (
        <div className="overlay overlay--scan">
          <div className="scan-frame" />
          <p>Point your camera at a BeyondBook page (heart or brain)</p>
        </div>
      )}

      {status === 'floating' && (
        <p className="banner">
          Page out of view: the model stays with you. Point at a page to place it back.
        </p>
      )}

      {status === 'error' && (
        <div className="overlay">
          <p className="error">{error}</p>
          <button onClick={onExit}>Go back</button>
        </div>
      )}

      {showHud && (
        <ModelHUD
          key={active.index}
          model={active.heart}
          selected={selected}
          onClose={() => active.heart.select(null)}
        />
      )}
    </div>
  );
}

function statusLabel(s: Status) {
  return {
    starting: 'Starting…',
    scanning: 'Searching',
    tracking: 'On page',
    floating: 'Free view',
    error: 'Error',
  }[s];
}

function describeError(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return 'Camera permission was denied. Allow camera access in your browser settings and try again.';
  }
  if (e instanceof DOMException && e.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  if (!window.isSecureContext) {
    return 'The camera needs a secure (HTTPS) connection. Open the https:// address shown by the dev server.';
  }
  return e instanceof Error ? e.message : 'Something went wrong starting AR.';
}
