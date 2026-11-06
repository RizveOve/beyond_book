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
    __compileTarget?: (urls: string[]) => Promise<string>;
  }
}
window.__compileTarget = async (urls) => {
  const bytes = await compileTargets(urls);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
};

// ---- Interactive UI ----
const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const previews = document.querySelector<HTMLDivElement>('#previews')!;
const button = document.querySelector<HTMLButtonElement>('#compile')!;
const progress = document.querySelector<HTMLProgressElement>('#progress')!;
const status = document.querySelector<HTMLParagraphElement>('#status')!;
let objectUrls: string[] = [];

fileInput.addEventListener('change', () => {
  const files = [...(fileInput.files ?? [])];
  if (!files.length) return;
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = files.map((f) => URL.createObjectURL(f));
  previews.replaceChildren(
    ...objectUrls.map((src, i) => {
      const img = document.createElement('img');
      img.src = src;
      img.alt = `Target ${i}: ${files[i].name}`;
      img.title = img.alt;
      return img;
    }),
  );
  button.disabled = false;
  status.textContent = files.length > 1 ? `${files.length} pages, tracked as targets 0–${files.length - 1}` : '';
});

button.addEventListener('click', async () => {
  if (!objectUrls.length) return;
  button.disabled = true;
  progress.hidden = false;
  status.textContent = 'Compiling… (this can take a minute)';
  try {
    const bytes = await compileTargets(objectUrls, (p) => (progress.value = p));
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pages.mind';
    a.click();
    status.textContent = `Done — ${(bytes.length / 1024).toFixed(0)} KB downloaded as pages.mind`;
  } catch (e) {
    status.textContent = `Failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    button.disabled = false;
  }
});
