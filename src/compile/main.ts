import { Compiler } from 'mind-ar/dist/mindar-image.prod.js';

/** Compiles one or more images into MindAR `.mind` bytes. */
export async function compileTargets(
  urls: string[],
  onProgress: (pct: number) => void = () => {},
): Promise<Uint8Array> {
  const images = await Promise.all(urls.map(loadImage));
  const compiler = new Compiler();
  await compiler.compileImageTargets(images, onProgress);
  return compiler.exportData();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Used by scripts/compile-target.mjs (headless Chrome) — returns base64.
declare global {
  interface Window {
    __compileTarget?: (url: string) => Promise<string>;
  }
}
window.__compileTarget = async (url) => {
  const bytes = await compileTargets([url]);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

// ---- Interactive UI ----
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const preview = document.querySelector<HTMLImageElement>('#preview')!;
const button = document.querySelector<HTMLButtonElement>('#compile')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
let objectUrl: string | null = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  preview.src = objectUrl;
  preview.hidden = false;
  button.disabled = false;
  status.textContent = '';
});

button.addEventListener('click', async () => {
  if (!objectUrl) return;
  button.disabled = true;
  progress.hidden = false;
  status.textContent = 'Compiling… (this can take a minute)';
  try {
    const bytes = await compileTargets([objectUrl], (p) => (progress.value = p));
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'heart.mind';
    a.click();
    status.textContent = `Done — ${(bytes.length / 1024).toFixed(0)} KB downloaded as heart.mind`;
  } catch (e) {
    status.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    button.disabled = false;
  }
});
