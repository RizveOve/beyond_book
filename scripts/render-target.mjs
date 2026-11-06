// Renders every assets-src/*.svg page → public/targets/<name>.png using local Chrome.
//
//   node scripts/render-target.mjs            # all pages
//   node scripts/render-target.mjs brain-page # one page
import puppeteer from 'puppeteer-core';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';

const srcDir = new URL('../assets-src/', import.meta.url);
const outDir = new URL('../public/targets/', import.meta.url);
await mkdir(outDir, { recursive: true });

const only = process.argv[2];
const names = (await readdir(srcDir))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''))
  .filter((n) => !only || n === only);

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
for (const name of names) {
  const svg = await readFile(new URL(`${name}.svg`, srcDir), 'utf8');
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  const out = new URL(`${name}.png`, outDir).pathname;
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1240, height: 1754 } });
  console.log('Wrote', out);
}
await browser.close();
