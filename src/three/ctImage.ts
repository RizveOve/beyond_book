import { chainLoops, type CTAxis, type CTSlice, type CTSliceMesh } from './CTScanner';

/** How one structure looks on CT: grey levels 0 (air) … 1 (bone). */
export interface CTStyle {
  fill: number;
  /** Wall/cortex grey drawn just inside the outline. */
  edge?: number;
  /** Wall thickness in model units. */
  edgeWidth?: number;
}

export interface CTProfile {
  /** Synthetic anatomy drawn around the model so the slice reads like a real scan. */
  context: 'chest' | 'head';
  /** Style per part key. */
  styles: Record<string, CTStyle>;
  /** Style overrides by mesh-name pattern (checked first). */
  meshStyles?: [RegExp, CTStyle][];
  /**
   * Meshes that are patches of one closed surface (e.g. the lobes of a
   * hemisphere). Each group is filled as one region with `fill`; members then
   * draw only their own rim (`edge` / `edgeWidth` from their style).
   */
  groups?: { match: RegExp; fill: number }[];
  /** Draw order: parts listed first are painted first (underneath). */
  order?: string[];
  /** Real-world size of the model's largest dimension, for the mm readout and scale bar. */
  realSizeMm: number;
  /** Window/level caption, e.g. "W 400  L 40". */
  window: string;
}

export interface CTHit {
  key: string;
  path: Path2D;
  /** For grouped regions: which member is at this point (nearest rim). */
  resolve?: (x: number, y: number) => string;
}

const ORIENT: Record<CTAxis, [string, string, string, string]> = {
  // top, right, bottom, left
  axial: ['A', 'L', 'P', 'R'],
  coronal: ['S', 'L', 'I', 'R'],
  sagittal: ['S', 'P', 'I', 'A'],
};

const grey = (g: number, a = 1) => {
  const v = Math.round(Math.max(0, Math.min(1, g)) * 255);
  return `rgba(${v},${v},${v},${a})`;
};

let noise: HTMLCanvasElement | null = null;
function noiseCanvas(size: number): HTMLCanvasElement {
  if (noise && noise.width === size) return noise;
  noise = document.createElement('canvas');
  noise.width = noise.height = size;
  const ctx = noise.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return noise;
}

/**
 * Renders a CT-style greyscale image of a slice into `ctx` (a square canvas of
 * `size` px). Returns hit regions (topmost last) for tap-to-identify.
 */
