import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { CTConfig } from '../content/ctProfiles';
import { partKeyFromMeshName, type PartInfo } from '../content/parts';
import { CTScanner } from './CTScanner';

type BeatRole = 'atrium' | 'ventricle';

interface PartState {
  key: string;
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  label: CSS2DObject | null;
}

interface MeshState {
  mesh: THREE.Mesh;
  basePos: THREE.Vector3;
  /** Offset (in the mesh's parent space) applied at full explode. */
  explodeOffset: THREE.Vector3;
}

const ZOOM_MIN = 0.35;
const ZOOM_MAX = 5;

export interface ModelOptions {
  /** Animate a "lub-dub" heartbeat on meshes named *Atrium / *Ventricle. */
  heartbeat?: boolean;
  /** Parts lying on the model's surface; in explode view they peel straight forward. */
  surfaceParts?: string[];
  /** How far parts move apart in explode view, as a fraction of the model size. */
  explodeDistance?: number;
  /** Turn the model by this many radians when exploding (to show splits along the view axis). */
  explodeTurn?: number;
  /** Enables the virtual CT scan view. */
  ct?: CTConfig | null;
  /** Paint each part in its `PartInfo.color` instead of the model's own materials. */
  partColors?: boolean;
  /** Colour overrides by mesh-name pattern (checked first), e.g. fat deposits. */
  meshColors?: [RegExp, string][];
}

/**
 * Everything about the 3D model that is shared between AR mode and 3D preview:
 * loading/normalising the GLB, the heartbeat animation, tap-to-select with a
 * focus (x-ray) effect, labels, exploded view, auto-rotate and zoom.
 *
 * Scene graph:  root (placed by caller) → spinner (user rotation) → scaler (zoom) → model
 */
export class ModelExperience {
  readonly root = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly scaler = new THREE.Group();
  private readonly partsInfo: Record<string, PartInfo>;
  private readonly options: Required<ModelOptions>;
  private model: THREE.Object3D | null = null;
  private scanner: CTScanner | null = null;
  private loading: Promise<void> | null = null;
  private size = 1;
  private readonly extent = new THREE.Vector3(1, 1, 1);

  private readonly parts = new Map<string, PartState>();
  private readonly meshStates: MeshState[] = [];
  private readonly beatTargets: { obj: THREE.Object3D; base: THREE.Vector3; role: BeatRole }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private selectedKey: string | null = null;
  private selectListener: ((partKey: string | null) => void) | null = null;

  private beating = true;
  private bpm = 72;
  private beatPhase = 0;
  private autoRotate = false;
  private labelsOn = false;
  private explodeTarget = 0;
  private explodeT = 0;
  private zoomTarget = 1;
  private spinTarget = 0;
  private tiltTarget = 0;

  constructor(partsInfo: Record<string, PartInfo>, options: ModelOptions = {}) {
    this.partsInfo = partsInfo;
    this.options = {
      heartbeat: false,
      surfaceParts: [],
      explodeDistance: 0.32,
      explodeTurn: 0,
      ct: null,
      partColors: false,
      meshColors: [],
      ...options,
    };
    this.beating = this.options.heartbeat;
    this.root.name = 'HeartRoot';
    this.root.add(this.spinner);
    this.spinner.add(this.scaler);
  }

  /**
   * Loads the GLB and scales it so its largest side equals `size` scene units.
   * Safe to call repeatedly (e.g. React StrictMode remounts): loads only once.
   */
  load(url: string, size: number): Promise<void> {
    this.loading ??= this.loadOnce(url, size);
    return this.loading;
  }

