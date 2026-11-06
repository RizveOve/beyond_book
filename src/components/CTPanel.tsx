import { useEffect, useRef, useState } from 'react';
import type { CTAxis } from '../three/CTScanner';
import { drawCT, type CTHit } from '../three/ctImage';
import type { ModelExperience } from '../three/ModelExperience';

const AXES: { id: CTAxis; label: string }[] = [
  { id: 'axial', label: 'Axial' },
  { id: 'coronal', label: 'Coronal' },
  { id: 'sagittal', label: 'Sagittal' },
];

/** Live CT image of the current slice + scan controls. */
export function CTPanel({ model }: { model: ModelExperience }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitsRef = useRef<CTHit[]>([]);
  const [axis, setAxis] = useState<CTAxis>(() => model.ct!.currentAxis);
  const [pos, setPos] = useState(() => model.ct!.position);
  const [playing, setPlaying] = useState(false);

  // Keep the latest `playing` visible to the rAF loop without restarting it.
  const playingRef = useRef(playing);
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  // Draw loop: redraw whenever a new slice is computed (or selection changes).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const scanner = model.ct!;
    const profile = model.ctConfig!.profile;
    let raf = 0;
    let drawn = '';
    let last = performance.now();
    let dir = 1;

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (playingRef.current) {
        // Auto-scan: sweep back and forth through the model.
        let t = scanner.position + dir * dt * 0.12;
        if (t >= 1 || t <= 0) {
          dir = -dir;
          t = Math.min(1, Math.max(0, t));
        }
        scanner.setPosition(t);
        setPos(t);
      }

      const size = Math.round(canvas.clientWidth * Math.min(window.devicePixelRatio, 2));
      if (canvas.width !== size) canvas.width = canvas.height = size;
      const slice = scanner.current;
      const sig = `${slice?.version}|${model.selectedPart}|${size}`;
      if (slice && sig !== drawn) {
        hitsRef.current = drawCT(ctx, size, slice, profile, scanner.modelExtent, model.selectedPart);
        drawn = sig;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [model]);

  const chooseAxis = (a: CTAxis) => {
    model.ct?.setAxis(a);
    setAxis(a);
  };

  const onSlider = (v: number) => {
    setPlaying(false);
    model.ct?.setPosition(v);
    setPos(v);
  };

  /** Tap the CT image to identify the structure under your finger. */
  const onTap = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const ctx = canvas.getContext('2d')!;
    const hit = [...hitsRef.current].reverse().find((h) => ctx.isPointInPath(h.path, x, y, 'evenodd'));
    const key = hit ? (hit.resolve?.(x, y) ?? hit.key) : null;
    model.select(key && key !== model.selectedPart ? key : null);
  };

  return (
    <section className="ct-panel" aria-label="CT scan view">
      <canvas
        ref={canvasRef}
        className="ct-image"
        onPointerUp={onTap}
        role="img"
        aria-label={`CT ${axis} slice. Tap a structure to identify it.`}
      />
      <div className="ct-axes" role="radiogroup" aria-label="Slice plane">
        {AXES.map((a) => (
          <button
            key={a.id}
            role="radio"
            aria-checked={axis === a.id}
            className={axis === a.id ? 'is-on' : ''}
            onClick={() => chooseAxis(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="ct-scrub">
        <button
          className="ct-play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? 'Pause scan' : 'Auto scan'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(pos * 1000)}
          onChange={(e) => onSlider(Number(e.target.value) / 1000)}
          aria-label="Slice position"
        />
      </div>
    </section>
  );
}
