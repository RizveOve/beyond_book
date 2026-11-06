import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HEART_PARTS, partKeyFromMeshName } from '../content/heartParts';

export const HEART_MODEL_URL = `${import.meta.env.BASE_URL}models/heart.glb`;

interface PartMeshes {
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
}

type BeatRole = 'atrium' | 'ventricle';

/**
 * Everything about the heart that is shared between AR mode and 3D preview:
 * loading/normalising the GLB, the heartbeat animation, tap-to-select
 * highlighting and gesture-driven rotation/scale.
 *
 * Scene graph:  root (placed by caller) → spinner (user rotation) → scaler (user zoom) → model
 */
export class HeartExperience {
  readonly root = new THREE.Group();
  private readonly spinner = new THREE.Group();
  private readonly scaler = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private loading: Promise<void> | null = null;

  private readonly parts = new Map<string, PartMeshes>();
  private readonly beatTargets: { obj: THREE.Object3D; base: THREE.Vector3; role: BeatRole }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private selectedKey: string | null = null;

  private beating = true;
  private bpm = 72;
  private beatPhase = 0;
  private selectListener: ((partKey: string | null) => void) | null = null;

  constructor() {
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
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;

    // Normalise: centre on origin and fit to `size`.
    const box = new THREE.Box3().setFromObject(model);
    const dims = box.getSize(new THREE.Vector3());
    const scale = size / Math.max(dims.x, dims.y, dims.z);
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center).multiplyScalar(scale);
    model.scale.setScalar(scale);

    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const key = partKeyFromMeshName(obj.name);

      // Give every part its own material instances so highlighting one part
      // doesn't light up others that happen to share a material.
      const mats = (Array.isArray(obj.material) ? obj.material : [obj.material]).map((m) =>
        m.clone(),
      );
      obj.material = Array.isArray(obj.material) ? mats : mats[0];

      const entry = this.parts.get(key) ?? { meshes: [], materials: [] };
      entry.meshes.push(obj);
      entry.materials.push(
        ...mats.filter((m): m is THREE.MeshStandardMaterial => 'emissive' in m),
      );
      this.parts.set(key, entry);

      // Chambers contract; vessels stay put (their geometry isn't centred on
      // the mesh origin, so scaling them would look wrong).
      if (key === 'LeftVentricle' || key === 'RightVentricle') {
        this.beatTargets.push({ obj, base: obj.scale.clone(), role: 'ventricle' });
      } else if (key === 'LeftAtrium' || key === 'RightAtrium') {
        this.beatTargets.push({ obj, base: obj.scale.clone(), role: 'atrium' });
      }
    });

    // Unknown model (no named chambers): pulse the whole thing.
    if (this.beatTargets.length === 0) {
      this.beatTargets.push({ obj: model, base: model.scale.clone(), role: 'ventricle' });
    }

    this.model = model;
    this.scaler.add(model);
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

  /** Called whenever the selected part changes. */
  setSelectListener(fn: ((partKey: string | null) => void) | null): void {
    this.selectListener = fn;
  }

  /** Advance animations. Call once per frame. */
  update(dt: number): void {
    if (this.beating) {
      this.beatPhase = (this.beatPhase + (dt * this.bpm) / 60) % 1;
    }
    const p = this.beatPhase;
    // "Lub-dub": atria squeeze first, then the ventricles.
    const atrium = this.beating ? pulse(p, 0.0, 0.16) * 0.07 : 0;
    const ventricle = this.beating ? pulse(p, 0.14, 0.42) * 0.06 : 0;

    for (const t of this.beatTargets) {
      const s = 1 - (t.role === 'atrium' ? atrium : ventricle);
      t.obj.scale.set(t.base.x * s, t.base.y * s, t.base.z * s);
    }

    // Gentle glow pulse on the selected part.
    if (this.selectedKey) {
      const glow = 0.25 + 0.15 * Math.sin(performance.now() / 180);
      this.parts.get(this.selectedKey)?.materials.forEach((m) => m.emissiveIntensity = glow);
    }
  }

  /** Raycast from normalised device coords; selects the tapped part (or clears). */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): string | null {
    if (!this.model) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(this.model, true)[0];
    const key = hit ? partKeyFromMeshName(hit.object.name) : null;
    this.select(key && key === this.selectedKey ? null : key);
    return this.selectedKey;
  }

  select(key: string | null): void {
    if (this.selectedKey) {
      this.parts.get(this.selectedKey)?.materials.forEach((m) => {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 1;
      });
    }
    this.selectedKey = key && this.parts.has(key) ? key : null;
    if (this.selectedKey) {
      this.parts.get(this.selectedKey)?.materials.forEach((m) => m.emissive.setHex(0xffe08a));
    }
    this.selectListener?.(this.selectedKey);
  }

  /** Known, tappable part keys present in the loaded model. */
  get partKeys(): string[] {
    return [...this.parts.keys()].filter((k) => k in HEART_PARTS);
  }

  rotateBy(radians: number): void {
    this.spinner.rotation.y += radians;
  }

  zoomBy(factor: number): void {
    const s = THREE.MathUtils.clamp(this.scaler.scale.x * factor, 0.4, 3);
    this.scaler.scale.setScalar(s);
  }

  resetView(): void {
    this.spinner.rotation.set(0, 0, 0);
    this.scaler.scale.setScalar(1);
    this.select(null);
  }
}

/** Smooth 0→1→0 bump between `start` and `end` of the cycle. */
function pulse(phase: number, start: number, end: number): number {
  if (phase < start || phase > end) return 0;
  const t = (phase - start) / (end - start);
  return Math.sin(t * Math.PI) ** 2;
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

/** Standard studio-ish lighting that reads well over a camera feed. */
export function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x553333, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.5, 1, 1.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd6cc, 1.0);
  rim.position.set(-1, 0.5, -1);
  scene.add(rim);
}
