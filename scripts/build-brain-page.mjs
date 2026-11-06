// Generates assets-src/brain-page.svg: a black & white, printer-friendly
// "The Human Brain" textbook page (left lateral view). The cortex folds are
// drawn procedurally with a seeded RNG so the page is reproducible, and the
// dense line work gives MindAR plenty of keypoints to track.
import { writeFile } from 'node:fs/promises';

const W = 1240;
const H = 1754;
const DY = 80; // vertical shift of the whole illustration

// ---------- Seeded RNG ----------
let seed = 20251106;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- Outline & lobe boundaries (left lateral view, front = left) ----------
// Outline pieces, clockwise from the frontal pole.
const A = 'C 160 600, 300 420, 500 380 C 560 368, 600 362, 625 362'; // frontal pole → top at central sulcus
const B = 'C 740 360, 840 380, 905 430'; // → top of parieto-occipital line
const C = 'C 1000 500, 1090 650, 1080 760 C 1075 810, 1065 840, 1050 860'; // → occipital pole
const D = 'C 1010 920, 930 940, 860 925'; // → pre-occipital notch
const E = 'C 780 960, 700 1030, 560 1035 C 450 1035, 360 960, 350 860'; // → temporal pole
const F = 'C 300 880, 230 875, 200 840 C 185 820, 178 800, 180 780'; // → back to frontal pole
const OUTLINE = `M 180 780 ${A} ${B} ${C} ${D} ${E} ${F} Z`;

const CS = 'C 600 450, 640 520, 590 600 C 560 650, 580 720, 540 790'; // central sulcus (625,362)→(540,790)
const LS1 = 'C 420 835, 480 805, 540 790'; // lateral sulcus (350,860)→(540,790)
const LS1_REV = 'C 480 805, 420 835, 350 860';
const LS2 = 'C 620 775, 720 760, 790 720'; // (540,790)→(790,720)
const PT = 'C 820 715, 860 705, 887 700'; // parietal/temporal edge (790,720)→(887,700)
const PO1 = 'C 918 520, 900 610, 887 700'; // parieto-occipital (905,430)→(887,700)
const PO1_REV = 'C 900 610, 918 520, 905 430';
const PO2 = 'C 878 780, 870 860, 860 925'; // (887,700)→(860,925)

// Lobe regions: exact along shared boundaries, generous outside (clipped to the outline).
const LOBES = {
  frontal: `M 100 250 L 625 250 L 625 362 ${CS} ${LS1_REV} L 100 1100 Z`,
  parietal: `M 625 250 L 625 362 ${CS} ${LS2} ${PT} ${PO1_REV} L 905 250 Z`,
  temporal: `M 100 1100 L 350 860 ${LS1} ${LS2} ${PT} ${PO2} L 860 1200 L 100 1200 Z`,
  occipital: `M 905 250 L 905 430 ${PO1} ${PO2} L 860 1200 L 1200 1200 L 1200 250 Z`,
};

const CEREBELLUM =
  'M 760 930 C 800 900, 1000 900, 1060 900 C 1110 960, 1080 1090, 960 1110 C 870 1125, 780 1080, 750 1010 C 740 975, 745 950, 760 930 Z';
const BRAINSTEM =
  'M 690 940 C 700 990, 740 1010, 735 1080 C 732 1160, 745 1240, 748 1300 L 806 1300 C 804 1230, 800 1150, 805 1080 C 812 1010, 800 960, 790 930 Z';

