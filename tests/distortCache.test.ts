import test from "node:test";
import assert from "node:assert/strict";
import * as O from "./helpers/pixelEffectsOriginal";
import { distortForTest } from "../src/render/pixelEffects";
if (typeof ImageData === "undefined") (globalThis as unknown as { ImageData: unknown }).ImageData = class { data: Uint8ClampedArray; width: number; height: number; constructor(d: Uint8ClampedArray | number, w: number, h?: number) { if (typeof d === "number") { this.width = d; this.height = w; this.data = new Uint8ClampedArray(d * w * 4); } else { this.data = d; this.width = w; this.height = h!; } } };
const frame = (w: number, h: number, seed: number): Uint8ClampedArray => { const d = new Uint8ClampedArray(w * h * 4); let s = seed; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s >>> 24; } return d; };
const same = (w: number, h: number, k: number, seed: number): void => { const a = new ImageData(frame(w, h, seed), w, h), b = new ImageData(frame(w, h, seed), w, h); const x = distortForTest(a, k), y = O.distortForTest(b, k); assert.ok(Buffer.from(x.data.buffer, x.data.byteOffset, x.data.length).equals(Buffer.from(y.data.buffer, y.data.byteOffset, y.data.length)), `${w}x${h} k=${k}`); };
test("distortion: changing strength at the same size, back and forth, never reuses a stale map", () => { for (const k of [0.3, 0.3, 0.7, 0.3, -0.4, 0.7, 0.3]) same(200, 120, k, 9); });
test("distortion: different frame content with the same map, and the same strength at another size", () => { same(200, 120, 0.5, 1); same(200, 120, 0.5, 2); same(120, 200, 0.5, 3); same(200, 120, 0.5, 4); });
test("distortion: frames above the cache limit (direct path) match the original, and the cache path still works afterwards", () => { same(1920, 1280, 0.4, 5); same(200, 120, 0.4, 6); same(1920, 1280, -0.3, 7); });
test("distortion: a frame whose pixel data does not start on a 4-byte boundary takes the safe path and still matches", () => {
  const w = 64, h = 48, base = new Uint8ClampedArray(w * h * 4 + 4); base.set(frame(w, h, 3), 1); const view = base.subarray(1, 1 + w * h * 4); const ref = new ImageData(frame(w, h, 3), w, h);
  const x = distortForTest(new ImageData(view, w, h), 0.5), y = O.distortForTest(ref, 0.5); assert.deepEqual(Buffer.from(x.data), Buffer.from(y.data));
});
