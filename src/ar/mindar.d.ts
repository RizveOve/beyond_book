// Minimal type declarations for the parts of MindAR's image-tracking build we use.
declare module 'mind-ar/dist/mindar-image.prod.js' {
  export type MindARUpdate =
    | { type: 'updateMatrix'; targetIndex: number; worldMatrix: number[] | null }
    | { type: 'processDone' }
    | { type: string; [key: string]: unknown };

  export interface ControllerOptions {
    inputWidth: number;
    inputHeight: number;
    onUpdate?: (data: MindARUpdate) => void;
    maxTrack?: number;
    filterMinCF?: number | null;
    filterBeta?: number | null;
    warmupTolerance?: number | null;
    missTolerance?: number | null;
  }

  export class Controller {
    constructor(options: ControllerOptions);
    inputWidth: number;
    inputHeight: number;
    addImageTargets(url: string): Promise<{ dimensions: [number, number][] }>;
    dummyRun(input: HTMLVideoElement): Promise<void>;
    processVideo(input: HTMLVideoElement): void;
    stopProcessVideo(): void;
    getProjectionMatrix(): number[];
  }

  export class Compiler {
    compileImageTargets(
      images: HTMLImageElement[],
      progress: (percent: number) => void,
    ): Promise<unknown[]>;
    exportData(): Uint8Array;
  }
}
