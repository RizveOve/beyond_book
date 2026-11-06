// Procedurally builds a detailed, greyscale human brain and writes
// public/models/brain.glb. Each structure is a separately named mesh (name
// prefix = part key in src/content/brainParts.ts). Hemisphere meshes end in
// `_LH` / `_RH`; the app uses that to pull the hemispheres apart in explode view.
//
// Orientation: anterior = −x, superior = +y, the LEFT hemisphere faces +z, so
// looking down −z shows the same left lateral view as the printed page.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fileURLToPath } from 'node:url';
import { V, tissue, vnoise, fbm, vessel, sculptSphere, splitByFields, exportGLB } from './lib/model-kit.mjs';

const M = {
  FrontalLobe: tissue(0.88),
  ParietalLobe: tissue(0.74),
  TemporalLobe: tissue(0.62),
  OccipitalLobe: tissue(0.5),
  Cerebellum: tissue(0.42),
  Brainstem: tissue(0.36),
  SpinalCord: tissue(0.36),
  CorpusCallosum: tissue(0.94, 0.5, 0.2),
  Thalamus: tissue(0.56),
  PituitaryGland: tissue(0.38),
  OlfactoryBulbs: tissue(0.72),
};

const brain = new THREE.Group();
brain.name = 'Brain';
function add(name, geo, material, setup) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  setup?.(m);
  brain.add(m);
  return m;
}

// ---------- Cerebral hemispheres ----------
const RX = 0.58, RY = 0.4, RZ = 0.3; // half-length, half-height, half-width
const MEDIAL_FLATTEN = 0.28;
const FISSURE = 0.012; // half-gap of the longitudinal fissure

/** Central sulcus: x position as a function of height (slants forward going down). */
const centralX = (y) => -0.07 + 0.26 * y;
/** Lateral (Sylvian) fissure: height as a function of x (gently rising curve). */
const lateralY = (x) => -0.115 + 0.2 * (x + 0.34) + 0.12 * (x + 0.34) ** 2;
/** Occipital border (parieto-occipital / pre-occipital line): x as a function of height. */
const occipitalX = (y) => 0.33 - 0.12 * y;

// Lobe regions as scalar fields (> 0 = inside), claimed in order; parietal takes the rest.
// Fields are evaluated on the left-hemisphere shape (|z|).
const LOBE_FIELDS = [
  ['OccipitalLobe', (p) => p.x - occipitalX(p.y)],
  ['TemporalLobe', (p) => Math.min(lateralY(p.x) - p.y, p.x + 0.38)],
  ['FrontalLobe', (p) => centralX(p.y) - p.x],
  ['ParietalLobe', null],
];

/** Base (undisplaced) hemisphere shape for a unit direction n, left hemisphere (z > 0). */
function hemisphereBase(n) {
  const p = V(n.x * RX, n.y * RY, n.z * RZ);
  // Occipital pole slightly pointed, frontal pole fuller and taller.
  if (n.x > 0) p.x *= 1 + 0.07 * n.x ** 3;
  if (n.x < 0 && n.y > 0) p.y *= 1 + 0.08 * -n.x;
  // Temporal lobe hangs below the front-middle of the hemisphere.
  if (n.y < 0) {
    const w = Math.exp(-(((p.x + 0.06) / 0.24) ** 2)) * -n.y;
    p.y -= 0.13 * w;
    p.z += 0.03 * w * Math.max(0, n.z);
    // Orbital (under-frontal) surface is flatter.
    if (n.x < -0.25) p.y *= 0.78;
    else p.y *= 0.9;
  }
  // Flat medial wall facing the other hemisphere.
  if (n.z < 0) p.z *= MEDIAL_FLATTEN;
  p.z += RZ * MEDIAL_FLATTEN + FISSURE;
  return p;
}

function makeHemisphere(side, seed) {
  // side: +1 = left (z > 0), −1 = right (mirrored).
  const geo = sculptSphere(288, 216, (n) => {
    const p = hemisphereBase(n);
    const lateral = Math.max(0, n.z); // 1 on the outer surface, 0 on the medial wall
    // Ellipsoid normal ~ outward direction for displacement.
    const dir = V(p.x / RX ** 2, p.y / RY ** 2, (p.z - (RZ * MEDIAL_FLATTEN + FISSURE)) / RZ ** 2).normalize();

    // Gyri: domain-warped noise; sulci are the narrow valleys where it crosses zero.
    const wx = fbm(p.x * 3 + 7, p.y * 3, p.z * 3, 2, seed) * 0.35;
    const wy = fbm(p.x * 3, p.y * 3 + 11, p.z * 3, 2, seed + 3) * 0.35;
    const q = V(p.x * 7.5 + wx * 7.5, p.y * 7.5 + wy * 7.5, p.z * 7.5);
    const s1 = Math.abs(vnoise(q.x, q.y, q.z, seed));
    const s2 = Math.abs(vnoise(q.x * 2.1, q.y * 2.1, q.z * 2.1, seed + 9));
    let d = 0.022 * (Math.min(1, s1 * 3.2) ** 0.55 - 0.65) + 0.006 * (Math.min(1, s2 * 3) ** 0.6 - 0.6);
    d *= 0.45 + 0.55 * lateral;

    // Landmark grooves: they also hide the borders between lobe meshes.
    if (p.y > -0.08) d -= 0.03 * Math.exp(-(((p.x - centralX(p.y)) / 0.017) ** 2)) * (0.3 + 0.7 * lateral);
    if (p.x < 0.26 && p.x > -0.4 && lateral > 0.1) {
      d -= 0.034 * Math.exp(-(((p.y - lateralY(p.x)) / 0.02) ** 2)) * lateral;
    }
    d -= 0.012 * Math.exp(-(((p.x - occipitalX(p.y)) / 0.015) ** 2));
    // Front of the temporal lobe (where it meets the frontal lobe's underside).
    if (p.y < lateralY(p.x)) d -= 0.022 * Math.exp(-(((p.x + 0.38) / 0.016) ** 2));

    p.addScaledVector(dir, d);
    p.z *= side;
    return p;
  });

  const merged = mergeVertices(geo);
  merged.computeVertexNormals();
  // Cut into lobes along smooth borders (fields evaluated on the unmirrored shape).
  const fields = LOBE_FIELDS.map(([name, f]) => [name, f && ((p) => f(V(p.x, p.y, Math.abs(p.z))))]);
  const pieces = splitByFields(merged, fields, mergeVertices);
  const suffix = side > 0 ? 'LH' : 'RH';
  for (const [lobe, g] of pieces) add(`${lobe}_${suffix}`, g, M[lobe]);
}

