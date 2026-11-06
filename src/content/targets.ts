import { HEART_PARTS, type HeartPart } from './heartParts';

export interface ARTarget {
  id: string;
  title: string;
  /** GLB to show when this page is recognised. */
  modelUrl: string;
  /** Educational content keyed by mesh-name prefix. */
  parts: Record<string, HeartPart>;
  /** Model size relative to the printed page width (page width == 1 unit). */
  size: number;
  /** Centre of the drawing on the page, in page-width units from the page centre. */
  offset: { x: number; y: number };
  /** How far the model floats above the paper. */
  lift: number;
}

const base = import.meta.env.BASE_URL;

/** Compiled tracking data. Image N in this file ↔ TARGETS[N]. */
export const TARGETS_MIND_URL = `${base}targets/heart.mind`;

/**
 * One entry per page image compiled into `TARGETS_MIND_URL`, in the same order.
 * To add a page: compile all page images together on /compile.html (order matters)
 * and append an entry here.
 */
export const TARGETS: ARTarget[] = [
  {
    id: 'heart',
    title: 'The Human Heart',
    modelUrl: `${base}models/heart.glb`,
    parts: HEART_PARTS,
    size: 0.78,
    offset: { x: 0.02, y: 0.03 },
    lift: 0.18,
  },
];
