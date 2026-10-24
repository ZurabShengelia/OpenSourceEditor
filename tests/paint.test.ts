import assert from "node:assert/strict";
import { test } from "node:test";
import { floodFill, hexToRgba, rgbaToHex, stampPoints } from "../src/app/paint";

const grid = (w: number, h: number, f: (x: number, y: number) => number[]) => { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4); return d; };
test("flood fill stays inside a wall and respects tolerance", () => {
  const d = grid(6, 6, (x) => (x === 3 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
  assert.equal(floodFill(d, 6, 6, 0, 0, [255, 0, 0, 255], 0), 18); assert.deepEqual(Array.from(d.slice(0, 4)), [255, 0, 0, 255]); assert.deepEqual(Array.from(d.slice(3 * 4, 3 * 4 + 4)), [0, 0, 0, 255]); assert.deepEqual(Array.from(d.slice(5 * 4, 5 * 4 + 4)), [255, 255, 255, 255]);
  const g = grid(4, 1, (x) => [x * 10, 0, 0, 255]); assert.equal(floodFill(g, 4, 1, 0, 0, [0, 255, 0, 255], 12), 2); assert.equal(floodFill(new Uint8ClampedArray(4), 1, 1, 5, 5, [1, 1, 1, 1], 0), 0);
});
test("flood fill honours a selection predicate", () => { const d = grid(4, 4, () => [9, 9, 9, 255]); assert.equal(floodFill(d, 4, 4, 0, 0, [1, 2, 3, 255], 0, (x) => x < 2), 8); });
test("stamp spacing is continuous across segments", () => {
  const a = stampPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 8); assert.deepEqual(a.pts.map((p) => p.x), [2, 4, 6, 8, 10]);
  const b = stampPoints({ x: 0, y: 0 }, { x: 3, y: 0 }, 8); const c = stampPoints({ x: 3, y: 0 }, { x: 6, y: 0 }, 8, b.carry); assert.deepEqual([...b.pts, ...c.pts].map((p) => p.x), [2, 4, 6]);
});
test("colour helpers", () => { assert.deepEqual(hexToRgba("#d3a24a"), [211, 162, 74, 255]); assert.deepEqual(hexToRgba("#fff"), [255, 255, 255, 255]); assert.equal(rgbaToHex(211, 162, 74), "#d3a24a"); });
