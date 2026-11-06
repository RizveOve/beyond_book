import * as THREE from 'three';
import { partKeyFromMeshName } from '../content/parts';

export type CTAxis = 'axial' | 'coronal' | 'sagittal';

/** Anatomical directions in the model's own (normalised) coordinate space. */
export interface CTFrame {
  anterior: [number, number, number];
  left: [number, number, number];
  superior: [number, number, number];
}

/** One mesh's cross-section in (u, v) image-plane coordinates. */
export interface CTSliceMesh {
  name: string;
  key: string;
  /** Chained outline (closed loops for closed meshes; open arcs for surface patches). */
  loops: Float32Array[];
  /** Raw segments (u0 v0 u1 v1 …), so patches of one closed surface can be re-joined. */
  segs: Float32Array;
}

export interface CTSlice {
  axis: CTAxis;
  /** 0..1 position of the slice through the model. */
  t: number;
  /** Signed slice position along the slice normal, in model units. */
  offset: number;
  meshes: CTSliceMesh[];
  version: number;
}

interface MeshData {
  mesh: THREE.Mesh;
  key: string;
  /** Local-space positions (de-quantised). */
  pos: Float32Array;
  index: ArrayLike<number> | null;
  box: THREE.Box3;
}

const SLICE_COLOR = 0xffffff;

/**
 * Virtual CT scanner for a loaded model. Cuts the model with a plane:
 *  - computes the 2D cross-section (closed loops per mesh) for the CT image,
 *  - draws the slice plane and the cut outline in 3D,
 *  - clips the 3D model at the plane (cutaway view).
 *
 * All slicing happens in "model space" (the parent of the model: centred,
 * normalised, independent of the user's rotation/zoom).
 */
export class CTScanner {
  private readonly space: THREE.Object3D;
  private readonly frame: { anterior: THREE.Vector3; left: THREE.Vector3; superior: THREE.Vector3 };
  private readonly meshes: MeshData[] = [];
  private readonly modelBox: THREE.Box3;
  private readonly extent: number;

  private enabled = false;
  private axis: CTAxis = 'axial';
  private t = 0.5;
  private dirty = true;
  private sinceCompute = 0;
  private slice: CTSlice | null = null;
  private version = 0;

  /** World-space clipping plane shared by all materials while scanning. */
  readonly worldPlane = new THREE.Plane();
  private readonly helper = new THREE.Group();
  private readonly planeMesh: THREE.Mesh;
  private readonly cutLines: THREE.LineSegments;