export function drawCT(
  ctx: CanvasRenderingContext2D,
  size: number,
  slice: CTSlice,
  profile: CTProfile,
  modelExtent: number,
  selectedKey: string | null,
): CTHit[] {
  const E = modelExtent;
  const scale = (size * 0.86) / (E * 1.35);
  const cx = size / 2;
  const cy = size / 2;
  const X = (u: number) => cx + u * scale;
  const Y = (v: number) => cy - v * scale;

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // Soft reconstruction blur, like a real CT kernel.
  ctx.filter = `blur(${Math.max(0.4, size / 420)}px)`;

  // Bounding box of this slice's content (image coords).
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const m of slice.meshes) {
    for (const loop of m.loops) {
      for (let i = 0; i < loop.length; i += 2) {
        minU = Math.min(minU, loop[i]);
        maxU = Math.max(maxU, loop[i]);
        minV = Math.min(minV, loop[i + 1]);
        maxV = Math.max(maxV, loop[i + 1]);
      }
    }
  }
  const hasContent = minU < maxU;

  if (profile.context === 'chest') drawChest(ctx, slice.axis, E, X, Y, scale);
  else if (hasContent) drawHead(ctx, E, X, Y, scale, minU, maxU, minV, maxV);

  // Structures, in profile order. Grouped patches are merged into one region.
  const rank = (key: string) => {
    const i = profile.order?.indexOf(key) ?? -1;
    return i < 0 ? 999 : i;
  };
  const styleOf = (m: CTSliceMesh): CTStyle =>
    profile.meshStyles?.find(([re]) => re.test(m.name))?.[1] ?? profile.styles[m.key] ?? { fill: 0.5 };
  const toPath = (loops: Float32Array[], close: boolean) => {
    const path = new Path2D();
    for (const loop of loops) {
      path.moveTo(X(loop[0]), Y(loop[1]));
      for (let i = 2; i < loop.length; i += 2) path.lineTo(X(loop[i]), Y(loop[i + 1]));
      if (close) path.closePath();
    }
    return path;
  };
  const wall = (clipTo: Path2D, outline: Path2D, style: CTStyle) => {
    if (style.edge === undefined || !style.edgeWidth) return;
    ctx.save();
    ctx.clip(clipTo, 'evenodd');
    ctx.strokeStyle = grey(style.edge);
    ctx.lineWidth = Math.max(1, style.edgeWidth * scale * 2);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke(outline);
    ctx.restore();
  };

  type Item =
    | { kind: 'mesh'; rank: number; mesh: CTSliceMesh }
    | { kind: 'group'; rank: number; fill: number; members: CTSliceMesh[] };
  const items: Item[] = [];
  const groups = new Map<number, Extract<Item, { kind: 'group' }>>();
  for (const m of slice.meshes) {
    const gi = profile.groups?.findIndex((g) => g.match.test(m.name)) ?? -1;
    if (gi < 0) {
      items.push({ kind: 'mesh', rank: rank(m.key), mesh: m });
      continue;
    }
    let g = groups.get(gi);
    if (!g) {
      g = { kind: 'group', rank: Infinity, fill: profile.groups![gi].fill, members: [] };
      groups.set(gi, g);
      items.push(g);
    }
    g.members.push(m);
    g.rank = Math.min(g.rank, rank(m.key));
  }
  items.sort((a, b) => a.rank - b.rank);

  const hits: CTHit[] = [];
  const outlines: { key: string; path: Path2D }[] = [];
  for (const item of items) {
    if (item.kind === 'mesh') {
      const m = item.mesh;
      const style = styleOf(m);
      const path = toPath(m.loops, true);
      ctx.fillStyle = grey(style.fill);
      ctx.fill(path, 'evenodd');
      wall(path, path, style);
      hits.push({ key: m.key, path });
      outlines.push({ key: m.key, path });
      continue;
    }
    // Group: re-join all members' segments into closed loops and fill once…
    const all = new Float32Array(item.members.reduce((n, m) => n + m.segs.length, 0));
    let o = 0;
    for (const m of item.members) {
      all.set(m.segs, o);
      o += m.segs.length;
    }
    const region = toPath(chainLoops(all, E * 0.004), true);
    ctx.fillStyle = grey(item.fill);
    ctx.fill(region, 'evenodd');
    // …then each member draws its own rim inside the region.
    const rims = item.members.map((m) => ({ key: m.key, path: toPath(m.loops, false), loops: m.loops }));
    for (const [i, r] of rims.entries()) {
      wall(region, r.path, styleOf(item.members[i]));
      outlines.push({ key: r.key, path: r.path });
    }
    hits.push({
      key: rims[0]?.key ?? '',
      path: region,
      resolve: (x, y) => {
        let best = rims[0]?.key ?? '';
        let bestD = Infinity;
        for (const r of rims) {
          for (const loop of r.loops) {
            for (let i = 0; i < loop.length; i += 2) {
              const d = (X(loop[i]) - x) ** 2 + (Y(loop[i + 1]) - y) ** 2;
              if (d < bestD) {
                bestD = d;
                best = r.key;
              }
            }
          }
        }
        return best;
      },
    });
  }
  ctx.filter = 'none';

  // Scanner grain.
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.22;
  ctx.drawImage(noiseCanvas(size), 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // Selected structure outline.
  if (selectedKey) {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(1.5, size / 160);
    ctx.setLineDash([size / 60, size / 90]);
    for (const h of outlines) if (h.key === selectedKey) ctx.stroke(h.path);
    ctx.setLineDash([]);
  }

  drawOverlay(ctx, size, slice, profile, E, scale);
  ctx.restore();
  return hits;
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  g: number,
  rot = 0,
) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
  ctx.fillStyle = grey(g);
  ctx.fill();
}

