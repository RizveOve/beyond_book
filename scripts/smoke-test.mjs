// End-to-end smoke test without a phone:
//  1. Renders a fake "camera frame" (the printed page lying on a desk, slightly tilted)
//  2. Encodes it as a .y4m video and feeds it to Chrome as a fake webcam
//  3. Opens the app, starts AR, waits for MindAR to lock on, taps the heart
//  4. Saves screenshots to ./smoke-output/
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

const W = 1280;
const H = 720;

// ---------- 1. Fake camera frame ----------
async function renderCameraFrame(browser) {
  const png = await readFile(resolve(root, 'public/targets/heart-page.png'));
  const page = await browser.newPage();
  const rgba = await page.evaluate(
    async (dataUrl, W, H) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const ctx = c.getContext('2d');
      // Wooden desk
      ctx.fillStyle = '#6b4a2f';
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 60; i++) {
        ctx.strokeStyle = `rgba(40,25,10,${0.05 + Math.random() * 0.1})`;
        ctx.beginPath();
        ctx.moveTo(0, Math.random() * H);
        ctx.bezierCurveTo(W / 3, Math.random() * H, (2 * W) / 3, Math.random() * H, W, Math.random() * H);
        ctx.stroke();
      }
      // Page, slightly rotated, filling most of the frame height
      const ph = H * 0.92;
      const pw = (ph * img.width) / img.height;
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-0.06);
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 20;
      ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
      ctx.restore();
      const data = ctx.getImageData(0, 0, W, H).data;
      // Return as base64 to keep the CDP payload small.
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    `data:image/png;base64,${png.toString('base64')}`,
    W,
    H,
  );
  await page.close();
  return Buffer.from(rgba, 'base64');
}

/** RGBA → planar I420 (BT.601), wrapped in a Y4M container. */
function toY4M(rgba, frames = 10) {
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
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`);
  const fh = Buffer.from('FRAME\n');
  return Buffer.concat([header, ...Array.from({ length: frames }, () => [fh, frame]).flat()]);
}

// ---------- 2. Build fake webcam video ----------
const helper = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const rgba = await renderCameraFrame(helper);
await helper.close();
const y4mPath = resolve(outDir, 'fake-camera.y4m');
await writeFile(y4mPath, toY4M(rgba));
console.log('Fake camera video:', y4mPath);

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

let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[console]', m.text()));
  // Phone-sized viewport (portrait), like a student holding a phone.
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  await page.goto(base, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: resolve(outDir, '1-home.png') });

  await page.locator('button.primary').click();
  console.log('Waiting for MindAR to lock on to the page…');
  await page.waitForSelector('.status--tracking', { timeout: 180_000 });
  await new Promise((r) => setTimeout(r, 1500)); // let the pose filter settle
  await page.screenshot({ path: resolve(outDir, '2-tracking.png') });
  console.log('✔ Target tracked');

  // Tap around the centre of the screen until a part gets selected.
  const vp = page.viewport();
  const candidates = [
    [0.5, 0.45], [0.52, 0.4], [0.45, 0.5], [0.55, 0.5], [0.5, 0.35], [0.5, 0.55], [0.5, 0.3],
  ];
  let selected = false;
  for (const [fx, fy] of candidates) {
    await page.touchscreen.tap(vp.width * fx, vp.height * fy);
    if (await page.waitForSelector('.info-card', { timeout: 800 }).catch(() => null)) {
      selected = true;
      break;
    }
  }
  await page.screenshot({ path: resolve(outDir, '3-selected.png') });
  if (selected) {
    const title = await page.$eval('.info-card h2', (el) => el.textContent);
    console.log(`✔ Tapped part: ${title}`);
  } else {
    console.error('✘ Could not select a part by tapping');
    failed = true;
  }

  // 3D preview (no camera)
  await page.locator('button[aria-label="Back"]').click();
  await page.locator('button.secondary').click();
  await page.waitForSelector('.hint', { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: resolve(outDir, '4-preview.png') });
  console.log('✔ 3D preview rendered');
} catch (e) {
  console.error('✘', e.message);
  failed = true;
} finally {
  await browser.close();
  await server.close();
}
console.log(`Screenshots in ${outDir}`);
process.exit(failed ? 1 : 0);