// ---------- Procedural gyri (sulci lines) ----------
// Each sulcus is a meandering curve: its turning rate drifts smoothly, giving
// the looping C/S shapes typical of cortical folds rather than random cracks.
function sulci(count, box, { step = 6, min = 14, max = 30, width = 4.2 } = {}) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    let x = box.x + rand() * box.w;
    let y = box.y + rand() * box.h;
    let a = rand() * Math.PI * 2;
    let omega = (rand() - 0.5) * 0.2;
    const n = min + Math.floor(rand() * (max - min));
    const pts = [[x, y]];
    for (let k = 0; k < n; k++) {
      omega = Math.max(-0.14, Math.min(0.14, omega + (rand() - 0.5) * 0.09));
      a += omega;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    // Smooth with quadratic segments through midpoints.
    let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k][0] + pts[k + 1][0]) / 2;
      const my = (pts[k][1] + pts[k + 1][1]) / 2;
      d += ` Q${pts[k][0].toFixed(1)} ${pts[k][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
    }
    paths.push(`<path d="${d}" stroke-width="${(width * (0.8 + rand() * 0.4)).toFixed(2)}"/>`);
  }
  return paths.join('\n      ');
}

// Cerebellum folia: stacked gently curved lines.
function folia() {
  const lines = [];
  for (let y = 905; y < 1125; y += 11) {
    const wob = (rand() - 0.5) * 10;
    lines.push(
      `<path d="M 730 ${y} C 820 ${y + 14 + wob}, 960 ${y - 10 - wob}, 1110 ${y + 6}" stroke-width="${(2 + rand()).toFixed(1)}"/>`,
    );
  }
  return lines.join('\n      ');
}

const label = (x, y, lines, anchor = 'start') =>
  lines
    .map((t, i) => `<text x="${x}" y="${y + i * 32}" text-anchor="${anchor}">${t}</text>`)
    .join('');
const leader = (pts) => `<polyline points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
const dot = ([x, y]) => `<circle cx="${x}" cy="${y}" r="6"/>`;

// [text lines, text pos, leader points (last = target, in illustration coords before DY shift)]
const LABELS = [
  [['Frontal', 'lobe'], [96, 330], [[200, 352], [300, 352], [330, 640 + DY]]],
  [['Central', 'sulcus'], [470, 300], [[575, 322], [600, 322], [612, 450 + DY]]],
  [['Parietal', 'lobe'], [745, 300], [[850, 322], [870, 322], [775, 540 + DY]]],
  [['Occipital', 'lobe'], [1000, 380], [[1050, 410], [1050, 450], [1000, 720 + DY]]],
  [['Lateral', 'sulcus'], [80, 1040], [[180, 1062], [250, 1062], [440, 820 + DY]]],
  [['Temporal', 'lobe'], [96, 1210], [[220, 1232], [290, 1232], [520, 960 + DY]]],
  [['Brainstem'], [420, 1350], [[545, 1342], [600, 1342], [752, 1230 + DY]]],
  [['Cerebellum'], [960, 1300], [[1020, 1278], [1000, 1250], [960, 1060 + DY]]],
];

