// Shared helpers for the procedural model generators (Node).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// Minimal browser shim needed by GLTFExporter under Node.
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

export const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Greyscale "wet clay" anatomy material. `grey` is an sRGB level 0..1. */
export function tissue(grey, roughness = 0.55, clearcoat = 0.3) {
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(grey, grey, grey).convertSRGBToLinear(),
    roughness,
    metalness: 0,
    clearcoat,
    clearcoatRoughness: 0.45,
  });
}

// ---------- Noise ----------
function hash3(x, y, z, s) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + s * 19.19) * 43758.5453;
  return h - Math.floor(h);
}

/** Smooth value noise in [-1, 1]. */
export function vnoise(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const f = (t) => t * t * (3 - 2 * t);
  const xf = f(x - xi), yf = f(y - yi), zf = f(z - zi);
  const L = THREE.MathUtils.lerp;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz, seed);
  const v = L(
    L(L(c(0, 0, 0), c(1, 0, 0), xf), L(c(0, 1, 0), c(1, 1, 0), xf), yf),
    L(L(c(0, 0, 1), c(1, 0, 1), xf), L(c(0, 1, 1), c(1, 1, 1), xf), yf),
    zf,
  );
  return v * 2 - 1;
}

export function fbm(x, y, z, octaves = 4, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise(x * freq, y * freq, z * freq, seed + i);
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum;
}

/** Tube along points, tapering r0 → r1, with slight organic radius variation. */
export function vessel(points, r0, r1 = r0, { tubular = 64, radial = 24, bumps = 0.05, seed = 0 } = {}) {
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
      const r = THREE.MathUtils.lerp(r0, r1, t) * (1 + bumps * vnoise(t * 9, (j / radial) * 4, seed));
      v.normalize().multiplyScalar(r).add(center);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Displaces a unit sphere with `shape(n) → Vector3` (n = unit direction) and
 * returns the geometry with normals computed.
 */
export function sculptSphere(widthSegs, heightSegs, shape) {
  const geo = new THREE.SphereGeometry(1, widthSegs, heightSegs);
  geo.deleteAttribute('uv');
  const pos = geo.attributes.position;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).normalize();
    const p = shape(n);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // Sphere poles/seams duplicate vertices; merge so normals are smooth everywhere.
  geo.deleteAttribute('normal');
  return geo;
}

/**
 * Splits a geometry into regions with clean, smooth borders by clipping
 * triangles against a sequence of scalar fields: `regions` is a list of
 * [name, field] where field(p) > 0 claims the point for that region; the last
 * entry's field is null and takes whatever remains. Triangles crossing a border
 * are cut exactly where the field changes sign (no sawtooth edges).
 */
export function splitByFields(geo, regions, mergeVertices) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.attributes.position;
  const nor = src.attributes.normal;
  const out = new Map(regions.map(([name]) => [name, { pos: [], nor: [] }]));

  const vert = (i) => ({
    p: new THREE.Vector3().fromBufferAttribute(pos, i),
    n: new THREE.Vector3().fromBufferAttribute(nor, i),
  });
  const lerpV = (a, b, t) => ({
    p: a.p.clone().lerp(b.p, t),
    n: a.n.clone().lerp(b.n, t).normalize(),
  });
  const emit = (name, poly) => {
    const b = out.get(name);
    for (let k = 1; k < poly.length - 1; k++) {
      for (const v of [poly[0], poly[k], poly[k + 1]]) {
        b.pos.push(v.p.x, v.p.y, v.p.z);
        b.nor.push(v.n.x, v.n.y, v.n.z);
      }
    }
  };

  for (let i = 0; i < pos.count; i += 3) {
    let poly = [vert(i), vert(i + 1), vert(i + 2)];
    for (const [name, field] of regions) {
      if (!field) {
        emit(name, poly);
        break;
      }
      const inside = [];
      const rest = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k];
        const b = poly[(k + 1) % poly.length];
        const fa = field(a.p);
        const fb = field(b.p);
        (fa > 0 ? inside : rest).push(a);
        if (fa > 0 !== fb > 0) {
          const m = lerpV(a, b, fa / (fa - fb));
          inside.push(m);
          rest.push(m);
        }
      }
      if (inside.length >= 3) emit(name, inside);
      if (rest.length < 3) break;
      poly = rest;
    }
  }

  const result = new Map();
  for (const [name, b] of out) {
    if (!b.pos.length) continue;
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    g = mergeVertices(g, 1e-5);
    result.set(name, g);
  }
  return result;
}

export async function exportGLB(object, outPath) {
  const scene = new THREE.Scene();
  scene.add(object);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, Buffer.from(glb));
  let verts = 0;
  object.traverse((o) => o.isMesh && (verts += o.geometry.attributes.position.count));
  console.log(
    `Wrote ${outPath} (${(glb.byteLength / 1048576).toFixed(1)} MB, ${object.children.length} meshes, ${verts.toLocaleString()} vertices)`,
  );
}
