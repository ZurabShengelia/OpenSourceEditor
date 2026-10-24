import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FILTERS, type Filters } from "../src/editor/effects";
import { hash, processPixels, toneLut, applyPixelEffects } from "../src/render/pixelEffects";

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n);
function reference(d: Uint8ClampedArray, w: number, h: number, f: Filters): void {
  const lut = f.highlights || f.shadows || f.whites || f.blacks ? toneLut(f.shadows, f.highlights, f.blacks, f.whites) : null;
  const gr = 1 + f.temperature / 400, gg = 1 - f.tint / 400, gb = 1 - f.temperature / 400, vin = f.vignette / 100, film = f.film / 100, vint = f.vintage / 100;
  const cxm = w / 2, cym = h / 2, maxd = Math.hypot(cxm, cym);
  for (let py = 0, i = 0; py < h; py++) for (let px = 0; px < w; px++, i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    if (lut) { r = lut[r]!; g = lut[g]!; b = lut[b]!; }
    if (f.temperature || f.tint) { r *= gr; g *= gg; b *= gb; }
    if (vint) { const nr = 0.393 * r + 0.769 * g + 0.189 * b, ng = 0.349 * r + 0.686 * g + 0.168 * b, nb = 0.272 * r + 0.534 * g + 0.131 * b; r += (nr - r) * vint * 0.8 + 18 * vint; g += (ng - g) * vint * 0.8 + 12 * vint; b += (nb - b) * vint * 0.8 + 6 * vint; }
    if (vin) { const k = 1 - vin * Math.max(0, Math.hypot(px - cxm, py - cym) / maxd - 0.35) * 1.8; const m = k < 0 ? 0 : k; r *= m; g *= m; b *= m; }
    if (film) { const n = (hash(px, py) - 0.5) * 70 * film; r += n; g += n; b += n; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
}
let seed = 12345; const rnd = (): number => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const image = (w: number, h: number): Uint8ClampedArray => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) { d[i] = rnd() * 256; d[i + 1] = rnd() * 256; d[i + 2] = rnd() * 256; d[i + 3] = rnd() < 0.1 ? 0 : rnd() < 0.2 ? 90 : 255; } return d; };

test("optimised pixel pass is byte-identical to the original algorithm across effect combinations and sizes", () => {
  const combos: Partial<Filters>[] = [{ temperature: 30 }, { tint: -40 }, { temperature: -60, tint: 25 }, { highlights: 40 }, { shadows: -35, blacks: 20 }, { whites: 50, highlights: -20, temperature: 15 }, { vignette: 60 }, { film: 50 }, { vintage: 70 }, { vignette: 30, film: 20 }, { vintage: 40, temperature: 20, vignette: 25, film: 15, shadows: 10 }, { temperature: 100, tint: 100, highlights: 100, shadows: 100, whites: 100, blacks: 100, vignette: 100, film: 100, vintage: 100 }, { temperature: -100, tint: -100, whites: -100, blacks: -100 }];
  for (const [w, h] of [[64, 48], [37, 29], [1, 1], [200, 3]] as const) for (const c of combos) { const f = { ...DEFAULT_FILTERS, ...c }; const a = image(w, h), b = new Uint8ClampedArray(a); reference(a, w, h, f); processPixels(b, w, h, f); assert.deepEqual(b, a, `${w}x${h} ${JSON.stringify(c)}`); }
});
test("a pass with nothing to do leaves pixels untouched; transparent pixels stay untouched", () => {
  const a = image(40, 30), b = new Uint8ClampedArray(a); processPixels(b, 40, 30, { ...DEFAULT_FILTERS }); assert.deepEqual(b, a);
  const t = new Uint8ClampedArray([12, 34, 56, 0, 200, 100, 50, 255]); processPixels(t, 2, 1, { ...DEFAULT_FILTERS, temperature: 80, vignette: 50 }); assert.deepEqual([...t.slice(0, 4)], [12, 34, 56, 0]);
});

function sharpenReference(s: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  const o = new Uint8ClampedArray(s), a = amount * 1.5;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = (y * w + x) * 4; for (let c = 0; c < 3; c++) { const v = s[i + c]!, nb = (s[i - 4 + c]! + s[i + 4 + c]! + s[i - w * 4 + c]! + s[i + w * 4 + c]!) / 4; o[i + c] = clamp(v + (v - nb) * a); } }
  return o;
}
test("in-place sharpen equals the original copying sharpen byte for byte", async () => {
  const { sharpenForTest } = await import("../src/render/pixelEffects");
  for (const [w, h] of [[64, 48], [5, 5], [3, 3], [2, 9], [40, 3]] as const) for (const amount of [0.1, 0.5, 1]) { const a = image(w, h); const want = sharpenReference(a, w, h, amount); const img = { width: w, height: h, data: new Uint8ClampedArray(a) } as unknown as ImageData; sharpenForTest(img, amount); assert.deepEqual(img.data, want, `${w}x${h} amount ${amount}`); }
  void applyPixelEffects;
});
