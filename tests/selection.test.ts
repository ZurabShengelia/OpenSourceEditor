import test from "node:test";
import assert from "node:assert/strict";
import { combine, describe, invert, magicWand, maskToRects, shapeMask } from "../src/app/selection";

function img(): { d: Uint8ClampedArray; w: number; h: number } {
  const w = 8, h = 6, d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4, red = x < 4; d[i] = red ? 200 : 0; d[i + 1] = 0; d[i + 2] = red ? 0 : 200; d[i + 3] = 255; }
  const iso = (2 * w + 6) * 4; d[iso] = 200; d[iso + 2] = 0;
  const off = (0 * w + 3) * 4; d[off] = 215;
  return { d, w, h };
}
const count = (m: Uint8Array): number => m.reduce((a, b) => a + b, 0);

test("magic wand: tolerance 0 selects the exact connected color only", () => {
  const { d, w, h } = img(), m = magicWand(d, w, h, 0, 0, 0, true);
  assert.equal(count(m), 4 * 6 - 1);
  assert.equal(m[0 * w + 3], 0);
});
test("magic wand: tolerance includes near colors", () => {
  const { d, w, h } = img(), m = magicWand(d, w, h, 0, 0, 20, true);
  assert.equal(count(m), 24); assert.equal(m[3], 1);
});
test("magic wand: contiguous ignores an identical color that is not connected, whole-image does not", () => {
  const { d, w, h } = img();
  assert.equal(magicWand(d, w, h, 0, 0, 0, true)[2 * w + 6], 0);
  assert.equal(magicWand(d, w, h, 0, 0, 0, false)[2 * w + 6], 1);
  assert.equal(count(magicWand(d, w, h, 0, 0, 0, false)), 4 * 6 - 1 + 1);
});
test("magic wand: transparent pixels are a color of their own (alpha counts)", () => {
  const w = 4, h = 1, d = new Uint8ClampedArray(16); d.set([10, 10, 10, 255, 0, 0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 255]);
  assert.deepEqual([...magicWand(d, w, h, 1, 0, 0, true)], [0, 1, 1, 0]);
});
test("magic wand: out-of-range click selects nothing", () => { const { d, w, h } = img(); assert.equal(count(magicWand(d, w, h, -1, 3, 10, true)), 0); assert.equal(count(magicWand(d, w, h, 3, 99, 10, true)), 0); });
test("combine and invert", () => {
  const a = Uint8Array.from([1, 1, 0, 0]), b = Uint8Array.from([0, 1, 1, 0]);
  assert.deepEqual([...combine(a, b, "add")], [1, 1, 1, 0]); assert.deepEqual([...combine(a, b, "subtract")], [1, 0, 0, 0]);
  assert.deepEqual([...combine(a, b, "intersect")], [0, 1, 0, 0]); assert.equal(combine(a, b, "replace"), b); assert.equal(combine(null, b, "add"), b);
  assert.deepEqual([...invert(a)], [0, 0, 1, 1]);
});
test("describe: bounding box and count; empty selection is null", () => {
  const { d, w, h } = img(), s = describe(magicWand(d, w, h, 5, 0, 0, true), w, h)!;
  assert.equal(s.count, 4 * 6 - 1);
  assert.deepEqual([s.x, s.y, s.bw, s.bh], [4, 0, 4, 6]);
  assert.equal(describe(new Uint8Array(12), 4, 3), null);
});
test("maskToRects covers exactly the selected pixels, merging identical runs vertically", () => {
  const { d, w, h } = img(), m = magicWand(d, w, h, 0, 0, 0, false), r = maskToRects(m, w, h), back = new Uint8Array(w * h);
  for (let i = 0; i < r.length; i += 4) for (let y = r[i + 1]!; y < r[i + 1]! + r[i + 3]!; y++) for (let x = r[i]!; x < r[i]! + r[i + 2]!; x++) { assert.equal(back[y * w + x], 0, "rects must not overlap"); back[y * w + x] = 1; }
  assert.deepEqual([...back], [...m]);
  const solid = maskToRects(new Uint8Array(8 * 6).fill(1), 8, 6); assert.deepEqual(solid, [0, 0, 8, 6]);
});
test("shapeMask: rectangle and ellipse", () => {
  const r = shapeMask("rect", 2, 1, 3, 2, 8, 6); assert.equal(count(r), 6);
  const e = shapeMask("ellipse", 0, 0, 10, 10, 10, 10), n = count(e); assert.ok(n > 70 && n < 82, `ellipse area ${n}`); assert.equal(e[0], 0); assert.equal(e[5 * 10 + 5], 1);
  assert.equal(count(shapeMask("rect", -5, -5, 3, 3, 8, 6)), 0);
});