const KEY = [
  ['url(#tFrontal)', 'Frontal'],
  ['url(#tParietal)', 'Parietal'],
  ['url(#tTemporal)', 'Temporal'],
  ['url(#tOccipital)', 'Occipital'],
  ['url(#tCerebellum)', 'Cerebellum'],
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <!-- BeyondBook printable target page: "The Human Brain" (generated by scripts/build-brain-page.mjs).
       Black & white; lobes are told apart by texture. -->
  <defs>
    <pattern id="tFrontal" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#f1f1f1"/>
      <circle cx="3" cy="3" r="1.3" fill="#333"/><circle cx="9" cy="9" r="1.3" fill="#333"/>
    </pattern>
    <pattern id="tParietal" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="10" height="10" fill="#e4e4e4"/>
      <line x1="0" y1="0" x2="0" y2="10" stroke="#444" stroke-width="1.4"/>
    </pattern>
    <pattern id="tTemporal" width="10" height="9" patternUnits="userSpaceOnUse">
      <rect width="10" height="9" fill="#d7d7d7"/>
      <line x1="0" y1="4" x2="10" y2="4" stroke="#444" stroke-width="1.3"/>
    </pattern>
    <pattern id="tOccipital" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#cdcdcd"/>
      <path d="M0 0 L12 12 M12 0 L0 12" stroke="#444" stroke-width="1.1"/>
    </pattern>
    <pattern id="tCerebellum" width="10" height="8" patternUnits="userSpaceOnUse">
      <rect width="10" height="8" fill="#bdbdbd"/>
      <path d="M0 5 Q 2.5 2, 5 5 T 10 5" fill="none" stroke="#222" stroke-width="1.3"/>
    </pattern>
    <pattern id="tStem" width="9" height="10" patternUnits="userSpaceOnUse">
      <rect width="9" height="10" fill="#a9a9a9"/>
      <line x1="4" y1="0" x2="4" y2="10" stroke="#222" stroke-width="1.3"/>
    </pattern>
    <pattern id="paper" width="30" height="30" patternUnits="userSpaceOnUse">
      <circle cx="6" cy="8" r="1" fill="#e4e4e4"/><circle cx="21" cy="22" r="0.9" fill="#e4e4e4"/>
    </pattern>
    <clipPath id="cerebrum"><path d="${OUTLINE}"/></clipPath>
    <clipPath id="cerebellumClip"><path d="${CEREBELLUM}"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect width="${W}" height="${H}" fill="url(#paper)"/>

  <!-- Border: double rule with round corner medallions -->
  <rect x="40" y="40" width="1160" height="1674" fill="none" stroke="#1d1d1d" stroke-width="3"/>
  <rect x="52" y="52" width="1136" height="1650" fill="none" stroke="#1d1d1d" stroke-width="7"/>
  <rect x="70" y="70" width="1100" height="1614" fill="none" stroke="#1d1d1d" stroke-width="1.5" stroke-dasharray="14 6"/>
  <g fill="#ffffff" stroke="#1d1d1d" stroke-width="4">
    <circle cx="52" cy="52" r="26"/><circle cx="1188" cy="52" r="26"/>
    <circle cx="52" cy="1702" r="26"/><circle cx="1188" cy="1702" r="26"/>
  </g>
  <g fill="#1d1d1d">
    <circle cx="52" cy="52" r="10"/><circle cx="1188" cy="52" r="10"/>
    <circle cx="52" cy="1702" r="10"/><circle cx="1188" cy="1702" r="10"/>
  </g>

  <!-- Header -->
  <text x="620" y="155" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="76" font-weight="bold" fill="#111">The Human Brain</text>
  <text x="620" y="203" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-style="italic" fill="#333">Chapter 5 · The Nervous System · Left Lateral View</text>
  <g stroke="#111" stroke-width="3"><line x1="170" y1="232" x2="560" y2="232"/><line x1="680" y1="232" x2="1070" y2="232"/></g>
  <g fill="none" stroke="#111" stroke-width="3"><circle cx="620" cy="232" r="14"/><path d="M 606 232 Q 620 218, 634 232 Q 620 246, 606 232"/></g>

  <!-- ===== Brain illustration ===== -->
  <g transform="translate(0,${DY})" stroke-linejoin="round" stroke-linecap="round">
    <!-- Brainstem (behind) -->
    <path d="${BRAINSTEM}" fill="url(#tStem)" stroke="#111" stroke-width="5"/>
    <path d="M 700 1000 C 735 975, 790 985, 800 1020 C 805 1060, 760 1075, 715 1060" fill="none" stroke="#111" stroke-width="3"/>

    <!-- Cerebellum -->
    <path d="${CEREBELLUM}" fill="url(#tCerebellum)" stroke="#111" stroke-width="5"/>
    <g clip-path="url(#cerebellumClip)" fill="none" stroke="#111">
      ${folia()}
    </g>

    <!-- Cerebrum: lobe textures clipped to the outline -->
    <g clip-path="url(#cerebrum)">
      <path d="${LOBES.frontal}" fill="url(#tFrontal)"/>
      <path d="${LOBES.parietal}" fill="url(#tParietal)"/>
      <path d="${LOBES.temporal}" fill="url(#tTemporal)"/>
      <path d="${LOBES.occipital}" fill="url(#tOccipital)"/>
      <!-- Gyri: white "crest" halo under dark sulci lines -->
      <g fill="none" stroke="#ffffff" opacity="0.85">
        ${(() => {
          const s = seed;
          const out = sulci(150, { x: 170, y: 350, w: 930, h: 700 }, { width: 12 });
          seed = s; // replay the same walks for the dark lines on top
          return out;
        })()}
      </g>
      <g fill="none" stroke="#111">
        ${sulci(150, { x: 170, y: 350, w: 930, h: 700 })}
      </g>
    </g>

    <!-- Major fissures and lobe boundaries -->
    <g fill="none" stroke="#111">
      <path d="M 625 362 ${CS}" stroke-width="9"/>
      <path d="M 350 860 ${LS1} ${LS2}" stroke-width="10"/>
      <path d="M 790 720 ${PT}" stroke-width="3" stroke-dasharray="10 7"/>
      <path d="M 905 430 ${PO1} ${PO2}" stroke-width="3" stroke-dasharray="10 7"/>
    </g>
    <path d="${OUTLINE}" fill="none" stroke="#111" stroke-width="7"/>
  </g>

  <!-- ===== Labels ===== -->
  <g font-family="Helvetica, Arial, sans-serif" font-size="27" fill="#111">
    <g stroke="#111" stroke-width="2.5" fill="none">
      ${LABELS.map(([, , pts]) => leader(pts)).join('\n      ')}
    </g>
    <g fill="#111">${LABELS.map(([, , pts]) => dot(pts.at(-1))).join('')}</g>
    ${LABELS.map(([lines, [x, y]]) => label(x, y, lines)).join('\n    ')}
  </g>

  <!-- Texture key -->
  <g font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#111">
    <text x="110" y="1430" font-weight="bold">Key:</text>
    ${KEY.map(
      ([fill, name], i) =>
        `<rect x="${180 + i * 196}" y="1410" width="34" height="26" fill="${fill}" stroke="#111" stroke-width="2"/><text x="${224 + i * 196}" y="1431">${name}</text>`,
    ).join('\n    ')}
  </g>

  <text x="620" y="1478" text-anchor="middle" font-family="Georgia, serif" font-size="26" font-style="italic" fill="#222">Figure 5.1 — Lobes and major structures of the brain.</text>

  <!-- Fact boxes -->
  <g font-family="Helvetica, Arial, sans-serif">
    <rect x="110" y="1505" width="320" height="140" rx="4" fill="#fff" stroke="#111" stroke-width="5"/>
    <text x="135" y="1550" font-size="30" font-weight="bold" fill="#111">≈86 billion</text>
    <text x="135" y="1587" font-size="22" fill="#222">neurons, linked by</text>
    <text x="135" y="1617" font-size="22" fill="#222">trillions of synapses</text>

    <rect x="460" y="1505" width="320" height="140" rx="4" fill="#fff" stroke="#111" stroke-width="5" stroke-dasharray="16 6"/>
    <text x="485" y="1550" font-size="30" font-weight="bold" fill="#111">2% of body</text>
    <text x="485" y="1587" font-size="22" fill="#222">weight, but uses about</text>
    <text x="485" y="1617" font-size="22" fill="#222">20% of its energy</text>

    <rect x="810" y="1505" width="320" height="140" rx="4" fill="#111"/>
    <text x="835" y="1550" font-size="30" font-weight="bold" fill="#fff">Scan me!</text>
    <text x="835" y="1587" font-size="22" fill="#fff">Open BeyondBook and</text>
    <text x="835" y="1617" font-size="22" fill="#fff">point your camera here</text>
  </g>

  <text x="620" y="1672" text-anchor="middle" font-family="Georgia, serif" font-size="22" fill="#444">— 63 —</text>
</svg>
`;

const out = new URL('../assets-src/brain-page.svg', import.meta.url);
await writeFile(out, svg);
console.log('Wrote', out.pathname);
