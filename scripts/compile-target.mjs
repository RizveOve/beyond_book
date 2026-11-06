// Compiles an image into a MindAR .mind file by running MindAR's browser
// compiler in headless Chrome (served by a temporary Vite dev server).
//
//   node scripts/compile-target.mjs [image=public/targets/heart-page.png] [out=public/targets/heart.mind]
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { chromePath } from './chrome-path.mjs';

const root = resolve(import.meta.dirname, '..');
const image = resolve(process.argv[2] ?? 'public/targets/heart-page.png');
const out = resolve(process.argv[3] ?? 'public/targets/heart.mind');

const publicDir = resolve(root, 'public');
const rel = relative(publicDir, image);
if (rel.startsWith('..')) throw new Error('Image must live inside public/ so the dev server can serve it.');

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
  console.log(`Compiling ${rel} …`);
  const t0 = Date.now();
  const b64 = await page.evaluate((u) => window.__compileTarget(u), `/${rel.split('\\').join('/')}`);
  const bytes = Buffer.from(b64, 'base64');
  await writeFile(out, bytes);
  console.log(`Wrote ${out} (${(bytes.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} finally {
  await browser.close();
  await server.close();
}