makeHemisphere(+1, 3);
makeHemisphere(-1, 17);

// ---------- Cerebellum ----------
{
  const C = V(0.34, -0.29, 0);
  const geo = sculptSphere(200, 150, (n) => {
    const p = V(n.x * 0.2, n.y * 0.13, n.z * 0.31);
    if (n.y > 0) p.y *= 0.7; // flatter top under the cerebrum
    const dir = n.clone();
    // Folia: fine parallel ridges, slightly wavy.
    const f = Math.abs(Math.sin(p.y * 120 + p.x * 25 + vnoise(p.x * 9, p.y * 9, p.z * 9, 5) * 2.5));
    let d = 0.007 * (f ** 0.5 - 0.7);
    // Vermis: shallow midline groove separating the two cerebellar hemispheres.
    d -= 0.02 * Math.exp(-((p.z / 0.03) ** 2)) * Math.max(0, n.x + 0.3);
    p.addScaledVector(dir, d);
    return p.add(C);
  });
  const merged = mergeVertices(geo);
  merged.computeVertexNormals();
  add('Cerebellum', merged, M.Cerebellum);
}

// ---------- Brainstem & spinal cord ----------
const stemPts = [V(0.04, -0.06, 0), V(0.06, -0.22, 0), V(0.1, -0.42, 0), V(0.13, -0.58, 0)];
add('Brainstem', vessel(stemPts, 0.085, 0.058, { tubular: 48, radial: 40, bumps: 0.04, seed: 2 }), M.Brainstem);
add(
  'Brainstem_Pons',
  sculptSphere(64, 48, (n) =>
    V(n.x * 0.085, n.y * 0.08, n.z * 0.1).add(V(0.03, -0.27, 0)).addScaledVector(n, 0.0015 * Math.sin(n.y * 30)),
  ),
  M.Brainstem,
  (m) => m.geometry.computeVertexNormals(),
);
const cordPts = [V(0.13, -0.56, 0), V(0.15, -0.68, 0), V(0.16, -0.8, 0)];
add('SpinalCord', vessel(cordPts, 0.055, 0.046, { tubular: 32, radial: 32, seed: 4 }), M.SpinalCord);
add('SpinalCord_End', new THREE.SphereGeometry(0.046, 32, 20), M.SpinalCord, (m) => m.position.copy(cordPts.at(-1)));

// ---------- Deep structures (visible through the fissure, in focus & explode) ----------
const ccPts = [V(-0.22, 0.02, 0), V(-0.15, 0.11, 0), V(0.0, 0.14, 0), V(0.16, 0.11, 0), V(0.24, 0.02, 0)];
add('CorpusCallosum', vessel(ccPts, 0.034, 0.04, { tubular: 64, radial: 24, seed: 6 }), M.CorpusCallosum, (m) =>
  m.scale.set(1, 1, 0.7),
);
for (const [side, z] of [['Left', 0.05], ['Right', -0.05]]) {
  add(
    `Thalamus_${side}`,
    sculptSphere(48, 32, (n) => V(n.x * 0.085, n.y * 0.055, n.z * 0.045).add(V(0.04, -0.02, z))),
    M.Thalamus,
    (m) => m.geometry.computeVertexNormals(),
  );
}
add('PituitaryGland_Stalk', vessel([V(-0.04, -0.1, 0), V(-0.06, -0.17, 0), V(-0.07, -0.22, 0)], 0.012, 0.01, { tubular: 16, radial: 12 }), M.PituitaryGland);
add('PituitaryGland', new THREE.SphereGeometry(0.032, 32, 24), M.PituitaryGland, (m) => {
  m.position.set(-0.075, -0.245, 0);
  m.scale.set(1.25, 0.85, 1);
});

for (const [side, z] of [['Left', 0.045], ['Right', -0.045]]) {
  const pts = [V(-0.2, -0.2, z), V(-0.32, -0.205, z * 1.05), V(-0.44, -0.2, z * 1.1)];
  add(`OlfactoryBulbs_Tract${side}`, vessel(pts, 0.011, 0.013, { tubular: 24, radial: 12 }), M.OlfactoryBulbs);
  add(`OlfactoryBulbs_${side}`, new THREE.SphereGeometry(0.022, 24, 16), M.OlfactoryBulbs, (m) => {
    m.position.copy(pts.at(-1));
    m.scale.set(1.6, 0.8, 1);
  });
}

await exportGLB(brain, fileURLToPath(new URL('../public/models/brain.glb', import.meta.url)));