  private async loadOnce(url: string, size: number): Promise<void> {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    const model = gltf.scene;
    this.size = size;

    // Normalise: centre on origin and fit to `size`.
    const box = new THREE.Box3().setFromObject(model);
    const dims = box.getSize(new THREE.Vector3());
    const scale = size / Math.max(dims.x, dims.y, dims.z);
    this.extent.copy(dims).multiplyScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    model.position.copy(center).multiplyScalar(-scale);
    model.scale.setScalar(scale);
    model.updateMatrixWorld(true);

    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const key = partKeyFromMeshName(obj.name);

      // Own material instances per mesh, so focus/highlight affects one part only.
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]).map((m) =>
        m.clone(),
      );
      obj.material = Array.isArray(obj.material) ? mats : mats[0];

      // Colour-code parts so each component is easy to tell apart.
      if (this.options.partColors) {
        const color =
          this.options.meshColors.find(([re]) => re.test(obj.name))?.[1] ?? this.partsInfo[key]?.color;
        if (color) for (const m of mats) if ('color' in m) (m.color as THREE.Color).set(color);
      }

      const part = this.parts.get(key) ?? { key, meshes: [], materials: [], label: null };
      part.meshes.push(obj);
      part.materials.push(...mats.filter((m): m is THREE.MeshStandardMaterial => 'emissive' in m));
      this.parts.set(key, part);

      // Chambers contract; vessels stay put (their geometry isn't centred on
      // the mesh origin, so scaling them would look wrong).
      if (!this.options.heartbeat) return;
      if (key === 'LeftVentricle' || key === 'RightVentricle') {
        this.beatTargets.push({ obj, base: obj.scale.clone(), role: 'ventricle' });
      } else if (key === 'LeftAtrium' || key === 'RightAtrium') {
        this.beatTargets.push({ obj, base: obj.scale.clone(), role: 'atrium' });
      }
    });

    this.setupExplode();
    this.setupLabels();

    // Heart model without named chambers: pulse the whole thing.
    if (this.options.heartbeat && this.beatTargets.length === 0) {
      this.beatTargets.push({ obj: model, base: model.scale.clone(), role: 'ventricle' });
    }

    this.model = model;
    this.scaler.add(model);
    if (this.options.ct) this.scanner = new CTScanner(this.scaler, model, this.options.ct.frame);
  }

  /**
   * Each part moves away from the model centre. Meshes named `*_LH` / `*_RH`
   * (left/right hemisphere) instead move together sideways, so each half stays
   * whole and the model splits open down the middle.
   */
  private setupExplode(): void {
    const dist = this.size * this.options.explodeDistance;
    const surface = new Set(this.options.surfaceParts);
    for (const part of this.parts.values()) {
      const box = new THREE.Box3();
      part.meshes.forEach((m) => box.expandByObject(m));
      const c = box.getCenter(new THREE.Vector3());

      let dir: THREE.Vector3;
      if (surface.has(part.key)) {
        dir = new THREE.Vector3(0, 0, 1).multiplyScalar(dist * 1.4);
      } else {
        dir = c.lengthSq() < 1e-6 ? new THREE.Vector3(0, -1, 0) : c.clone().normalize();
        dir.multiplyScalar(dist);
      }

      for (const mesh of part.meshes) {
        const parent = mesh.parent!;
        const side = /_LH$/.test(mesh.name) ? 1 : /_RH$/.test(mesh.name) ? -1 : 0;
        const meshDir = side ? new THREE.Vector3(0, 0, side * dist * 1.6) : dir;
        const a = parent.worldToLocal(c.clone());
        const b = parent.worldToLocal(c.clone().add(meshDir));
        this.meshStates.push({
          mesh,
          basePos: mesh.position.clone(),
          explodeOffset: b.sub(a),
        });
      }
    }
  }

  /** One clickable label per known part, attached to that part so it follows explode. */
  private setupLabels(): void {
    for (const part of this.parts.values()) {
      const info = this.partsInfo[part.key];
      if (!info) continue;
      // Prefer the mesh named exactly after the part (the main body).
      const anchorMesh = part.meshes.find((m) => m.name === part.key) ?? part.meshes[0];
      const box = new THREE.Box3();
      part.meshes.forEach((m) => box.expandByObject(m));
      const p = box.getCenter(new THREE.Vector3());
      p.z = box.max.z; // front-most, so the label sits on the visible side

      const el = document.createElement('button');
      el.className = 'part-label';
      if (this.options.partColors) {
        const dot = document.createElement('span');
        dot.className = 'part-label__dot';
        dot.style.background = info.color;
        el.append(dot);
      }
      el.append(info.name);
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(part.key === this.selectedKey ? null : part.key);
      });

      const label = new CSS2DObject(el);
      label.position.copy(anchorMesh.worldToLocal(p));
      label.visible = false;
      anchorMesh.add(label);
      part.label = label;
    }
  }

  /** Advance animations. Call once per frame. */
  update(dt: number): void {
    dt = Math.min(dt, 0.1);
    if (this.beating) this.beatPhase = (this.beatPhase + (dt * this.bpm) / 60) % 1;
    const p = this.beatPhase;
    // "Lub-dub": atria squeeze first, then the ventricles.
    const atrium = this.beating ? pulse(p, 0.0, 0.16) * 0.07 : 0;
    const ventricle = this.beating ? pulse(p, 0.14, 0.42) * 0.06 : 0;
    for (const t of this.beatTargets) {
      const s = 1 - (t.role === 'atrium' ? atrium : ventricle);
      t.obj.scale.set(t.base.x * s, t.base.y * s, t.base.z * s);
    }

    const ease = 1 - Math.exp(-dt * 8);

    // Exploded view.
    this.explodeT += (this.explodeTarget - this.explodeT) * ease;
    const e = smoothstep(this.explodeT);
    for (const m of this.meshStates) {
      m.mesh.position.copy(m.basePos).addScaledVector(m.explodeOffset, e);
    }

    // Rotation & zoom (smoothed).
    if (this.autoRotate) this.spinTarget += dt * 0.6;
    this.spinner.rotation.y += (this.spinTarget - this.spinner.rotation.y) * ease;
    this.spinner.rotation.x += (this.tiltTarget - this.spinner.rotation.x) * ease;
    const z = this.scaler.scale.x + (this.zoomTarget - this.scaler.scale.x) * ease;
    this.scaler.scale.setScalar(z);

    // CT slice follows the animated (beating / exploding) model.
    const animating = this.beating || Math.abs(this.explodeTarget - this.explodeT) > 1e-3;
    this.scanner?.update(dt, animating);

    // Gentle glow pulse on the selected part.
    if (this.selectedKey) {
      const glow = 0.18 + 0.12 * Math.sin(performance.now() / 180);
      this.parts.get(this.selectedKey)?.materials.forEach((m) => (m.emissiveIntensity = glow));
    }
  }

  /** Raycast from normalised device coords; selects the tapped part (or clears). */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): string | null {
    if (!this.model) return null;
    this.raycaster.setFromCamera(ndc, camera);
    // When focusing a part, faded parts shouldn't block taps on the focused one.
    // Ignore anything cut away by the CT plane (raycasts don't know about clipping).
    const hits = this.raycaster
      .intersectObject(this.model, true)
      .filter((h) => !this.scanner || this.scanner.isVisible(h.point));
    const hit = this.selectedKey
      ? (hits.find((h) => partKeyFromMeshName(h.object.name) === this.selectedKey) ?? hits[0])
      : hits[0];
    const key = hit ? partKeyFromMeshName(hit.object.name) : null;
    this.select(key && key === this.selectedKey ? null : key);
    return this.selectedKey;
  }

  select(key: string | null): void {
    this.selectedKey = key && this.partsInfo[key] && this.parts.has(key) ? key : null;

    // Focus mode: the selected part glows white, everything else turns to "glass".
    for (const part of this.parts.values()) {
      const focused = this.selectedKey === null || part.key === this.selectedKey;
      for (const m of part.materials) {
        m.transparent = !focused;
        m.opacity = focused ? 1 : 0.18;
        m.depthWrite = focused;
        m.emissive.setHex(part.key === this.selectedKey ? 0xffffff : 0x000000);
        m.emissiveIntensity = 1;
        m.needsUpdate = true;
      }
      part.label?.element.classList.toggle('is-active', part.key === this.selectedKey);
    }
    this.selectListener?.(this.selectedKey);
  }

  /** Virtual CT scanner (null if this model has no CT profile or isn't loaded yet). */
  get ct(): CTScanner | null {
    return this.scanner;
  }

  get ctConfig(): CTConfig | null {
    return this.options.ct;
  }

  /** Whether parts are colour-coded (shows the colour key). */
  get isColorCoded(): boolean {
    return this.options.partColors;
  }

  /** Known, tappable parts present in the loaded model (for the colour key). */
  get presentParts(): PartInfo[] {
    return [...this.parts.keys()].flatMap((k) => (this.partsInfo[k] ? [this.partsInfo[k]] : []));
  }

  get selectedPart(): string | null {
    return this.selectedKey;
  }

  get partInfo(): Record<string, PartInfo> {
    return this.partsInfo;
  }

  /** Model width/height/depth in scene units at zoom 1 (after normalising to `size`). */
  get dimensions(): THREE.Vector3 {
    return this.extent.clone();
  }

  /** Whether this model has a heartbeat animation at all. */
  get hasHeartbeat(): boolean {
    return this.options.heartbeat;
  }

  get isBeating(): boolean {
    return this.beating;
  }
  setBeating(on: boolean): void {
    this.beating = on;
  }

  get currentBpm(): number {
    return this.bpm;
  }
  setBpm(bpm: number): void {
    this.bpm = bpm;
  }

  get isAutoRotating(): boolean {
    return this.autoRotate;
  }
  setAutoRotate(on: boolean): void {
    this.autoRotate = on;
  }

  get isLabelsOn(): boolean {
    return this.labelsOn;
  }
  setLabels(on: boolean): void {
    this.labelsOn = on;
    for (const part of this.parts.values()) if (part.label) part.label.visible = on;
  }

  get isExploded(): boolean {
    return this.explodeTarget > 0.5;
  }
  setExploded(on: boolean): void {
    if (on !== this.isExploded) this.spinTarget += (on ? 1 : -1) * this.options.explodeTurn;
    this.explodeTarget = on ? 1 : 0;
  }

  /** Called whenever the selected part changes. */
  setSelectListener(fn: ((partKey: string | null) => void) | null): void {
    this.selectListener = fn;
  }

  /** Spin around the model's vertical axis. */
  rotateBy(radians: number): void {
    this.spinTarget += radians;
  }

  /** Tilt toward / away from the viewer (clamped so it never flips over). */
  tiltBy(radians: number): void {
    this.tiltTarget = THREE.MathUtils.clamp(this.tiltTarget + radians, -1.3, 1.3);
  }

  zoomBy(factor: number): void {
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * factor, ZOOM_MIN, ZOOM_MAX);
  }

  resetView(): void {
    // Unwind to the nearest full turn so reset doesn't spin wildly.
    const turns = Math.round(this.spinner.rotation.y / (Math.PI * 2));
    this.spinTarget = 0;
    this.tiltTarget = 0;
    this.spinner.rotation.y -= turns * Math.PI * 2;
    this.zoomTarget = 1;
    this.explodeTarget = 0;
    this.setAutoRotate(false);
    this.select(null);
  }
}

/** Smooth 0→1→0 bump between `start` and `end` of the cycle. */
function pulse(phase: number, start: number, end: number): number {
  if (phase < start || phase > end) return 0;
  const t = (phase - start) / (end - start);
  return Math.sin(t * Math.PI) ** 2;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Soft circular shadow texture to ground the model on the page. */
export function createContactShadow(radius: number): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.name = 'ContactShadow';
  return mesh;
}

/** Neutral studio lighting that reads well over a camera feed. */
export function addLights(scene: THREE.Object3D): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(0.5, 1, 1.2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-1, -0.2, 0.8);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2);
  rim.position.set(-1, 0.5, -1);
  scene.add(rim);
}
