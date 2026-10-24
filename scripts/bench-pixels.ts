import { DEFAULT_FILTERS, type Filters } from "../src/editor/effects";
import { chromaForTest, distortForTest, processPixels, sharpenForTest } from "../src/render/pixelEffects";
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 720), N = Number(process.env.N ?? 15);
const base = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < base.length; i += 4) { const p = i / 4, x = p % W, y = (p / W) | 0; base[i] = (x * 255) / W; base[i + 1] = (y * 255) / H; base[i + 2] = (x ^ y) & 255; base[i + 3] = 255; }
const f = (o: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...o });
const sum = (d: Uint8ClampedArray): number => { let s = 0; for (let i = 0; i < d.length; i += 97) s = (s * 31 + d[i]!) >>> 0; return s; };
const cases: [string, (img: ImageData) => ImageData][] = [
  ["tone+temperature (LUT path)", (i) => { processPixels(i.data, W, H, f({ highlights: 30, shadows: 20, temperature: 15 })); return i; }],
  ["vignette", (i) => { processPixels(i.data, W, H, f({ vignette: 60 })); return i; }],
  ["film grain", (i) => { processPixels(i.data, W, H, f({ film: 40 })); return i; }],
  ["vintage+vignette+film", (i) => { processPixels(i.data, W, H, f({ vintage: 50, vignette: 40, film: 30 })); return i; }],
  ["sharpen", (i) => sharpenForTest(i, 0.5)],
  ["chromatic aberration", (i) => chromaForTest(i, 4)],
  ["distortion", (i) => distortForTest(i, 0.4)],
];
for (const [name, fn] of cases) {
  const ts: number[] = []; let cs = 0;
  for (let r = 0; r < N + 2; r++) { const img = new ImageData(new Uint8ClampedArray(base), W, H); const t0 = performance.now(); const out = fn(img); const t = performance.now() - t0; if (r >= 2) ts.push(t); cs = sum(out.data); }
  ts.sort((a, b) => a - b); console.log(`${name.padEnd(30)} median ${ts[ts.length >> 1]!.toFixed(1).padStart(6)} ms   checksum ${cs}`);
}
