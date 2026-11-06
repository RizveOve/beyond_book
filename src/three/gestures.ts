import * as THREE from 'three';

export interface GestureHandlers {
  /** Tap at normalised device coordinates (-1..1). */
  onTap?: (ndc: THREE.Vector2) => void;
  /** Horizontal one-finger drag, in pixels. */
  onDrag?: (dx: number) => void;
  /** Two-finger pinch; factor > 1 means spread (zoom in). */
  onPinch?: (factor: number) => void;
}

const TAP_MAX_MOVE = 10; // px
const TAP_MAX_MS = 350;

/**
 * Pointer-event gestures for a canvas: tap, one-finger drag and two-finger
 * pinch. Returns a cleanup function.
 */
export function attachGestures(el: HTMLElement, h: GestureHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let start = { x: 0, y: 0 };
  let moved = 0;
  let pinchDist = 0;

  const dist = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const down = (e: PointerEvent) => {
    el.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      downAt = performance.now();
      start = { x: e.clientX, y: e.clientY };
      moved = 0;
    } else if (pointers.size === 2) {
      pinchDist = dist();
      moved = Infinity; // a multi-touch gesture is never a tap
    }
  };

  const move = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur);

    if (pointers.size === 1) {
      moved = Math.max(moved, Math.hypot(cur.x - start.x, cur.y - start.y));
      if (moved > TAP_MAX_MOVE) h.onDrag?.(cur.x - prev.x);
    } else if (pointers.size === 2) {
      const d = dist();
      if (pinchDist > 0) h.onPinch?.(d / pinchDist);
      pinchDist = d;
    }
  };

  const up = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 0 && moved <= TAP_MAX_MOVE && performance.now() - downAt < TAP_MAX_MS) {
      const r = el.getBoundingClientRect();
      h.onTap?.(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          -((e.clientY - r.top) / r.height) * 2 + 1,
        ),
      );
    }
    if (pointers.size < 2) pinchDist = 0;
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    h.onPinch?.(Math.exp(-e.deltaY * 0.001));
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('wheel', wheel);
  };
}
