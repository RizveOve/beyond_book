// Compiles page images into one MindAR .mind file by running MindAR's browser
// compiler in headless Chrome (served by a temporary Vite dev server).
// Image order = target index (must match TARGETS in src/content/targets.ts).
//
//   node scripts/compile-target.mjs [images...] [--out public/targets/pages.mind]
//   (defaults: public/targets/heart-page.png public/targets/brain-page.png)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { chromePath } from './chrome-path.mjs';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 ? args.splice(outIdx, 2)[1] : 'public/targets/pages.mind');
const images = (args.length ? args : ['public/targets/heart-page.png', 'public/targets/brain-page.png']).map((p) =>
  resolve(p),
);

const publicDir = resolve(root, 'public');
const urls = images.map((image) => {
  const rel = relative(publicDir, image);
  if (rel.startsWith('..')) throw new Error(`${image} must live inside public/ so the dev server can serve it.`);
  return `/${rel.split('\\').join('/')}`;
});

process.env.NO_SSL = '1';
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, protocolTimeout: 600_000 });
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${base}compile.html`, { waitUntil: 'networkidle0', timeout: 120_000 });
  await page.waitForFunction(() => typeof window.__compileTarget === 'function', { timeout: 120_000 });
  urls.forEach((u, i) => console.log(`  target ${i}: ${u}`));
  const t0 = Date.now();
  const b64 = await page.evaluate((u) => window.__compileTarget(u), urls);
  const bytes = Buffer.from(b64, 'base64');
  await writeFile(out, bytes);
  console.log(`Wrote ${out} (${(bytes.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  await server.close();
}
