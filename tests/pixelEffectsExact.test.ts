import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FILTERS, type Filters } from "../src/editor/effects";
import { chromaForTest, distortForTest, processPixels, sharpenForTest } from "../src/render/pixelEffects";
import * as O from "./helpers/pixelEffectsOriginal";

if (typeof ImageData === "undefined") (globalThis as unknown as { ImageData: unknown }).ImageData = class { data: Uint8ClampedArray; width: number; height: number; constructor(d: Uint8ClampedArray | number, w: number, h?: number) { if (typeof d === "number") { this.width = d; this.height = w; this.data = new Uint8ClampedArray(d * w * 4); } else { this.data = d; this.width = w; this.height = h!; } } };

const frame = (w: number, h: number): Uint8ClampedArray => { const d = new Uint8ClampedArray(w * h * 4); let s = 12345; for (let i = 0; i < d.length; i += 4) { s = (Math.imul(s, 1103515245) + 12345) | 0; d[i] = s >>> 8; d[i + 1] = s >>> 16; d[i + 2] = s >>> 4; d[i + 3] = i % 97 === 0 ? 0 : 255; } return d; };
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray): boolean => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const f = (o: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...o });
const SIZES: [number, number][] = [[1, 1], [2, 3], [37, 29], [320, 180], [301, 199]];

test("processPixels is byte-identical to the original for every effect combination and size", () => {
  const combos = [f({ vignette: 60 }), f({ vignette: 100, film: 100 }), f({ vintage: 70, vignette: 40, film: 30 }), f({ film: 55 }), f({ highlights: 30, shadows: -20, temperature: 15, tint: -10 }), f({ vintage: 100 }), f({})];
  for (const [w, h] of SIZES) for (const fl of combos) { const a = frame(w, h), b = frame(w, h); O.processPixels(a, w, h, fl); processPixels(b, w, h, fl); assert.ok(same(a, b), `${w}x${h} ${JSON.stringify(Object.fromEntries(Object.entries(fl).filter(([k, v]) => v !== (DEFAULT_FILTERS as Record<string, number>)[k])))}`); }
});
test("chromatic aberration (in place) is byte-identical to the original, including edges and tiny frames", () => {
  for (const [w, h] of SIZES) for (const px of [0, 1, 2, 4, 9, 400]) { const a = new ImageData(frame(w, h), w, h), b = new ImageData(frame(w, h), w, h); const oa = O.chromaForTest(a, px), ob = chromaForTest(b, px); assert.ok(same(oa.data, ob.data), `${w}x${h} k=${px}`); }
});
test("distortion with a reused buffer is byte-identical to the original, also across repeated calls and size changes", () => {
  for (const k of [0.4, -0.5, 1]) for (const [w, h] of [...SIZES, [37, 29], [320, 180]] as [number, number][]) { const a = new ImageData(frame(w, h), w, h), b = new ImageData(frame(w, h), w, h); const oa = O.distortForTest(a, k), ob = distortForTest(b, k); assert.ok(same(oa.data, ob.data), `${w}x${h} k=${k}`); }
});
test("sharpen is unchanged", () => { const a = new ImageData(frame(64, 48), 64, 48), b = new ImageData(frame(64, 48), 64, 48); assert.ok(same(O.sharpenForTest(a, 0.7).data, sharpenForTest(b, 0.7).data)); });
