# BeyondBook — WebAR heart MVP

Point a phone camera at a printed heart illustration and an interactive, beating 3D heart appears on top of the page.

**Stack:** React + TypeScript + Vite · MindAR (image tracking) · Three.js (rendering) · GLB model

## Quick start

```bash
npm install
npm run dev
```

The dev server runs over **HTTPS** on your LAN. Phones only allow camera access on secure origins.

1. Print `public/targets/heart-page.png` (A4 / Letter), or open it on a laptop screen.
2. On your phone, open the `https://<your-LAN-IP>:5173` address that Vite prints. The phone and computer must be on the same Wi-Fi.
3. Accept the self-signed certificate warning, then tap **Start AR** and allow the camera.
4. Point the camera at the page. Then:
   - **Tap** a part to see what it does.
   - **Drag** to rotate the heart.
   - **Pinch** to zoom.
   - Use the buttons to pause the heartbeat or switch the heart rate (resting, running, sleeping).

**View in 3D without camera** on the home screen shows the same heart without AR. Use it on a desktop or when you don't have the page.

## Project layout

```
src/
  ar/MindARThree.ts        Typed MindAR ↔ three.js bridge (camera feed, tracking, projection)
  three/HeartExperience.ts Model loading/normalising, heartbeat, tap-to-select, rotate/zoom
  three/gestures.ts        Tap / drag / pinch pointer gestures
  content/heartParts.ts    Educational text per heart part (keyed by mesh name)
  components/              ARView, PreviewView, HeartHUD (info card + controls)
  compile/main.ts          In-browser .mind target compiler (served at /compile.html)
public/
  models/heart.glb         The 3D heart
  targets/heart-page.png   Printable page (the image that gets tracked)
  targets/heart.mind       Compiled MindAR tracking data for that page
assets-src/heart-page.svg  Source artwork for the printable page
scripts/                   Asset generation and the end-to-end smoke test
```

### Why not `mindar-image-three`?

MindAR's bundled three.js wrapper imports `sRGBEncoding`, which modern three.js no longer has. So `src/ar/MindARThree.ts` uses MindAR's tracking `Controller` directly and does the rendering with the app's own three.js.

## Swapping in your own content

**A different 3D model.** Replace `public/models/heart.glb` with any GLB. The app centres and scales it automatically. Tap-to-learn needs mesh names to start with a key from `src/content/heartParts.ts`, for example `LeftVentricle` or `Aorta_Branch`. Without matching names the model still renders and beats as a whole.

**A different page or illustration.**
1. Put the image in `public/targets/`.
2. Compile it by running `npm run assets:target -- public/targets/your-page.png public/targets/heart.mind`. This needs Chrome installed; set `CHROME_PATH` if it's somewhere unusual. You can also open `/compile.html` in the dev server and upload the image there.
3. Change `HEART_OFFSET` and `HEART_SIZE` in `src/components/ARView.tsx` so the model sits over the drawing. One unit equals the page width, and the origin is the centre of the page.

Images that track well have lots of detail and high contrast, such as text, outlines and texture. Flat colour areas and repeating patterns track badly.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | HTTPS dev server on the LAN |
| `npm run build` / `npm run preview` | Production build in `dist/` and a local preview |
| `npm run assets` | Rebuild all generated assets (the three commands below) |
| `npm run assets:page` | Render `assets-src/heart-page.svg` to the printable PNG |
| `npm run assets:target` | Compile the PNG into `heart.mind` (uses headless Chrome) |
| `npm run assets:model` | Rebuild the procedural `heart.glb` |
| `node scripts/smoke-test.mjs` | End-to-end test with no phone (details below) |

The smoke test feeds Chrome a fake webcam that shows the page on a desk. It then checks that MindAR locks on and that tapping selects a part, and saves screenshots to `smoke-output/`.

## Deploying

`npm run build` and host `dist/` on any static **HTTPS** host, such as Netlify, Vercel or GitHub Pages. For a sub-path deployment, set `base` in `vite.config.ts`. Asset URLs already respect it.

## Known limitations

- The included heart is a stylised model built in code, made for teaching rather than for clinical accuracy. Replace it with a scanned or artist-made model for production.
- MindAR includes TensorFlow.js, so the first load is about 500 KB gzipped of JS plus a 2 MB model and a 0.8 MB target. Tracking needs good lighting and works best when the page fills most of the camera view.

### Netlify

The repo includes `netlify.toml` (build with `npm run build`, publish `dist`, Node 22). In Netlify, choose **Add new site → Import an existing project → GitHub**, then pick this repo. The defaults are filled in automatically.

`.npmrc` sets `ignore-scripts=true` so `npm install` doesn't try to compile MindAR's optional native `canvas` dependency.
