// Renders assets-src/heart-page.svg -> public/targets/heart-page.png using local Chrome.
import puppeteer from 'puppeteer-core';
import { readFile, mkdir } from 'node:fs/promises';
import { chromePath } from './chrome-path.mjs';

const svg = await readFile(new URL('../assets-src/heart-page.svg', import.meta.url), 'utf8');
await mkdir(new URL('../public/targets/', import.meta.url), { recursive: true });

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1240, height: 1754, deviceScaleFactor: 1 });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
const out = new URL('../public/targets/heart-page.png', import.meta.url).pathname;
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1240, height: 1754 } });
await browser.close();
console.log('Wrote', out);
