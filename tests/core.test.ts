import assert from "node:assert/strict";
import { test } from "node:test";
import { clipEnd, clipGain, evaluateFrame, fadeGain } from "../src/doc/compose";
import { deleteKeyframe, evalKeyframes, moveKeyframe, setKeyframe } from "../src/doc/keyframes";
import { ProjectError, migrateProject, newProject } from "../src/doc/migrate";
import type { TClip, Transition } from "../src/doc/schema";
import { DEFAULT_FILTERS } from "../src/editor/effects";

const clip = (o: Partial<TClip> & { id: string; trackId: string }): TClip => ({ type: "media", mediaId: "m", start: 0, srcStart: 0, srcEnd: 4, speed: 1, volume: 1, balance: 0, fadeIn: 0, fadeOut: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, crop: { l: 0, t: 0, r: 0, b: 0 }, filters: { ...DEFAULT_FILTERS }, keyframes: {}, ...o });
const proj = () => { const p = newProject("p", "P"); p.media["m"] = { id: "m", kind: "video", name: "m", mime: "video/mp4" }; p.video.tracks.splice(2, 0, { id: "V2", kind: "video", name: "V2", muted: false, solo: false, locked: false, visible: true }); return p; };

test("keyframes interpolate, clamp, hold, ease", () => {
  const k = [{ id: "a", t: 0, v: 0, ease: "linear" as const }, { id: "b", t: 2, v: 10, ease: "linear" as const }];
  assert.equal(evalKeyframes(k, 1, 5), 5); assert.equal(evalKeyframes(k, -1, 5), 0); assert.equal(evalKeyframes(k, 9, 5), 10); assert.equal(evalKeyframes(undefined, 1, 7), 7);
  assert.equal(evalKeyframes([{ id: "a", t: 0, v: 0, ease: "hold" }, { id: "b", t: 2, v: 10, ease: "linear" }], 1.9, 0), 0);
  assert.equal(evalKeyframes([{ id: "a", t: 0, v: 0, ease: "easeInOut" }, { id: "b", t: 2, v: 10, ease: "linear" }], 1, 0), 5);
});
test("keyframe add/replace/move/delete", () => {
  let kf = setKeyframe({}, "x", { id: "a", t: 1, v: 1, ease: "linear" });
  kf = setKeyframe(kf, "x", { id: "b", t: 1, v: 2, ease: "linear" }); assert.equal(kf.x?.length, 1); assert.equal(kf.x?.[0]?.v, 2);
  kf = setKeyframe(kf, "x", { id: "c", t: 3, v: 9, ease: "linear" }); kf = moveKeyframe(kf, "x", "c", 99, 4); assert.equal(kf.x?.[1]?.t, 4);
  kf = deleteKeyframe(deleteKeyframe(kf, "x", "b"), "x", "c"); assert.equal(kf.x, undefined);
});
test("evaluateFrame composites V1 + V2 with transforms, keyframes, speed", () => {
  const p = proj(); p.video.clips = { a: clip({ id: "a", trackId: "V1" }), b: clip({ id: "b", trackId: "V2", start: 1, speed: 2, srcStart: 1, srcEnd: 5, keyframes: { x: [{ id: "k", t: 0, v: 0, ease: "linear" }, { id: "j", t: 2, v: 1, ease: "linear" }] } }) };
  assert.deepEqual(evaluateFrame(p.video, 0.5).map((i) => i.clipId), ["a"]);
  const f = evaluateFrame(p.video, 2); assert.deepEqual(f.map((i) => i.clipId), ["a", "b"]);
  assert.equal(f[1]?.sourceTime, 3); assert.equal(f[1]?.x, 0.5);
  assert.deepEqual(evaluateFrame(p.video, 3.5).map((i) => i.clipId), ["a"]);
});
test("hidden track and solo", () => {
  const p = proj(); p.video.clips = { a: clip({ id: "a", trackId: "V1" }), b: clip({ id: "b", trackId: "V2" }) };
  p.video.tracks.find((t) => t.id === "V2")!.visible = false; assert.deepEqual(evaluateFrame(p.video, 1).map((i) => i.clipId), ["a"]);
  p.video.tracks.find((t) => t.id === "V2")!.visible = true; p.video.tracks.find((t) => t.id === "V2")!.solo = true; assert.deepEqual(evaluateFrame(p.video, 1).map((i) => i.clipId), ["b"]);
});
test("transitions change the composition", () => {
  const p = proj(); const a = clip({ id: "a", trackId: "V1", srcEnd: 2 }), b = clip({ id: "b", trackId: "V1", start: 2, srcEnd: 2 }); p.video.clips = { a, b };
  const tr = (kind: Transition["kind"], dir: Transition["dir"] = "l"): Transition => ({ id: "t", trackId: "V1", fromClipId: "a", toClipId: "b", kind, duration: 1, dir });
  p.video.transitions = [tr("dissolve")];
  const mid = evaluateFrame(p.video, 2); assert.deepEqual(mid.map((i) => i.clipId), ["a", "b"]); assert.equal(mid[0]?.opacity, 1); assert.equal(mid[1]?.opacity, 0.5);
  p.video.transitions = [tr("fade")]; const fd = evaluateFrame(p.video, 2); assert.equal(fd[0]?.opacity, 0.5); assert.equal(fd[1]?.opacity, 0.5); p.video.transitions = [tr("dissolve")];
  assert.deepEqual(evaluateFrame(p.video, 1.4).map((i) => i.clipId), ["a"]);
  assert.equal(evaluateFrame(p.video, 1.5)[1]?.opacity, 0);
  p.video.transitions = [tr("slide")]; const s = evaluateFrame(p.video, 2); assert.equal(s[0]?.x, -0.5); assert.equal(s[1]?.x, 0.5);
  p.video.transitions = [tr("wipe", "r")]; const w = evaluateFrame(p.video, 2); assert.deepEqual(w[1]?.reveal, { l: 0, t: 0, r: 0.5, b: 1 }); assert.equal(w[0]?.opacity, 1);
  p.video.transitions = [tr("cut")]; assert.deepEqual(evaluateFrame(p.video, 1.9).map((i) => i.clipId), ["a"]); assert.deepEqual(evaluateFrame(p.video, 2).map((i) => i.clipId), ["b"]);
});
test("fades and gain honour mute/solo", () => {
  const c = clip({ id: "a", trackId: "A1", fadeIn: 1, fadeOut: 1, volume: 0.8 }); assert.equal(fadeGain(c, 0.5), 0.5); assert.equal(fadeGain(c, 3.5), 0.5); assert.equal(fadeGain(c, 2), 1);
  const p = proj(); p.video.clips = { a: c }; assert.ok(Math.abs(clipGain(p.video, c, 2) - 0.8) < 1e-9);
  p.video.tracks.find((t) => t.id === "A1")!.muted = true; assert.equal(clipGain(p.video, c, 2), 0);
  assert.equal(clipEnd(clip({ id: "z", trackId: "V1", srcEnd: 4, speed: 2 })), 2);
});
test("migrate v1 -> v2 preserves layers, clips, overlays", () => {
  const v1 = { version: 1, id: "x", name: "Old", updatedAt: 5, state: { canvas: { w: 800, h: 600 }, layerSel: "l1", videoSel: null,
    layers: [{ id: "l1", kind: "image", assetId: "A", name: "Photo", visible: true, x: 10, y: 20, scale: 2, rotation: 5, opacity: 0.5, blend: "multiply", filters: { brightness: 120 } }, { id: "l2", kind: "text", name: "T", text: "Hi", size: 40, font: "serif", weight: 700, color: "#f00", visible: false, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, filters: DEFAULT_FILTERS }],
    clips: [{ id: "c1", assetId: "V", start: 1, srcStart: 0, srcEnd: 6, speed: 2, volume: 0.5, filters: DEFAULT_FILTERS }], overlays: [{ id: "o1", text: "Title", start: 0, duration: 3, size: 50, color: "#fff", x: 0.5, y: 0.8 }] } };
  const p = migrateProject(v1); assert.equal(p.version, 2); assert.equal(p.photo.width, 800);
  const [l1, l2] = p.photo.root.children; assert.equal(l1?.kind, "image"); assert.equal(l1?.blend, "multiply"); assert.equal(l1?.opacity, 0.5); assert.equal(l2?.visible, false);
  assert.equal(l1?.kind === "image" && l1.filters.brightness, 120); assert.equal(l1?.kind === "image" && l1.filters.contrast, 100);
  assert.equal(p.video.clips["c1"]?.trackId, "V1"); assert.equal(p.video.clips["c1"]?.speed, 2); assert.equal(p.video.clips["o1"]?.type, "text"); assert.ok(Math.abs((p.video.clips["o1"]?.transform.y ?? 9) - 0.3) < 1e-9);
  assert.equal(p.media["V"]?.kind, "video"); assert.equal(p.media["A"]?.kind, "image");
  assert.equal(migrateProject(p).version, 2);
});
test("corrupt / future / invalid data is rejected, not trusted", () => {
  for (const bad of [null, 5, [], {}, { version: 99 }, { version: 1 }, { version: 1, state: 3 }]) assert.throws(() => migrateProject(bad), ProjectError);
  const p = proj(); p.video.clips = { a: clip({ id: "a", trackId: "NOPE" }) }; assert.throws(() => migrateProject(p), /missing track/);
  const q = proj(); q.video.clips = { a: clip({ id: "a", trackId: "V1", speed: 0 }) }; assert.throws(() => migrateProject(q), /invalid timing/);
  const r = proj(); r.video.clips = { a: clip({ id: "a", trackId: "V1", mediaId: "ghost" }) }; assert.throws(() => migrateProject(r), /missing media/);
});
