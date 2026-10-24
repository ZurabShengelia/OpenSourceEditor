import { test } from "node:test";
import assert from "node:assert/strict";
import { alignDelta, fitAspect, rectOf, snapMove, targetsFor } from "../src/app/snap";
import { ANIM_PRESETS, applyPreset, evalKeyframes, hasAnimation } from "../src/doc/keyframes";
import { textMetrics } from "../src/doc/text";

const T = { transform: { x: 0.1, y: 0.2, scale: 1, rotation: 0, opacity: 0.8 } };
let n = 0; const id = (): string => `k${n++}`;

test("rectOf: rotated box bounds", () => {
  const r = rectOf({ cx: 100, cy: 50, w: 40, h: 20, rot: 90 }); assert.ok(Math.abs(r.r - r.l - 20) < 1e-9 && Math.abs(r.b - r.t - 40) < 1e-9);
  const q = rectOf({ cx: 0, cy: 0, w: 10, h: 10, rot: 0 }); assert.deepEqual(q, { l: -5, r: 5, t: -5, b: 5 });
});
test("snapMove: snaps centre to canvas centre within radius, reports guide", () => {
  const t = targetsFor(1000, 600, []); const r = { l: 100, r: 300, t: 100, b: 200 };
  const s = snapMove(r, 296, 0, t, 8);
  assert.equal(s.dx, 300); assert.deepEqual(s.gx, [500]);
});
test("snapMove: no snap outside radius, delta untouched", () => {
  const s = snapMove({ l: 0, r: 100, t: 0, b: 100 }, 213, 77, targetsFor(1000, 600, []), 4); assert.equal(s.dx, 213); assert.equal(s.dy, 77); assert.deepEqual(s.gx, []);
});
test("snapMove: snaps edge to another layer's edge", () => {
  const other = { l: 400, r: 500, t: 0, b: 50 }; const s = snapMove({ l: 0, r: 100, t: 300, b: 350 }, 297, 0, targetsFor(2000, 2000, [other]), 6);
  assert.equal(s.dx, 300); assert.ok(s.gx.includes(400));
});
test("alignDelta", () => {
  const r = { l: 10, r: 110, t: 20, b: 60 };
  assert.deepEqual(alignDelta(r, "left", 800, 600), { dx: -10, dy: 0 }); assert.deepEqual(alignDelta(r, "right", 800, 600), { dx: 690, dy: 0 });
  assert.deepEqual(alignDelta(r, "hcenter", 800, 600), { dx: 340, dy: 0 }); assert.deepEqual(alignDelta(r, "vmiddle", 800, 600), { dx: 0, dy: 260 });
});
test("fitAspect centres the largest fitting rect", () => {
  assert.deepEqual(fitAspect(1000, 500, 1), { x: 250, y: 0, w: 500, h: 500 }); const w = fitAspect(1000, 1000, 16 / 9); assert.ok(Math.abs(w.w / w.h - 16 / 9) < 1e-9 && w.y > 0);
});
test("animation presets write real, evaluable keyframes", () => {
  for (const p of ANIM_PRESETS) { const kf = applyPreset({}, p.id, T, 4, id); assert.ok(hasAnimation(kf), p.id); }
  const fi = applyPreset({}, "fadeIn", T, 4, id); assert.equal(evalKeyframes(fi.opacity, 0, 0.8), 0); assert.equal(evalKeyframes(fi.opacity, 3, 0.8), 0.8);
  const fo = applyPreset({}, "fadeOut", T, 4, id); assert.equal(evalKeyframes(fo.opacity, 4, 0.8), 0); assert.equal(evalKeyframes(fo.opacity, 0, 0.8), 0.8);
  const su = applyPreset({ x: [{ id: "keep", t: 0, v: 0, ease: "linear" }] }, "slideUp", T, 4, id); assert.ok(su.x && su.y && su.opacity, "other props untouched"); assert.ok(evalKeyframes(su.y, 0, 0.2) > 0.2);
  const tiny = applyPreset({}, "pop", T, 0.1, id); assert.ok(tiny.scale!.every((k) => k.t <= 0.1 + 1e-9), "short clips clamp the preset duration");
});
test("textMetrics defaults keep old projects unchanged", () => {
  const m = textMetrics({ text: "x", font: "f", size: 10, weight: 400, italic: false, align: "left", color: "#fff", outline: 0, outlineColor: "#000", shadow: 9 });
  assert.deepEqual(m, { lineHeight: 1.2, tracking: 0, shadowColor: "#000000", shadowX: 0, shadowY: 3 });
});
