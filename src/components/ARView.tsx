import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MindARThree } from '../ar/MindARThree';
import {
  HEART_MODEL_URL,
  HeartExperience,
  addLights,
  createContactShadow,
} from '../three/HeartExperience';
import { attachGestures } from '../three/gestures';
import { HeartHUD } from './HeartHUD';

const TARGET_URL = `${import.meta.env.BASE_URL}targets/heart.mind`;

/** Heart size relative to the printed page width (page width == 1 unit). */
const HEART_SIZE = 0.78;
/** Centre of the drawn heart on the page, in page-width units from the page centre. */
const HEART_OFFSET = { x: 0.02, y: 0.03 };
/** How far the heart floats above the paper. */
const HEART_LIFT = 0.18;

type Status = 'starting' | 'scanning' | 'tracking' | 'error';

export function ARView({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [heart] = useState(() => new HeartExperience());
  const [status, setStatus] = useState<Status>('starting');
  const [error, setError] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const mindar = new MindARThree({
      container,
      imageTargetSrc: TARGET_URL,
      // Slightly smoother than MindAR's defaults to reduce jitter on a static page.
      filterMinCF: 0.0001,
      filterBeta: 0.001,
    });
    const { renderer, scene, camera } = mindar;
    addLights(scene);

    // Anchor space: origin at the page centre, x → right, y → up the page,
    // z → out of the page (towards the camera). The heart's front faces +z, so
    // it floats over the printed drawing showing the same anterior view, lifted
    // off the paper so tilting the phone reveals its depth.
    const anchor = mindar.addAnchor(0);
    const stage = new THREE.Group();
    stage.position.set(HEART_OFFSET.x, HEART_OFFSET.y, HEART_LIFT);
    stage.add(heart.root);
    anchor.group.add(stage);

    const shadow = createContactShadow(HEART_SIZE * 0.55);
    shadow.position.set(HEART_OFFSET.x, HEART_OFFSET.y - 0.03, 0.002);
    anchor.group.add(shadow);

    anchor.onTargetFound = () => setStatus('tracking');
    anchor.onTargetLost = () => setStatus('scanning');
    heart.setSelectListener(setSelected);

    const detachGestures = attachGestures(renderer.domElement, {
      onTap: (ndc) => anchor.visible && heart.pick(ndc, camera),
      onDrag: (dx) => heart.rotateBy(dx * 0.012),
      onPinch: (f) => heart.zoomBy(f),
    });

    const clock = new THREE.Clock();
    let cancelled = false;

    (async () => {
      try {
        await Promise.all([heart.load(HEART_MODEL_URL, HEART_SIZE), mindar.start()]);
        if (cancelled) return;
        setStatus('scanning');
        renderer.setAnimationLoop(() => {
          heart.update(clock.getDelta());
          renderer.render(scene, camera);
        });
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
      anchor.group.remove(stage);
      mindar.dispose();
    };
  }, [heart]);

  return (
    <div className="ar-root">
      <div ref={containerRef} className="ar-container" />

      <header className="topbar">
        <button className="icon-btn" onClick={onExit} aria-label="Back">
          ←
        </button>
        <span className="brand">BeyondBook</span>
        <span className={`status status--${status}`}>{statusLabel(status)}</span>
      </header>

      {status === 'starting' && (
        <div className="overlay">
          <div className="spinner" />
          <p>Starting camera & loading the heart…</p>
        </div>
      )}

      {status === 'scanning' && (
        <div className="overlay overlay--scan">
          <div className="scan-frame" />
          <p>Point your camera at the heart illustration on the page</p>
        </div>
      )}

      {status === 'error' && (
        <div className="overlay">
          <p className="error">{error}</p>
          <button onClick={onExit}>Go back</button>
        </div>
      )}

      {status === 'tracking' && (
        <HeartHUD heart={heart} selected={selected} onClose={() => heart.select(null)} />
      )}
    </div>
  );
}

function statusLabel(s: Status) {
  return { starting: 'Starting…', scanning: 'Searching', tracking: 'Locked on', error: 'Error' }[s];
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
