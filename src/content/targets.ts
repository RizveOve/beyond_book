import { BRAIN_PARTS } from './brainParts';
import { BRAIN_CT, HEART_CT, type CTConfig } from './ctProfiles';
import { HEART_PARTS } from './heartParts';
import type { PartInfo } from './parts';

export interface ARTarget {
  id: string;
  title: string;
  /** Short chapter line shown on the home screen. */
  chapter: string;
  /** Printable page (the image that gets tracked). */
  pageUrl: string;
  /** GLB to show when this page is recognised. */
  modelUrl: string;
  /** Educational content keyed by mesh-name prefix. */
  parts: Record<string, PartInfo>;
  /** Animate a heartbeat (only meaningful for the heart). */
  heartbeat: boolean;
  /** Parts on the model's surface that peel straight forward in explode view. */
  surfaceParts: string[];
  /** How far parts move apart in explode view (fraction of model size). */
  explodeDistance: number;
  /** Turn the model (radians) when exploding, to reveal splits along the view axis. */
  explodeTurn: number;
  /** Virtual CT scan settings. */
  ct: CTConfig;
  /** Model size relative to the printed page width (page width == 1 unit). */
  size: number;
  /** Centre of the drawing on the page, in page-width units from the page centre. */
  offset: { x: number; y: number };
  /** How far the model floats above the paper. */
  lift: number;
}

const base = import.meta.env.BASE_URL;

/** Compiled tracking data. Image N in this file ↔ TARGETS[N]. */
export const TARGETS_MIND_URL = `${base}targets/pages.mind`;

/**
 * One entry per page image compiled into `TARGETS_MIND_URL`, in the same order.
 * To add a page: compile all page images together (`npm run assets:target`,
 * or /compile.html; order matters) and append an entry here.
 */
export const TARGETS: ARTarget[] = [
  {
    id: 'heart',
    title: 'The Human Heart',
    chapter: 'Chapter 4 · The Circulatory System',
    pageUrl: `${base}targets/heart-page.png`,
    modelUrl: `${base}models/heart.glb`,
    parts: HEART_PARTS,
    heartbeat: true,
    surfaceParts: ['CoronaryArteries', 'CardiacVeins'],
    explodeDistance: 0.32,
    explodeTurn: 0,
    ct: HEART_CT,
    size: 0.78,
    offset: { x: 0.02, y: 0.03 },
    lift: 0.18,
  },
  {
    id: 'brain',
    title: 'The Human Brain',
    chapter: 'Chapter 5 · The Nervous System',
    pageUrl: `${base}targets/brain-page.png`,
    modelUrl: `${base}models/brain.glb`,
    parts: BRAIN_PARTS,
    heartbeat: false,
    surfaceParts: [],
    explodeDistance: 0.16,
    explodeTurn: -0.95, // brain splits left/right: swing round to a three-quarter view
    ct: BRAIN_CT,
    size: 0.6,
    offset: { x: 0.03, y: -0.03 },
    lift: 0.12,
  },
];