  constructor(space: THREE.Object3D, model: THREE.Object3D, frame: CTFrame) {
    this.space = space;
    this.frame = {
      anterior: new THREE.Vector3(...frame.anterior).normalize(),
      left: new THREE.Vector3(...frame.left).normalize(),
      superior: new THREE.Vector3(...frame.superior).normalize(),
    };

    space.updateMatrixWorld(true);
    const spaceInv = space.matrixWorld.clone().invert();
    this.modelBox = new THREE.Box3();
    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const g = obj.geometry as THREE.BufferGeometry;
      const attr = g.attributes.position;
      const pos = new Float32Array(attr.count * 3);
      for (let i = 0; i < attr.count; i++) {
        pos[i * 3] = attr.getX(i);
        pos[i * 3 + 1] = attr.getY(i);
        pos[i * 3 + 2] = attr.getZ(i);
      }
      if (!g.boundingBox) g.computeBoundingBox();
      this.meshes.push({
        mesh: obj,
        key: partKeyFromMeshName(obj.name),
        pos,
        index: g.index ? g.index.array : null,
        box: g.boundingBox!.clone(),
      });
      const rel = spaceInv.clone().multiply(obj.matrixWorld);
      this.modelBox.union(g.boundingBox!.clone().applyMatrix4(rel));
    });
    const size = this.modelBox.getSize(new THREE.Vector3());
    this.extent = Math.max(size.x, size.y, size.z);

    // 3D helpers: translucent scan plane + bright cut outline.
    const s = this.extent * 1.15;
    this.planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s),
      new THREE.MeshBasicMaterial({
        color: SLICE_COLOR,
        transparent: true,
        opacity: 0.06,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const frameLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.planeMesh.geometry),
      new THREE.LineBasicMaterial({ color: SLICE_COLOR, transparent: true, opacity: 0.6 }),
    );
    this.planeMesh.add(frameLine);
    this.cutLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: SLICE_COLOR, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.cutLines.renderOrder = 10;
    this.cutLines.frustumCulled = false;
    this.helper.add(this.planeMesh, this.cutLines);
    this.helper.visible = false;
    space.add(this.helper);
  }

  /** Largest model dimension in model units. */
  get modelExtent(): number {
    return this.extent;
  }
  get isEnabled(): boolean {
    return this.enabled;
  }
  get currentAxis(): CTAxis {
    return this.axis;
  }
  get position(): number {
    return this.t;
  }
  get current(): CTSlice | null {
    return this.enabled ? this.slice : null;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.helper.visible = on;
    for (const m of this.meshes) {
      for (const mat of materialsOf(m.mesh)) {
        mat.clippingPlanes = on ? [this.worldPlane] : null;
        // Show the inside of the cut shells.
        mat.side = on ? THREE.DoubleSide : THREE.FrontSide;
        mat.needsUpdate = true;
      }
    }
    this.dirty = true;
  }

  setAxis(axis: CTAxis): void {
    this.axis = axis;
    this.dirty = true;
  }

  setPosition(t: number): void {
    this.t = THREE.MathUtils.clamp(t, 0, 1);
    this.dirty = true;
  }

  /** Is a world-space point on the visible (kept) side of the cut? */
  isVisible(worldPoint: THREE.Vector3): boolean {
    return !this.enabled || this.worldPlane.distanceToPoint(worldPoint) >= -1e-4;
  }

  /** Image-plane basis for the current axis (radiological conventions). */
  basis(): { n: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; keep: THREE.Vector3 } {
    const { anterior: A, left: L, superior: S } = this.frame;
    switch (this.axis) {
      case 'axial': // viewed from the feet: patient's left on image right, anterior up
        return { n: S, u: L, v: A, keep: S.clone().negate() };
      case 'coronal': // viewed from the front: patient's left on image right, superior up
        return { n: A, u: L, v: S, keep: A.clone().negate() };
      case 'sagittal': // viewed from the left: anterior on image left, superior up
        return { n: L, u: A.clone().negate(), v: S, keep: L.clone().negate() };
    }
  }

  /** Call every frame (after the model's transforms are updated). */
  update(dt: number, animating: boolean): void {
    if (!this.enabled) return;
    const { n, keep } = this.basis();

    // Slice offset along n within the model's extent.
    const [lo, hi] = projectBox(this.modelBox, n);
    const offset = THREE.MathUtils.lerp(lo + (hi - lo) * 0.02, hi - (hi - lo) * 0.02, this.t);

    // 3D plane helper (model space).
    this.planeMesh.position.copy(n).multiplyScalar(offset);
    this.planeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);

    // Clipping plane in world space: keep the side opposite to n, cut exactly at the slice.
    this.space.updateMatrixWorld();
    const local = new THREE.Plane(keep.clone(), offset + 0.002 * this.extent);
    this.worldPlane.copy(local).applyMatrix4(this.space.matrixWorld);

    // Recompute the cross-section when the slice moves, or ~12×/s while the model animates.
    this.sinceCompute += dt;
    if (this.dirty || (animating && this.sinceCompute > 1 / 12)) {
      this.compute(offset);
      this.dirty = false;
      this.sinceCompute = 0;
    }
  }

  private compute(offset: number): void {
    const { n, u, v } = this.basis();
    const spaceInv = this.space.matrixWorld.clone().invert();
    const plane = new THREE.Plane(n.clone(), -offset);
    const lines: number[] = [];
    const meshes: CTSliceMesh[] = [];

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const pts: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3()];

    for (const md of this.meshes) {
      if (!md.mesh.visible) continue;
      const rel = spaceInv.clone().multiply(md.mesh.matrixWorld);
      const localPlane = plane.clone().applyMatrix4(rel.clone().invert());
      if (!localPlane.intersectsBox(md.box)) continue;

      const { pos, index } = md;
      const triCount = index ? index.length / 3 : pos.length / 9;
      const segs: number[] = []; // u0 v0 u1 v1 …
      const nx = localPlane.normal.x, ny = localPlane.normal.y, nz = localPlane.normal.z, k = localPlane.constant;
      const dist = (i: number) => pos[i * 3] * nx + pos[i * 3 + 1] * ny + pos[i * 3 + 2] * nz + k;

      for (let t = 0; t < triCount; t++) {
        const i0 = index ? index[t * 3] : t * 3;
        const i1 = index ? index[t * 3 + 1] : t * 3 + 1;
        const i2 = index ? index[t * 3 + 2] : t * 3 + 2;
        const d0 = dist(i0), d1 = dist(i1), d2 = dist(i2);
        if ((d0 > 0 && d1 > 0 && d2 > 0) || (d0 < 0 && d1 < 0 && d2 < 0)) continue;

        let found = 0;
        const edge = (ia: number, ib: number, da: number, db: number) => {
          if (found >= 2 || da > 0 === db > 0) return;
          const s = da / (da - db);
          a.set(pos[ia * 3], pos[ia * 3 + 1], pos[ia * 3 + 2]);
          b.set(pos[ib * 3], pos[ib * 3 + 1], pos[ib * 3 + 2]);
          pts[found++].copy(a).lerp(b, s);
        };
        edge(i0, i1, d0, d1);
        edge(i1, i2, d1, d2);
        edge(i2, i0, d2, d0);
        if (found < 2) continue;

        for (const p of pts) {
          c.copy(p).applyMatrix4(rel);
          lines.push(c.x, c.y, c.z);
          segs.push(c.dot(u), c.dot(v));
        }
      }
      if (segs.length) {
        meshes.push({ name: md.mesh.name, key: md.key, loops: chainLoops(segs), segs: new Float32Array(segs) });
      }
    }

    const geo = this.cutLines.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    geo.computeBoundingSphere();

    this.slice = { axis: this.axis, t: this.t, offset, meshes, version: ++this.version };
  }

  dispose(): void {
    this.setEnabled(false);
    this.helper.removeFromParent();
  }
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function projectBox(box: THREE.Box3, n: THREE.Vector3): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z,
    );
    const d = p.dot(n);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/**
 * Joins unordered 2D segments into polylines/loops by matching endpoints.
 * Endpoints match exactly (hashed); if a chain can't continue, the nearest
 * free endpoint within `tol` is snapped on (patches of one surface stored in
 * separate, separately-quantised meshes meet only approximately).
 */
