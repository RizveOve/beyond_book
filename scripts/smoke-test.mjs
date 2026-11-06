// End-to-end smoke test without a phone:
//  1. Renders fake "camera frames": the printed page on a desk, and the empty desk
//  2. Encodes a looping .y4m video (page → desk → page …) used as Chrome's fake webcam
//  3. Opens the app, starts AR and checks that:
//       - MindAR locks on to the page
//       - when the page leaves view, the heart stays on screen ("Free view")
//       - tapping selects a part; labels & explode work
//       - the heart re-anchors when the page comes back
//  4. Checks the camera-free 3D preview
//  Screenshots are saved to ./smoke-output/
//
//   node scripts/smoke-test.mjs
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromePath } from './chrome-path.mjs';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'smoke-output');
await mkdir(outDir, { recursive: true });

const W = 960;
const H = 540;
const FPS = 10;
const PAGE_SECONDS = 5;
const EMPTY_SECONDS = 10;

// ---------- 1. Fake camera frames ----------
async function renderFrame(browser, withPage) {
  const png = await readFile(resolve(root, 'public/targets/heart-page.png'));
  const page = await browser.newPage();
  const rgba = await page.evaluate(
    async (dataUrl, W, H, withPage) => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      // Wooden desk (deterministic grain so both frames share the same desk).
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(40,25,10,${0.05 + rand() * 0.1})`;
        ctx.beginPath();
        ctx.moveTo(0, rand() * H);
        ctx.bezierCurveTo(W / 3, rand() * H, (2 * W) / 3, rand() * H, W, rand() * H);
        ctx.stroke();
      }
      if (withPage) {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const ph = H * 0.92;
        const pw = (ph * img.width) / img.height;
        ctx.save();
        ctx.translate(W / 2, H / 2);
        ctx.rotate(-0.06);
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 20;
        ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
        ctx.restore();
      }
      const data = ctx.getImageData(0, 0, W, H).data;
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    `data:image/png;base64,${png.toString('base64')}`,
    W,
    H,
    withPage,
  );
  await page.close();
  return Buffer.from(rgba, 'base64');
}

/** RGBA → planar I420 (BT.601) frame. */
function toI420(rgba) {
  const ySize = W * H;
  const cSize = (W / 2) * (H / 2);
  const frame = Buffer.alloc(ySize + 2 * cSize);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b] = [rgba[i], rgba[i + 1], rgba[i + 2]];
      frame[y * W + x] = Math.round(0.257 * r + 0.504 * g + 0.098 * b + 16);
      if (y % 2 === 0 && x % 2 === 0) {
        const ci = (y / 2) * (W / 2) + x / 2;
        frame[ySize + ci] = Math.round(-0.148 * r - 0.291 * g + 0.439 * b + 128);
        frame[ySize + cSize + ci] = Math.round(0.439 * r - 0.368 * g - 0.071 * b + 128);
      }
    }
  }
  return frame;
}

function y4m(segments) {
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
  const fh = Buffer.from('FRAME\n');
  for (const [frame, count] of segments) for (let i = 0; i < count; i++) parts.push(fh, frame);
  return Buffer.concat(parts);
}

// ---------- 2. Build fake webcam video ----------
const helper = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const pageFrame = toI420(await renderFrame(helper, true));
const deskFrame = toI420(await renderFrame(helper, false));
await helper.close();
const y4mPath = resolve(outDir, 'fake-camera.y4m');
await writeFile(y4mPath, y4m([[pageFrame, PAGE_SECONDS * FPS], [deskFrame, EMPTY_SECONDS * FPS]]));
console.log(`Fake camera: ${PAGE_SECONDS}s page → ${EMPTY_SECONDS}s empty desk, looping`);

// ---------- 3. Run the app ----------
process.env.NO_SSL = '1'; // localhost is a secure context, no TLS needed
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const base = server.resolvedUrls.local[0];

const browser = await puppeteer.launch({
  executablePath: chromePath(),
  headless: true,
  protocolTimeout: 300_000,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4mPath}`,
    '--enable-unsafe-swiftshader',
  ],
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: resolve(outDir, name) });
let failed = false;
const check = (ok, msg) => {
  console.log(`${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) failed = true;
};

/** Taps around the screen centre until a part's info card appears. */
async function tapUntilSelected(page) {
  const vp = page.viewport();
  for (const [fx, fy] of [[0.5, 0.45], [0.52, 0.4], [0.45, 0.5], [0.55, 0.5], [0.5, 0.35], [0.5, 0.55]]) {
    await page.touchscreen.tap(vp.width * fx, vp.height * fy);
    if (await page.waitForSelector('.info-card', { timeout: 800 }).catch(() => null)) {
      return page.$eval('.info-card h2', (el) => el.textContent);
    }
  }
  return null;
}

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  // Phone-sized viewport (portrait), like a student holding a phone.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.goto(base, { waitUntil: 'networkidle0' });
  await shot(page, '1-home.png');

  await page.locator('button.primary').click();
  await page.waitForSelector('.status--tracking', { timeout: 180_000 });
  await wait(1200);
  await shot(page, '2-on-page.png');
  check(true, 'MindAR locked on to the page');

  // The page leaves the camera view → heart must stay on screen.
  await page.waitForSelector('.status--floating', { timeout: 60_000 });
  await wait(1200); // let it glide into place
  await shot(page, '3-free-view.png');
  check(true, 'Page lost → heart kept on screen in free view');

  const part = await tapUntilSelected(page);
  check(Boolean(part), `Tap selects a part in free view${part ? ` (${part})` : ''}`);
  await shot(page, '4-selected.png');

  await page.locator('.info-card button[aria-label="Close"]').click();
  await page.locator('::-p-text(Labels)').click();
  await page.locator('::-p-text(Explode)').click();
  await wait(1200);
  const labelCount = await page.$$eval('.part-label', (els) => els.filter((e) => e.style.display !== 'none').length);
  check(labelCount > 5, `Labels shown (${labelCount})`);
  await shot(page, '5-labels-exploded.png');
  await page.locator('::-p-text(Reset)').click();

  // Page comes back → re-anchors onto it.
  await page.waitForSelector('.status--tracking', { timeout: 60_000 });
  await wait(1200);
  await shot(page, '6-re-anchored.png');
  check(true, 'Page found again → heart re-anchored');

  // 3D preview (no camera)
  await page.locator('button[aria-label="Back"]').click();
  await page.locator('button.secondary').click();
  await page.waitForSelector('.hint', { timeout: 60_000 });
  await wait(800);
  await shot(page, '7-preview.png');
  check(true, '3D preview rendered');
} catch (e) {
  check(false, e.message);
} finally {
  await browser.close();
  await server.close();
}
console.log(`Screenshots in ${outDir}`);
process.exit(failed ? 1 : 0);
