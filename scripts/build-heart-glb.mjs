// Procedurally builds a detailed, greyscale anatomical heart and writes
// public/models/heart.glb. Each anatomical part is a separately named mesh
// (name prefix = part key in src/content/heartParts.ts) so the app can make it
// tappable. Replace public/models/heart.glb with a real model at any time.
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';

// --- Minimal browser shims needed by GLTFExporter under Node ---
globalThis.FileReader ??= class {
  onloadend = null;
  result = null;
  async readAsArrayBuffer(blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
  async readAsDataURL(blob) {
    const buf = Buffer.from(await blob.arrayBuffer());
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${buf.toString('base64')}`;
    this.onloadend?.();
  }
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- Materials: greyscale "wet clay" anatomy-model look ----------
// Shades echo the printed page: arteries light, veins dark, muscle mid-grey.
const tissue = (grey, roughness = 0.5, clearcoat = 0.35) =>
  new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(grey, grey, grey).convertSRGBToLinear(),
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.45,
  });

const M = {
  leftVentricle: tissue(0.52),
  rightVentricle: tissue(0.6),
  rightAtrium: tissue(0.66),
  leftAtrium: tissue(0.46),
  artery: tissue(0.88, 0.4),
  vein: tissue(0.3, 0.45),
  pulmonaryVein: tissue(0.4, 0.45),
  coronary: tissue(0.95, 0.35, 0.5),
  cardiacVein: tissue(0.22, 0.4, 0.5),
  fat: tissue(0.8, 0.75, 0.15),
  ligament: tissue(0.72, 0.7, 0.1),
};

// ---------- Noise helpers ----------
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
/** Smooth value noise in [-1, 1]. */
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
  const L = THREE.MathUtils.lerp;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  const v = L(
    L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf),
    L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
  return v * 2 - 1;
}
function fbm(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, z * freq);
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}

/**
 * Deformed sphere: tapers toward the bottom (teardrop/cone), with layered
 * noise for an organic surface, optional spiral "muscle fibre" striations and
 * optional frilled edges (for the atrial auricles).
 */
function organicBlob({
  radius,
  scale,
  taper = 0.7,
  taperPow = 0.8,
  wobble = 0.05,
  noiseFreq = 3,
  seed = 1,
  fibres = 0,
  frill = 0,
  segments = [128, 96],
}) {
  const geo = new THREE.SphereGeometry(radius, segments[0], segments[1]);
  geo.deleteAttribute('uv'); // untextured: keep the file small
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const t = THREE.MathUtils.clamp((v.y / radius + 1) / 2, 0, 1); // 0 bottom → 1 top
    const w = 1 - taper * Math.pow(1 - t, taperPow) * (1 - t);
    const theta = Math.atan2(n.z, n.x);

    let d = wobble * fbm(n.x * noiseFreq + seed, n.y * noiseFreq, n.z * noiseFreq - seed, 4);
    if (fibres) d += fibres * Math.sin(42 * (n.y + 0.35 * theta)) * (0.5 + 0.5 * t);
    if (frill) d += frill * Math.sin(theta * 11) * Math.sin(t * Math.PI);

    v.x *= w;
    v.z *= w;
    v.addScaledVector(n, d * radius);
    v.multiply(scale);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Tube that tapers from r0 to r1, with a little organic radius variation. */
function vessel(points, r0, r1 = r0, { tubular = 96, radial = 28, bumps = 0.06, seed = 0 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const center = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(center);
      const r =
        THREE.MathUtils.lerp(r0, r1, t) *
        (1 + bumps * vnoise(t * 9 + seed, (j / radial) * 4, seed));
      v.normalize().multiplyScalar(r).add(center);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return { geo, curve };
}

const heart = new THREE.Group();
heart.name = 'Heart';

function add(name, geo, material, setup) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  setup?.(m);
  heart.add(m);
  return m;
}

/** Vessel with a rounded cap at its open end(s). */
function addVessel(name, points, r0, r1, material, { capStart = false, capEnd = true, ...opts } = {}) {
  const { geo } = vessel(points, r0, r1, opts);
  add(name, geo, material);
  const capGeo = (r) => {
    const g = new THREE.SphereGeometry(r, 28, 20);
    g.deleteAttribute('uv');
    return g;
  };
  if (capEnd) add(`${name}_Cap`, capGeo(r1), material, (m) => m.position.copy(points.at(-1)));
  if (capStart) add(`${name}_CapStart`, capGeo(r0), material, (m) => m.position.copy(points[0]));
}

// ===================== Chambers =====================
const lv = add(
  'LeftVentricle',
  organicBlob({ radius: 0.32, scale: V(1.0, 1.38, 0.95), taper: 0.88, seed: 2, fibres: 0.0022, segments: [160, 120] }),
  M.leftVentricle,
  (m) => {
    m.position.set(0.1, -0.12, -0.04);
    m.rotation.z = 0.42; // apex points down and to the patient's left (viewer's right)
  },
);

const rv = add(
  'RightVentricle',
  organicBlob({ radius: 0.3, scale: V(1.05, 1.15, 0.8), taper: 0.8, seed: 5, fibres: 0.0022, segments: [160, 120] }),
  M.rightVentricle,
  (m) => {
    m.position.set(-0.08, -0.05, 0.08);
    m.rotation.z = 0.55;
  },
);

add(
  'RightAtrium',
  organicBlob({ radius: 0.17, scale: V(1.0, 1.15, 0.95), taper: 0.25, seed: 7, wobble: 0.07 }),
  M.rightAtrium,
  (m) => m.position.set(-0.32, 0.18, 0.0),
);
add(
  'RightAtrium_Auricle',
  organicBlob({ radius: 0.075, scale: V(1.5, 0.8, 1.0), taper: 0.3, seed: 9, wobble: 0.1, frill: 0.08, segments: [96, 64] }),
  M.rightAtrium,
  (m) => {
    m.position.set(-0.21, 0.31, 0.12);
    m.rotation.z = -0.5;
  },
);

add(
  'LeftAtrium',
  organicBlob({ radius: 0.16, scale: V(1.15, 0.9, 1.0), taper: 0.25, seed: 11, wobble: 0.07 }),
  M.leftAtrium,
  (m) => m.position.set(0.22, 0.24, -0.14),
);
add(
  'LeftAtrium_Auricle',
  organicBlob({ radius: 0.07, scale: V(1.7, 0.75, 1.0), taper: 0.3, seed: 13, wobble: 0.1, frill: 0.09, segments: [96, 64] }),
  M.leftAtrium,
  (m) => {
    m.position.set(0.33, 0.2, 0.07);
    m.rotation.z = 0.4;
  },
);

// ===================== Great arteries =====================
// Aortic root, ascending aorta, arch and descending aorta.
const aortaPts = [
  V(0.0, 0.12, 0.02), V(-0.01, 0.38, 0.05), V(0.02, 0.6, 0.0), V(0.12, 0.69, -0.08),
  V(0.22, 0.61, -0.2), V(0.24, 0.35, -0.26), V(0.24, -0.1, -0.28), V(0.22, -0.58, -0.26),
];
addVessel('Aorta', aortaPts, 0.08, 0.068, M.artery, { tubular: 160, bumps: 0.04, seed: 1 });

// Aortic sinuses: three bulges at the root.
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2 + 0.4;
  const g = new THREE.SphereGeometry(0.045, 32, 24);
  g.deleteAttribute('uv');
  add(`Aorta_Sinus${i}`, g, M.artery, (m) => {
    m.position.set(Math.cos(a) * 0.055, 0.17, 0.02 + Math.sin(a) * 0.055);
    m.scale.set(1, 1.3, 1);
  });
}

// Arch branches: brachiocephalic (splitting in two), left carotid, left subclavian.
addVessel('Aorta_Brachiocephalic', [V(0.04, 0.67, -0.02), V(0.0, 0.78, -0.02), V(-0.04, 0.86, -0.02)], 0.04, 0.034, M.artery, { capEnd: false, tubular: 32 });
addVessel('Aorta_RightCarotid', [V(-0.04, 0.85, -0.02), V(-0.04, 0.95, 0.0), V(-0.03, 1.05, 0.0)], 0.024, 0.02, M.artery, { tubular: 32 });
addVessel('Aorta_RightSubclavian', [V(-0.04, 0.85, -0.02), V(-0.12, 0.92, -0.02), V(-0.22, 0.96, -0.03)], 0.026, 0.021, M.artery, { tubular: 32 });
addVessel('Aorta_LeftCarotid', [V(0.11, 0.71, -0.08), V(0.12, 0.86, -0.08), V(0.12, 1.02, -0.08)], 0.028, 0.022, M.artery, { tubular: 40 });
addVessel('Aorta_LeftSubclavian', [V(0.18, 0.68, -0.15), V(0.24, 0.82, -0.16), V(0.33, 0.93, -0.16)], 0.031, 0.024, M.artery, { tubular: 40 });

// Pulmonary trunk and its branches (oxygen-poor blood → dark like veins on the page).
addVessel('PulmonaryArtery', [V(-0.06, 0.12, 0.16), V(-0.02, 0.3, 0.16), V(0.04, 0.44, 0.1)], 0.075, 0.068, M.vein, { tubular: 48, seed: 3 });
const pJoint = new THREE.SphereGeometry(0.068, 32, 24);
pJoint.deleteAttribute('uv');
add('PulmonaryArtery_Joint', pJoint, M.vein, (m) => m.position.set(0.04, 0.44, 0.1));
addVessel('PulmonaryArtery_Left', [V(0.04, 0.44, 0.1), V(0.2, 0.47, 0.04), V(0.36, 0.45, -0.04), V(0.46, 0.43, -0.08)], 0.056, 0.042, M.vein, { capEnd: false, tubular: 48, seed: 4 });
addVessel('PulmonaryArtery_LeftUpper', [V(0.46, 0.43, -0.08), V(0.53, 0.5, -0.1), V(0.6, 0.55, -0.11)], 0.032, 0.026, M.vein, { tubular: 24 });
addVessel('PulmonaryArtery_LeftLower', [V(0.46, 0.43, -0.08), V(0.54, 0.38, -0.1), V(0.62, 0.33, -0.12)], 0.034, 0.027, M.vein, { tubular: 24 });
addVessel('PulmonaryArtery_Right', [V(0.04, 0.44, 0.1), V(-0.06, 0.48, -0.08), V(-0.25, 0.47, -0.14), V(-0.44, 0.44, -0.14)], 0.056, 0.042, M.vein, { capEnd: false, tubular: 48, seed: 5 });
addVessel('PulmonaryArtery_RightUpper', [V(-0.44, 0.44, -0.14), V(-0.51, 0.51, -0.15), V(-0.58, 0.56, -0.15)], 0.032, 0.026, M.vein, { tubular: 24 });
addVessel('PulmonaryArtery_RightLower', [V(-0.44, 0.44, -0.14), V(-0.52, 0.38, -0.15), V(-0.6, 0.33, -0.16)], 0.034, 0.027, M.vein, { tubular: 24 });

// Ligamentum arteriosum: fibrous remnant linking the arch and the pulmonary artery.
addVessel('LigamentumArteriosum', [V(0.1, 0.46, 0.06), V(0.13, 0.52, -0.0), V(0.15, 0.6, -0.06)], 0.012, 0.012, M.ligament, { capEnd: false, tubular: 16, radial: 12 });

// ===================== Great veins =====================
addVessel('SuperiorVenaCava', [V(-0.32, 0.3, 0.0), V(-0.33, 0.6, -0.02), V(-0.33, 0.92, -0.04)], 0.068, 0.064, M.vein, { tubular: 48, seed: 6 });
addVessel('InferiorVenaCava', [V(-0.3, 0.05, -0.06), V(-0.3, -0.25, -0.1), V(-0.3, -0.55, -0.12)], 0.074, 0.07, M.vein, { tubular: 48, seed: 7 });

const pvDefs = [
  [V(0.3, 0.3, -0.18), V(0.45, 0.34, -0.22), V(0.57, 0.36, -0.24)],
  [V(0.32, 0.18, -0.2), V(0.47, 0.16, -0.24), V(0.59, 0.14, -0.26)],
  [V(0.12, 0.3, -0.24), V(0.0, 0.34, -0.3), V(-0.13, 0.35, -0.32)],
  [V(0.12, 0.18, -0.26), V(0.0, 0.16, -0.32), V(-0.13, 0.14, -0.34)],
];
pvDefs.forEach((pts, i) =>
  addVessel(`PulmonaryVeins_${i}`, pts, 0.038, 0.031, M.pulmonaryVein, { tubular: 32, radial: 20, seed: 10 + i }),
);

// ===================== Surface vessels =====================
heart.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster();
const surface = [lv, rv];

/** Projects guide points onto the ventricles by casting rays toward `axis` from `dir`. */
function project(points, dir, lift) {
  const out = [];
  for (const p of points) {
    raycaster.set(p.clone().addScaledVector(dir, 3), dir.clone().negate());
    const hit = raycaster.intersectObjects(surface, false)[0];
    if (!hit) continue;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    out.push(hit.point.clone().addScaledVector(n, lift));
  }
  return out;
}
function bezier2(a, b, c, steps = 18) {
  return new THREE.QuadraticBezierCurve3(V(...a), V(...b), V(...c)).getPoints(steps);
}
const FRONT = V(0, 0, 1);
const LEFT_SIDE = V(1, 0, 0.35).normalize();
const RIGHT_SIDE = V(-1, 0, 0.35).normalize();

function surfaceVessel(name, guide, dir, r0, r1, material, lift = 0.014) {
  const pts = project(guide, dir, lift);
  if (pts.length < 4) return;
  const { geo } = vessel(pts, r0, r1, { tubular: 80, radial: 12, bumps: 0.1 });
  add(name, geo, material);
}

// Coronary arteries (light): LAD + diagonals, circumflex, right coronary + marginal.
const coronaries = [
  [bezier2([0.02, 0.12, 0], [0.1, -0.15, 0], [0.27, -0.5, 0], 26), FRONT, 0.018, 0.008],
  [bezier2([0.06, 0.0, 0], [0.17, -0.02, 0], [0.3, -0.09, 0]), FRONT, 0.012, 0.006],
  [bezier2([0.12, -0.17, 0], [0.22, -0.18, 0], [0.33, -0.26, 0]), FRONT, 0.011, 0.006],
  [bezier2([0.18, -0.32, 0], [0.24, -0.33, 0], [0.3, -0.4, 0]), FRONT, 0.009, 0.005],
  [bezier2([0.05, 0.12, 0], [0.25, 0.1, 0], [0.4, -0.08, 0], 22), LEFT_SIDE, 0.016, 0.009], // circumflex
  [bezier2([-0.12, 0.12, 0], [-0.32, 0.03, 0], [-0.3, -0.22, 0], 24), FRONT, 0.018, 0.01], // right coronary
  [bezier2([-0.28, -0.05, 0], [-0.18, -0.2, 0], [-0.05, -0.28, 0]), FRONT, 0.011, 0.006], // marginal
  [bezier2([-0.3, 0.0, 0], [-0.4, -0.1, 0], [-0.38, -0.25, 0]), RIGHT_SIDE, 0.012, 0.007],
];
coronaries.forEach(([guide, dir, r0, r1], i) =>
  surfaceVessel(`CoronaryArteries_${i}`, guide, dir, r0, r1, M.coronary),
);

// Cardiac veins (dark), running alongside the arteries.
const cardiacVeins = [
  [bezier2([0.05, 0.1, 0], [0.13, -0.15, 0], [0.3, -0.46, 0], 26), FRONT, 0.014, 0.007], // great cardiac vein
  [bezier2([0.09, -0.08, 0], [0.18, -0.1, 0], [0.31, -0.17, 0]), FRONT, 0.009, 0.005],
  [bezier2([-0.15, -0.05, 0], [-0.22, -0.18, 0], [-0.15, -0.34, 0]), FRONT, 0.01, 0.005], // anterior cardiac
  [bezier2([0.08, 0.14, 0], [0.27, 0.13, 0], [0.42, -0.02, 0], 22), LEFT_SIDE, 0.013, 0.008],
];
cardiacVeins.forEach(([guide, dir, r0, r1], i) =>
  surfaceVessel(`CardiacVeins_${i}`, guide, dir, r0, r1, M.cardiacVein, 0.01),
);

// Epicardial fat: soft pads half-sunk into the grooves between atria and ventricles.
const fatSpots = [
  [-0.18, 0.12, 0.05], [-0.04, 0.13, 0.045], [0.12, 0.12, 0.045], [0.24, 0.06, 0.035], [0.04, 0.0, 0.03],
];
fatSpots.forEach(([x, y, r], i) => {
  const [p] = project([V(x, y, 0)], FRONT, -r * 0.35);
  if (!p) return;
  add(
    `CoronaryArteries_Fat${i}`,
    organicBlob({ radius: r, scale: V(1.7, 0.75, 0.9), taper: 0.1, seed: 20 + i, wobble: 0.08, noiseFreq: 4, segments: [48, 32] }),
    M.fat,
    (m) => m.position.copy(p),
  );
});

// ---------- Export ----------
const scene = new THREE.Scene();
scene.add(heart);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
const outDir = new URL('../public/models/', import.meta.url);
await mkdir(outDir, { recursive: true });
const outFile = new URL('heart.glb', outDir);
await writeFile(outFile, Buffer.from(glb));
let verts = 0;
heart.traverse((o) => o.isMesh && (verts += o.geometry.attributes.position.count));
console.log(
  `Wrote ${outFile.pathname} (${(glb.byteLength / 1024 / 1024).toFixed(1)} MB, ${heart.children.length} meshes, ${verts.toLocaleString()} vertices)`,
);