export function chainLoops(segs: ArrayLike<number>, tol = 0): Float32Array[] {
  const n = segs.length / 4;
  const key = (x: number, y: number) => `${Math.round(x * 2e4)},${Math.round(y * 2e4)}`;
  const byPoint = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    for (const e of [0, 1]) {
      const k = key(segs[i * 4 + e * 2], segs[i * 4 + e * 2 + 1]);
      const list = byPoint.get(k);
      if (list) list.push(i);
      else byPoint.set(k, [i]);
    }
  }
  const used = new Uint8Array(n);
  const tol2 = tol * tol;

  /** Next segment continuing from (cx, cy): returns [index, endpoint it attaches by]. */
  const next = (cx: number, cy: number): [number, 0 | 1] | null => {
    const cands = byPoint.get(key(cx, cy));
    const exact = cands?.find((i) => !used[i]);
    if (exact !== undefined) {
      return [exact, key(segs[exact * 4], segs[exact * 4 + 1]) === key(cx, cy) ? 0 : 1];
    }
    if (!tol) return null;
    let best: [number, 0 | 1] | null = null;
    let bestD = tol2;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      for (const e of [0, 1] as const) {
        const d = (segs[i * 4 + e * 2] - cx) ** 2 + (segs[i * 4 + e * 2 + 1] - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = [i, e];
        }
      }
    }
    return best;
  };

  const loops: Float32Array[] = [];
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const out = [segs[s * 4], segs[s * 4 + 1], segs[s * 4 + 2], segs[s * 4 + 3]];
    let cx = segs[s * 4 + 2], cy = segs[s * 4 + 3];
    for (;;) {
      const nx = next(cx, cy);
      if (!nx) break;
      const [i, e] = nx;
      used[i] = 1;
      // Continue from the segment's other end.
      cx = segs[i * 4 + (1 - e) * 2];
      cy = segs[i * 4 + (1 - e) * 2 + 1];
      out.push(cx, cy);
    }
    if (out.length >= 6) loops.push(new Float32Array(out));
  }
  return loops;
}
