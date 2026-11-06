import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { Controller, type MindARUpdate } from 'mind-ar/dist/mindar-image.prod.js';

/**
 * A small, typed port of MindAR's `MindARThree` helper.
 *
 * MindAR's bundled three.js wrapper imports `sRGBEncoding`, which was removed
 * from modern three.js, so we drive MindAR's tracking `Controller` directly and
 * keep all rendering on the app's own three.js version.
 */

export interface Anchor {
  group: THREE.Group;
  targetIndex: number;
  visible: boolean;
  onTargetFound?: () => void;
  onTargetLost?: () => void;
}

export interface MindARThreeOptions {
  container: HTMLElement;
  imageTargetSrc: string;
  maxTrack?: number;
  /** Lower = smoother but laggier pose (MindAR default 0.001). */
  filterMinCF?: number;
  /** Higher = more responsive to fast motion (MindAR default 1000). */
  filterBeta?: number;
  warmupTolerance?: number;
  missTolerance?: number;
}

export class MindARThree {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  readonly renderer: THREE.WebGLRenderer;
  /** HTML overlay for labels attached to 3D objects (CSS2DObject). */
  readonly labelRenderer = new CSS2DRenderer();

  private readonly container: HTMLElement;
  private readonly options: MindARThreeOptions;
  private readonly anchors: Anchor[] = [];
  private postMatrices: THREE.Matrix4[] = [];
  private video: HTMLVideoElement | null = null;
  private controller: Controller | null = null;
  private stopped = false;
  private readonly onResize = () => this.resize();

  constructor(options: MindARThreeOptions) {
    this.options = options;
    this.container = options.container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true; // CT cutaway
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      zIndex: '1',
    });
    this.container.appendChild(this.renderer.domElement);
    Object.assign(this.labelRenderer.domElement.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      zIndex: '2',
      pointerEvents: 'none',
    });
    this.container.appendChild(this.labelRenderer.domElement);
    window.addEventListener('resize', this.onResize);
  }

  /** Renders the 3D scene and the label overlay. */
  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  addAnchor(targetIndex: number): Anchor {
    const group = new THREE.Group();
    group.visible = false;
    group.matrixAutoUpdate = false;
    const anchor: Anchor = { group, targetIndex, visible: false };
    this.anchors.push(anchor);
    this.scene.add(group);
    return anchor;
  }

  /** Starts the camera, loads the `.mind` targets and begins tracking. */
  async start(): Promise<void> {
    await this.startVideo();
    if (this.stopped) return;
    await this.startTracking();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.stopProcessVideo();
    const stream = this.video?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    this.video?.remove();
    this.video = null;
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  private async startVideo(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Camera access is not available. Open this page over HTTPS in a modern mobile browser.',
      );
    }

    const video = document.createElement('video');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.muted = true;
    Object.assign(video.style, { position: 'absolute', top: '0', left: '0', zIndex: '0' });
    this.container.appendChild(video);
    this.video = video;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    await new Promise<void>((resolve) => {
      video.addEventListener(
        'loadedmetadata',
        () => {
          video.width = video.videoWidth;
          video.height = video.videoHeight;
          resolve();
        },
        { once: true },
      );
      video.srcObject = stream;
    });
    await video.play().catch(() => undefined);
  }

  private async startTracking(): Promise<void> {
    const video = this.video;
    if (!video) return;
    const { filterMinCF, filterBeta, warmupTolerance, missTolerance, maxTrack = 1 } = this.options;

    const controller = new Controller({
      inputWidth: video.videoWidth,
      inputHeight: video.videoHeight,
      maxTrack,
      filterMinCF: filterMinCF ?? null,
      filterBeta: filterBeta ?? null,
      warmupTolerance: warmupTolerance ?? null,
      missTolerance: missTolerance ?? null,
      onUpdate: (data) => this.handleUpdate(data),
    });
    this.controller = controller;
    this.resize();

    const { dimensions } = await controller.addImageTargets(this.options.imageTargetSrc);

    // MindAR reports poses in target-pixel units with the origin at the image's
    // bottom-left corner. Re-centre and normalise so 1 unit == target width.
    this.postMatrices = dimensions.map(([w, h]) => {
      const m = new THREE.Matrix4();
      m.compose(
        new THREE.Vector3(w / 2, w / 2 + (h - w) / 2, 0),
        new THREE.Quaternion(),
        new THREE.Vector3(w, w, w),
      );
      return m;
    });

    await controller.dummyRun(video);
    if (this.stopped) return;
    controller.processVideo(video);
  }

  private handleUpdate(data: MindARUpdate): void {
    if (data.type !== 'updateMatrix') return;
    const { targetIndex, worldMatrix } = data as {
      targetIndex: number;
      worldMatrix: number[] | null;
    };

    for (const anchor of this.anchors) {
      if (anchor.targetIndex !== targetIndex) continue;
      const found = worldMatrix !== null;
      anchor.group.visible = found;

      if (found) {
        const m = new THREE.Matrix4();
        m.fromArray(worldMatrix);
        m.multiply(this.postMatrices[targetIndex]);
        anchor.group.matrix.copy(m);
        anchor.group.matrixWorldNeedsUpdate = true;
      }

      if (found && !anchor.visible) {
        anchor.visible = true;
        anchor.onTargetFound?.();
      } else if (!found && anchor.visible) {
        anchor.visible = false;
        anchor.onTargetLost?.();
      }
    }
  }

  /** Fits the video "cover"-style and matches the three.js camera to MindAR's projection. */
  resize(): void {
    const { container, renderer, camera, video, controller } = this;
    if (!video || !controller) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = cw / ch;

    let vw: number;
    let vh: number;
    if (videoRatio > containerRatio) {
      vh = ch;
      vw = vh * videoRatio;
    } else {
      vw = cw;
      vh = vw / videoRatio;
    }

    const proj = controller.getProjectionMatrix();
    const inputRatio = controller.inputWidth / controller.inputHeight;
    let videoDisplayHeight: number;
    if (inputRatio > containerRatio) {
      videoDisplayHeight = ch * (video.width / controller.inputWidth);
    } else {
      videoDisplayHeight =
        (cw / controller.inputWidth) * controller.inputHeight * (video.height / controller.inputHeight);
    }
    const fovAdjust = ch / videoDisplayHeight;

    camera.fov = ((2 * Math.atan((1 / proj[5]) * fovAdjust)) * 180) / Math.PI;
    camera.near = proj[14] / (proj[10] - 1.0);
    camera.far = proj[14] / (proj[10] + 1.0);
    camera.aspect = cw / ch;
    camera.updateProjectionMatrix();

    Object.assign(video.style, {
      top: `${-(vh - ch) / 2}px`,
      left: `${-(vw - cw) / 2}px`,
      width: `${vw}px`,
      height: `${vh}px`,
    });

    renderer.setSize(cw, ch);
    this.labelRenderer.setSize(cw, ch);
  }
}