/** Thorax around the heart: fat, muscle, lungs, spine, sternum and ribs. */
function drawChest(
  ctx: CanvasRenderingContext2D,
  axis: CTAxis,
  E: number,
  X: (u: number) => number,
  Y: (v: number) => number,
  s: number,
) {
  if (axis === 'axial') {
    const bx = X(-0.06 * E), by = Y(-0.08 * E);
    ellipse(ctx, bx, by, 0.66 * E * s, 0.44 * E * s, 0.3); // subcutaneous fat
    ellipse(ctx, bx, by, 0.62 * E * s, 0.4 * E * s, 0.44); // muscle / soft tissue
    // Ribs around the wall.
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.2;
      ellipse(ctx, bx + Math.cos(a) * 0.6 * E * s, by + Math.sin(a) * 0.385 * E * s, 0.025 * E * s, 0.012 * E * s, 0.92, a);
    }
    ellipse(ctx, X(-0.36 * E), Y(-0.1 * E), 0.2 * E * s, 0.28 * E * s, 0.04); // right lung
    ellipse(ctx, X(0.28 * E), Y(-0.14 * E), 0.17 * E * s, 0.25 * E * s, 0.04); // left lung
    ellipse(ctx, X(-0.06 * E), Y(-0.41 * E), 0.075 * E * s, 0.065 * E * s, 0.95); // vertebral body
    ellipse(ctx, X(-0.06 * E), Y(-0.5 * E), 0.03 * E * s, 0.025 * E * s, 0.38); // spinal canal
    ellipse(ctx, X(-0.06 * E), Y(-0.56 * E), 0.05 * E * s, 0.02 * E * s, 0.9); // spinous process
    ellipse(ctx, X(-0.06 * E), Y(0.31 * E), 0.05 * E * s, 0.018 * E * s, 0.9); // sternum
  } else if (axis === 'coronal') {
    const bx = X(-0.06 * E), by = Y(0);
    ellipse(ctx, bx, by, 0.66 * E * s, 0.72 * E * s, 0.3);
    ellipse(ctx, bx, by, 0.62 * E * s, 0.68 * E * s, 0.44);
    ellipse(ctx, X(-0.36 * E), Y(0.05 * E), 0.2 * E * s, 0.42 * E * s, 0.04);
    ellipse(ctx, X(0.3 * E), Y(0.05 * E), 0.18 * E * s, 0.4 * E * s, 0.04);
    ellipse(ctx, bx, Y(-0.6 * E), 0.5 * E * s, 0.12 * E * s, 0.5); // diaphragm / liver dome
  } else {
    const bx = X(0), by = Y(0);
    ellipse(ctx, bx, by, 0.5 * E * s, 0.72 * E * s, 0.3);
    ellipse(ctx, bx, by, 0.46 * E * s, 0.68 * E * s, 0.44);
    ellipse(ctx, X(0.05 * E), Y(0.1 * E), 0.3 * E * s, 0.45 * E * s, 0.05); // lung
    for (let i = -5; i <= 5; i++) {
      // Vertebrae down the back (posterior = image right).
      const y = Y(i * 0.11 * E);
      ctx.fillStyle = grey(0.93);
      ctx.beginPath();
      ctx.roundRect(X(0.33 * E), y - 0.04 * E * s, 0.09 * E * s, 0.08 * E * s, 3);
      ctx.fill();
    }
    ctx.fillStyle = grey(0.9);
    ctx.fillRect(X(-0.42 * E), Y(0.3 * E), 0.03 * E * s, 0.45 * E * s); // sternum
  }
}

/** Skull, scalp and cerebrospinal fluid around the brain slice. */
function drawHead(
  ctx: CanvasRenderingContext2D,
  E: number,
  X: (u: number) => number,
  Y: (v: number) => number,
  s: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
) {
  const cx = X((minU + maxU) / 2);
  const cy = Y((minV + maxV) / 2);
  const rx = Math.max((maxU - minU) / 2, 0.08 * E) * s;
  const ry = Math.max((maxV - minV) / 2, 0.08 * E) * s;
  const pad = (k: number) => k * E * s;
  ellipse(ctx, cx, cy, rx + pad(0.085), ry + pad(0.085), 0.4); // scalp
  ellipse(ctx, cx, cy, rx + pad(0.065), ry + pad(0.065), 0.97); // skull (bone)
  ellipse(ctx, cx, cy, rx + pad(0.045), ry + pad(0.045), 0.85); // diploë
  ellipse(ctx, cx, cy, rx + pad(0.035), ry + pad(0.035), 0.97);
  ellipse(ctx, cx, cy, rx + pad(0.02), ry + pad(0.02), 0.17); // CSF
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  size: number,
  slice: CTSlice,
  profile: CTProfile,
  E: number,
  scale: number,
) {
  const fs = Math.max(9, Math.round(size / 26));
  const pad = fs * 0.6;
  ctx.font = `${fs}px ui-monospace, Menlo, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(slice.axis.toUpperCase(), pad, pad);
  ctx.textAlign = 'right';
  const n = Math.round(slice.t * 99) + 1;
  ctx.fillText(`SL ${n}/100`, size - pad, pad);
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  ctx.fillText(profile.window, pad, size - pad);
  ctx.textAlign = 'right';
  const mmPerUnit = profile.realSizeMm / E;
  ctx.fillText(`${Math.round(slice.offset * mmPerUnit) || 0} mm`, size - pad, size - pad);

  // Orientation letters.
  const [top, right, bottom, left] = ORIENT[slice.axis];
  ctx.font = `bold ${fs}px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(top, size / 2, pad);
  ctx.textBaseline = 'bottom';
  ctx.fillText(bottom, size / 2, size - pad);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(left, pad, size / 2);
  ctx.textAlign = 'right';
  ctx.fillText(right, size - pad, size / 2);

  // 1 cm scale bar.
  const cm = (10 / mmPerUnit) * scale;
  const x0 = size - pad - cm;
  const y0 = size - pad - fs * 1.6;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + cm, y0);
  ctx.moveTo(x0, y0 - 3);
  ctx.lineTo(x0, y0 + 3);
  ctx.moveTo(x0 + cm, y0 - 3);
  ctx.lineTo(x0 + cm, y0 + 3);
  ctx.stroke();
}
