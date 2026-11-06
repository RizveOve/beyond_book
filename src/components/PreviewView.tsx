import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TARGETS } from '../content/targets';
import { ModelExperience, addLights } from '../three/ModelExperience';
import { attachGestures } from '../three/gestures';
import { ModelHUD } from './ModelHUD';

/** Camera-free 3D viewer: handy on desktop or when no printed page is at hand. */
export function PreviewView({ targetIndex, onExit }: { targetIndex: number; onExit: () => void }) {
  const target = TARGETS[targetIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const [model] = useState(
    () =>
      new ModelExperience(target.parts, {
        heartbeat: target.heartbeat,
        surfaceParts: target.surfaceParts,
        explodeDistance: target.explodeDistance,
        explodeTurn: target.explodeTurn,
        ct: target.ct,
      }),
  );
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true; // CT cutaway
    container.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    Object.assign(labelRenderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    });
    container.appendChild(labelRenderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#16171a');
    addLights(scene);
    scene.add(model.root);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0, 0.05, 2.6);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      // Keep the whole model in view on narrow (portrait) screens.
      camera.position.z = 2.6 / Math.min(1, (w / h) * 1.6);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    model.setSelectListener(setSelected);
    const detach = attachGestures(renderer.domElement, {
      onTap: (ndc) => model.pick(ndc, camera),
      onDrag: (dx, dy) => {
        model.rotateBy(dx * 0.01);
        model.tiltBy(dy * 0.008);
      },
      onPinch: (f) => model.zoomBy(f),
    });

    const clock = new THREE.Clock();
    let cancelled = false;
    model
      .load(target.modelUrl, 1)
      .then(() => !cancelled && setLoading(false))
      .catch((e) => console.error(e));

    renderer.setAnimationLoop(() => {
      model.update(clock.getDelta());
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    });

    return () => {
      cancelled = true;
      detach();
      window.removeEventListener('resize', resize);
      scene.remove(model.root);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    };
  }, [model, target]);

  return (
    <div className="ar-root">
      <div ref={containerRef} className="ar-container" />
      <header className="topbar">
        <button className="icon-btn" onClick={onExit} aria-label="Back">
          ←
        </button>
        <span className="brand">
          BeyondBook <small className="chapter">{target.title}</small>
        </span>
        <span className="status">3D preview</span>
      </header>
      {loading ? (
        <div className="overlay">
          <div className="spinner" />
          <p>Loading {target.title.toLowerCase()}…</p>
        </div>
      ) : (
        <ModelHUD model={model} selected={selected} onClose={() => model.select(null)} />
      )}
    </div>
  );
}
