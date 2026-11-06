// Procedurally builds a stylized anatomical heart and writes public/models/heart.glb.
// Each anatomical part is a separately named mesh so the app can make it tappable.
// Replace public/models/heart.glb with a real model at any time (see README).
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

const mat = (color, roughness = 0.55, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.0, ...extra });

const MATERIALS = {
  muscleLeft: mat('#b3302a', 0.5),
  muscleRight: mat('#c43d33', 0.5),
  atriumRight: mat('#cf4b3f', 0.5),
  atriumLeft: mat('#a52a25', 0.5),
  artery: mat('#e0473b', 0.4),
  vein: mat('#3d6fc2', 0.45),
  pulmonaryVein: mat('#8a3a8f', 0.45),
  coronary: mat('#f2c14e', 0.35),
  fat: mat('#f3d27a', 0.7),
};

/**
 * Deformed sphere: tapers toward the bottom to form a teardrop/cone,
 * with gentle low-frequency noise for an organic look.
 */
function organicBlob({ radius, scale, taper = 0.7, taperPow = 0.8, wobble = 0.03, seed = 1 }) {
  const geo = new THREE.SphereGeometry(radius, 72, 54);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = THREE.MathUtils.clamp((v.y / radius + 1) / 2, 0, 1); // 0 at bottom, 1 at top
    const w = 1 - taper * Math.pow(1 - t, taperPow) * (1 - t); // narrow toward bottom
    v.x *= w;
    v.z *= w;
    const n =
      Math.sin(v.x * 9 + seed) * Math.cos(v.y * 7 + seed * 2) * Math.sin(v.z * 8 + seed * 3);
    v.multiplyScalar(1 + wobble * n);
    v.multiply(scale);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function tube(points, radius, { tubular = 96, radial = 24, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

/** Tube that tapers from r0 to r1 along its length. */
function taperedTube(points, r0, r1, opts = {}) {
  const geo = tube(points, 1, opts);
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const tubular = opts.tubular ?? 96;
  const radial = opts.radial ?? 24;
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const center = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Rounded end cap so open tube ends don't look hollow. */
function cap(point, radius, material, name) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), material);
  m.position.copy(point);
  m.name = name;
  return m;
}

const heart = new THREE.Group();
heart.name = 'Heart';

// ---------- Ventricles ----------
const lv = new THREE.Mesh(
  organicBlob({ radius: 0.32, scale: V(1.0, 1.35, 0.95), taper: 0.85, seed: 2 }),
  MATERIALS.muscleLeft,
);
lv.name = 'LeftVentricle';
lv.position.set(0.1, -0.12, -0.04);
lv.rotation.z = 0.42; // apex points down and to the patient's left (viewer's right)
heart.add(lv);

const rv = new THREE.Mesh(
  organicBlob({ radius: 0.3, scale: V(1.05, 1.15, 0.8), taper: 0.8, seed: 5 }),
  MATERIALS.muscleRight,
);
rv.name = 'RightVentricle';
rv.position.set(-0.08, -0.05, 0.08);
rv.rotation.z = 0.55;
heart.add(rv);

// ---------- Atria ----------
const ra = new THREE.Mesh(
  organicBlob({ radius: 0.17, scale: V(1.0, 1.15, 0.95), taper: 0.25, seed: 7, wobble: 0.05 }),
  MATERIALS.atriumRight,
);
ra.name = 'RightAtrium';
ra.position.set(-0.32, 0.18, 0.0);
heart.add(ra);

const raAuricle = new THREE.Mesh(
  organicBlob({ radius: 0.07, scale: V(1.4, 0.8, 1.0), taper: 0.3, seed: 9, wobble: 0.08 }),
  MATERIALS.atriumRight,
);
raAuricle.name = 'RightAtrium_Auricle';
raAuricle.position.set(-0.22, 0.3, 0.12);
raAuricle.rotation.z = -0.5;
heart.add(raAuricle);

const la = new THREE.Mesh(
  organicBlob({ radius: 0.16, scale: V(1.15, 0.9, 1.0), taper: 0.25, seed: 11, wobble: 0.05 }),
  MATERIALS.atriumLeft,
);
la.name = 'LeftAtrium';
la.position.set(0.22, 0.24, -0.14);
heart.add(la);

const laAuricle = new THREE.Mesh(
  organicBlob({ radius: 0.065, scale: V(1.6, 0.75, 1.0), taper: 0.3, seed: 13, wobble: 0.08 }),
  MATERIALS.atriumLeft,
);
laAuricle.name = 'LeftAtrium_Auricle';
laAuricle.position.set(0.33, 0.2, 0.06);
laAuricle.rotation.z = 0.4;
heart.add(laAuricle);

// ---------- Aorta + arch branches ----------
const aortaPts = [
  V(0.0, 0.12, 0.02),
  V(0.0, 0.38, 0.04),
  V(0.02, 0.6, 0.0),
  V(0.12, 0.68, -0.08),
  V(0.22, 0.6, -0.2),
  V(0.24, 0.35, -0.26),
  V(0.24, -0.1, -0.28),
  V(0.22, -0.55, -0.26),
];
const aorta = new THREE.Mesh(tube(aortaPts, 0.075), MATERIALS.artery);
aorta.name = 'Aorta';
heart.add(aorta);
heart.add(cap(aortaPts.at(-1), 0.075, MATERIALS.artery, 'Aorta_End'));

const branchDefs = [
  ['Aorta_Brachiocephalic', [V(0.04, 0.66, -0.02), V(-0.0, 0.8, -0.02), V(-0.05, 0.93, -0.02)], 0.035, 0.03],
  ['Aorta_LeftCarotid', [V(0.11, 0.7, -0.08), V(0.12, 0.84, -0.08), V(0.12, 0.96, -0.08)], 0.028, 0.024],
  ['Aorta_LeftSubclavian', [V(0.18, 0.67, -0.15), V(0.23, 0.8, -0.16), V(0.27, 0.92, -0.16)], 0.03, 0.026],
];
for (const [name, pts, r0, r1] of branchDefs) {
  const b = new THREE.Mesh(taperedTube(pts, r0, r1, { tubular: 32 }), MATERIALS.artery);
  b.name = name;
  heart.add(b);
  heart.add(cap(pts.at(-1), r1, MATERIALS.artery, `${name}_End`));
}

// ---------- Pulmonary trunk + arteries ----------
const pTrunkPts = [V(-0.06, 0.12, 0.16), V(-0.02, 0.3, 0.16), V(0.04, 0.44, 0.1)];
const pTrunk = new THREE.Mesh(tube(pTrunkPts, 0.07, { tubular: 40 }), MATERIALS.vein);
pTrunk.name = 'PulmonaryArtery';
heart.add(pTrunk);
heart.add(cap(pTrunkPts.at(-1), 0.07, MATERIALS.vein, 'PulmonaryArtery_Joint'));

const lpaPts = [V(0.04, 0.44, 0.1), V(0.2, 0.47, 0.04), V(0.38, 0.44, -0.04), V(0.5, 0.42, -0.08)];
const lpa = new THREE.Mesh(taperedTube(lpaPts, 0.055, 0.04, { tubular: 48 }), MATERIALS.vein);
lpa.name = 'PulmonaryArtery_Left';
heart.add(lpa);
heart.add(cap(lpaPts.at(-1), 0.04, MATERIALS.vein, 'PulmonaryArtery_LeftEnd'));

const rpaPts = [V(0.04, 0.44, 0.1), V(-0.06, 0.48, -0.08), V(-0.25, 0.47, -0.14), V(-0.46, 0.44, -0.14)];
const rpa = new THREE.Mesh(taperedTube(rpaPts, 0.055, 0.04, { tubular: 48 }), MATERIALS.vein);
rpa.name = 'PulmonaryArtery_Right';
heart.add(rpa);
heart.add(cap(rpaPts.at(-1), 0.04, MATERIALS.vein, 'PulmonaryArtery_RightEnd'));

// ---------- Venae cavae ----------
const svcPts = [V(-0.33, 0.9, -0.04), V(-0.33, 0.6, -0.02), V(-0.32, 0.3, 0.0)];
const svc = new THREE.Mesh(tube(svcPts, 0.065, { tubular: 32 }), MATERIALS.vein);
svc.name = 'SuperiorVenaCava';
heart.add(svc);
heart.add(cap(svcPts[0], 0.065, MATERIALS.vein, 'SuperiorVenaCava_End'));

const ivcPts = [V(-0.3, 0.05, -0.06), V(-0.3, -0.25, -0.1), V(-0.3, -0.5, -0.12)];
const ivc = new THREE.Mesh(tube(ivcPts, 0.07, { tubular: 32 }), MATERIALS.vein);
ivc.name = 'InferiorVenaCava';
heart.add(ivc);
heart.add(cap(ivcPts.at(-1), 0.07, MATERIALS.vein, 'InferiorVenaCava_End'));

// ---------- Pulmonary veins (into left atrium) ----------
const pvDefs = [
  [V(0.3, 0.3, -0.18), V(0.45, 0.34, -0.22), V(0.56, 0.36, -0.24)],
  [V(0.32, 0.18, -0.2), V(0.47, 0.16, -0.24), V(0.58, 0.14, -0.26)],
  [V(0.12, 0.3, -0.24), V(0.0, 0.34, -0.3), V(-0.12, 0.35, -0.32)],
  [V(0.12, 0.18, -0.26), V(0.0, 0.16, -0.32), V(-0.12, 0.14, -0.34)],
];
pvDefs.forEach((pts, i) => {
  const pv = new THREE.Mesh(taperedTube(pts, 0.035, 0.03, { tubular: 24, radial: 16 }), MATERIALS.pulmonaryVein);
  pv.name = `PulmonaryVeins_${i}`;
  heart.add(pv);
  heart.add(cap(pts.at(-1), 0.03, MATERIALS.pulmonaryVein, `PulmonaryVeins_End${i}`));
});

// ---------- Coronary arteries (projected onto the ventricle surface) ----------
heart.updateMatrixWorld(true);
const raycaster = new THREE.Raycaster();
const surfaceTargets = [lv, rv];

/** Project 2D (x,y) guide points onto the front surface of the ventricles. */
function onSurface(xy, lift = 0.012, fromZ = 2) {
  const out = [];
  for (const [x, y] of xy) {
    raycaster.set(V(x, y, fromZ), V(0, 0, -Math.sign(fromZ)));
    const hit = raycaster.intersectObjects(surfaceTargets, false)[0];
    if (!hit) continue;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    out.push(hit.point.clone().addScaledVector(n, lift));
  }
  return out;
}

function sampleLine(a, b, c, steps = 14) {
  const curve = new THREE.QuadraticBezierCurve(
    new THREE.Vector2(...a),
    new THREE.Vector2(...b),
    new THREE.Vector2(...c),
  );
  return curve.getPoints(steps).map((p) => [p.x, p.y]);
}

const coronaryPaths = [
  // Left anterior descending (along the interventricular groove)
  sampleLine([0.02, 0.12], [0.1, -0.15], [0.26, -0.48], 20),
  // Diagonal branches
  sampleLine([0.07, -0.02], [0.18, -0.02], [0.3, -0.08]),
  sampleLine([0.13, -0.18], [0.23, -0.18], [0.33, -0.25]),
  // Right coronary artery (along the right side)
  sampleLine([-0.12, 0.12], [-0.3, 0.02], [-0.3, -0.2], 18),
  sampleLine([-0.25, -0.06], [-0.15, -0.12], [-0.05, -0.12]),
];
coronaryPaths.forEach((xy, i) => {
  const pts = onSurface(xy);
  if (pts.length < 3) return;
  const c = new THREE.Mesh(
    taperedTube(pts, 0.016, 0.008, { tubular: 64, radial: 12 }),
    MATERIALS.coronary,
  );
  c.name = `CoronaryArteries_${i}`;
  heart.add(c);
});

// Fat in the atrioventricular groove adds realism around the base of the ventricles.
const fat = new THREE.Mesh(
  new THREE.TorusGeometry(0.26, 0.04, 16, 64, Math.PI * 1.2),
  MATERIALS.fat,
);
fat.name = 'CoronaryArteries_Groove';
fat.position.set(-0.02, 0.13, 0.0);
fat.rotation.set(Math.PI / 2 + 0.25, 0, Math.PI * 0.95);
fat.scale.set(1.2, 0.9, 1);
heart.add(fat);

// ---------- Export ----------
const scene = new THREE.Scene();
scene.add(heart);

const exporter = new GLTFExporter();
const glb = await exporter.parseAsync(scene, { binary: true });
const outDir = new URL('../public/models/', import.meta.url);
await mkdir(outDir, { recursive: true });
const outFile = new URL('heart.glb', outDir);
await writeFile(outFile, Buffer.from(glb));
console.log(`Wrote ${outFile.pathname} (${(glb.byteLength / 1024).toFixed(0)} KB)`);
