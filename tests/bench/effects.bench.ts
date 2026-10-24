import { DEFAULT_FILTERS, type Filters } from "../../src/editor/effects";
import { processPixels, sharpenForTest, chromaForTest, distortForTest } from "../../src/render/pixelEffects";
if (typeof (globalThis as any).ImageData === "undefined") (globalThis as any).ImageData = class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} };
const W = 1280, H = 720, FRAMES = 60, WARM = 10;
const src = new Uint8ClampedArray(W * H * 4); let s = 12345; for (let i = 0; i < src.length; i += 4) { s = (s * 1664525 + 1013904223) >>> 0; const x = (i / 4) % W, y = Math.floor(i / 4 / W); src[i] = (x / W) * 255; src[i + 1] = (y / H) * 255; src[i + 2] = s >>> 24; src[i + 3] = 255; }
const f = (o: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...o });
const cases: [string, (img: { data: Uint8ClampedArray; width: number; height: number }) => void][] = [
  ["tone+temperature (LUT only)", (im) => processPixels(im.data, W, H, f({ highlights: 30, shadows: 20, temperature: 15 }))],
  ["vignette", (im) => processPixels(im.data, W, H, f({ vignette: 50 }))],
  ["film grain", (im) => processPixels(im.data, W, H, f({ film: 40 }))],
  ["vintage + vignette + grain", (im) => processPixels(im.data, W, H, f({ vintage: 60, vignette: 40, film: 30 }))],
  ["sharpen", (im) => sharpenForTest(im as any, 0.6)],
  ["chromatic aberration", (im) => chromaForTest(im as any, 6)],
  ["distortion", (im) => distortForTest(im as any, 0.3)],
  ["everything above together", (im) => { distortForTest(im as any, 0.3); chromaForTest(im as any, 6); sharpenForTest(im as any, 0.6); processPixels(im.data, W, H, f({ highlights: 30, shadows: 20, temperature: 15, vintage: 60, vignette: 40, film: 30 })); }],
];
const rows: string[] = [];
for (const [name, run] of cases) {
  const work = new Uint8ClampedArray(src.length); const im = { data: work, width: W, height: H }; const t: number[] = [];
  for (let n = 0; n < WARM + FRAMES; n++) { work.set(src); const t0 = performance.now(); run(im); if (n >= WARM) t.push(performance.now() - t0); }
  t.sort((a, b) => a - b); const mean = t.reduce((a, b) => a + b, 0) / t.length; rows.push(`${name.padEnd(30)} mean ${mean.toFixed(2).padStart(7)} ms  median ${t[t.length >> 1]!.toFixed(2).padStart(7)}  p95 ${t[Math.floor(t.length * 0.95)]!.toFixed(2).padStart(7)}  => ${(1000 / mean).toFixed(0).padStart(4)} fps`);
}
console.log(`720p (${W}x${H}), ${FRAMES} frames per effect after ${WARM} warm-up, ${process.version}\n` + rows.join("\n"));
