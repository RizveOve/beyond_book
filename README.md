# BeyondBook — WebAR textbook MVP

Point a phone camera at a printed (black & white) textbook page and a detailed, interactive 3D model appears on top of it. There are two chapters: a beating **heart** and a **brain** with tappable lobes. Move the camera away and the model **stays on screen** as a free-floating model until the camera finds a page again. Point at the other chapter's page and its model swaps in.

**Stack:** React + TypeScript + Vite · MindAR (image tracking) · Three.js (rendering) · GLB model

## Quick start

```bash
npm install
npm run dev
```

The dev server runs over **HTTPS** on your LAN. Phones only allow camera access on secure origins.

1. Print `public/targets/heart-page.png` and/or `public/targets/brain-page.png` (A4 / Letter), or open them on a laptop screen. The home screen links to both.
2. On your phone, open the `https://<your-LAN-IP>:5173` address that Vite prints. The phone and computer must be on the same Wi-Fi.
3. Accept the self-signed certificate warning, then tap **Start AR** and allow the camera.
4. Point the camera at the page. Then:
   - **Tap** a part to read about it. The other parts fade out so the selected one stands out.
   - **Drag** sideways to turn the heart, or up and down to tilt it.
   - **Pinch** to zoom, or use the **− / +** buttons.
   - The toolbar also has **Beat** (pause or play), the heart rate (resting, running or sleeping), **Labels**, **Explode** (pulls the parts apart), **Spin** (auto-rotate) and **Reset**.
5. On the brain, **Explode** splits the hemispheres to reveal the corpus callosum and thalamus. The brain has no heartbeat controls.
6. Move the camera off the page. The heart glides to the middle of the screen and stays fully interactive ("Free view"). Point at a page again and it snaps back onto it. If that's a different page in the target list, its own model loads.

**View in 3D** on each chapter card shows that model without AR. Use it on a desktop or when you don't have the page.

## Project layout

```
src/
  ar/MindARThree.ts        Typed MindAR ↔ three.js bridge (camera feed, tracking, projection)
  three/ModelExperience.ts Model loading, heartbeat, tap-to-select/focus, labels, explode, rotate/zoom
  three/gestures.ts        Tap / drag / pinch pointer gestures
  content/heartParts.ts    Educational text per heart part (keyed by mesh name)
  content/brainParts.ts    Educational text per brain structure
  content/targets.ts       Page ↔ model registry (which model appears on which page)
  components/              ARView, PreviewView, ModelHUD (info card + controls)
  compile/main.ts          In-browser .mind target compiler (served at /compile.html)
public/
  models/heart.glb         The 3D heart
  models/brain.glb         The 3D brain
  targets/*-page.png       Printable pages (the images that get tracked)
  targets/pages.mind       Compiled MindAR tracking data for all pages (heart = 0, brain = 1)
assets-src/*.svg           Source artwork for the printable pages (brain-page.svg is generated)
scripts/                   Asset generation and the end-to-end smoke test
```

### Why not `mindar-image-three`?

MindAR's bundled three.js wrapper imports `sRGBEncoding`, which modern three.js no longer has. So `src/ar/MindARThree.ts` uses MindAR's tracking `Controller` directly and does the rendering with the app's own three.js.

## Swapping in your own content

**A different 3D model.** Replace `public/models/heart.glb` with any GLB. The app centres and scales it automatically. Tap-to-learn needs mesh names to start with a key from `src/content/heartParts.ts`, for example `LeftVentricle` or `Aorta_Branch`. Without matching names the model still renders and beats as a whole.

**A different page or illustration.**
1. Put the image in `public/targets/`.
2. Compile all pages, in `TARGETS` order, with `npm run assets:target -- public/targets/heart-page.png public/targets/brain-page.png public/targets/your-page.png`. This needs Chrome installed; set `CHROME_PATH` if it's somewhere unusual. You can also open `/compile.html` in the dev server and upload the image there.
3. Change `size`, `offset` and `lift` for that page in `src/content/targets.ts` so the model sits over the drawing. One unit equals the page width, and the origin is the centre of the page.

**More pages, each with its own model.** Compile all page images in order (as above, or select them together on `/compile.html` and save the result as `public/targets/pages.mind`). Then add one entry per page to `TARGETS` in `src/content/targets.ts`, in the same order. When the camera recognises a different page, the floating model switches to that page's model.

Images that track well have lots of detail and high contrast, such as text, outlines and texture. Flat colour areas and repeating patterns track badly.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | HTTPS dev server on the LAN |
| `npm run build` / `npm run preview` | Production build in `dist/` and a local preview |
| `npm run assets` | Rebuild all generated assets (the three commands below) |
| `npm run assets:page` | Generate the brain page SVG and render every page to a printable PNG |
| `npm run assets:target` | Compile the page PNGs into `pages.mind` (uses headless Chrome) |
| `npm run assets:model` | Rebuild the procedural `heart.glb` and `brain.glb` and compress them (meshopt) |
| `node scripts/smoke-test.mjs` | End-to-end test with no phone (details below) |

The smoke test feeds Chrome a fake webcam that shows the heart page, an empty desk, the brain page, then the desk again. It checks that each page is recognised and shows its own model, that the model stays on screen when the page disappears, that tapping, labels and explode work, and that both 3D previews render. Screenshots go to `smoke-output/`.

## Deploying

`npm run build` and host `dist/` on any static **HTTPS** host, such as Netlify, Vercel or GitHub Pages. For a sub-path deployment, set `base` in `vite.config.ts`. Asset URLs already respect it.

## Known limitations

- The included heart and brain are greyscale models built in code, made for teaching rather than for clinical accuracy. Replace it with a scanned or artist-made model for production.
- In free view the heart is fixed to the screen, not to the room: MindAR tracks images only and has no world tracking.
- MindAR includes TensorFlow.js, so the first load is about 500 KB gzipped of JS plus the models (heart 1.3 MB, brain 1.9 MB, loaded in the background) and a 1.7 MB tracking file. Tracking needs good lighting and works best when the page fills most of the camera view.

### Netlify

The repo includes `netlify.toml` (build with `npm run build`, publish `dist`, Node 22). In Netlify, choose **Add new site → Import an existing project → GitHub**, then pick this repo. The defaults are filled in automatically.

`.npmrc` sets `ignore-scripts=true` so `npm install` doesn't try to compile MindAR's optional native `canvas` dependency.
