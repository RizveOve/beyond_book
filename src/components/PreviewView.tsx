import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { TARGETS } from '../content/targets';
import { HeartExperience, addLights } from '../three/HeartExperience';
import { attachGestures } from '../three/gestures';
import { HeartHUD } from './HeartHUD';

const TARGET = TARGETS[0];

/** Camera-free 3D viewer: handy on desktop or when no printed page is at hand. */
export function PreviewView({ onExit }: { onExit: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [heart] = useState(() => new HeartExperience(TARGET.parts));
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
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
    scene.add(heart.root);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(0, 0.05, 2.6);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h);
      labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      // Keep the whole heart in view on narrow (portrait) screens.
      camera.position.z = 2.6 / Math.min(1, (w / h) * 1.6);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    heart.setSelectListener(setSelected);
    const detach = attachGestures(renderer.domElement, {
      onTap: (ndc) => heart.pick(ndc, camera),
      onDrag: (dx, dy) => {
        heart.rotateBy(dx * 0.01);
        heart.tiltBy(dy * 0.008);
      },
      onPinch: (f) => heart.zoomBy(f),
    });

    const clock = new THREE.Clock();
    let cancelled = false;
    heart
      .load(TARGET.modelUrl, 1)
      .then(() => !cancelled && setLoading(false))
      .catch((e) => console.error(e));

    renderer.setAnimationLoop(() => {
      heart.update(clock.getDelta());
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    });

    return () => {
      cancelled = true;
      detach();
      window.removeEventListener('resize', resize);
      scene.remove(heart.root);
      renderer.setAnimationLoop(null);
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
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
        <span className="status">3D preview</span>
      </header>
      {loading ? (
        <div className="overlay">
          <div className="spinner" />
          <p>Loading the heart…</p>
        </div>
      ) : (
        <HeartHUD heart={heart} selected={selected} onClose={() => heart.select(null)} />
      )}
    </div>
  );
}
