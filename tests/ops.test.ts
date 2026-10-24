import assert from "node:assert/strict";
import { test } from "node:test";
import { clipDuration, clipEnd, clipGain, evaluateFrame } from "../src/doc/compose";
import { beginGesture, canRedo, canUndo, commit, createHistory, endGesture, redo, undo, updateGesture } from "../src/doc/history";
import { addNode, duplicate, find, flatten, groupNodes, moveTo, reorder, removeNode, ungroup } from "../src/doc/layerOps";
import { group, newProject } from "../src/doc/migrate";
import type { LayerNode, TClip } from "../src/doc/schema";
import { DEFAULT_FILTERS } from "../src/editor/effects";
import * as V from "../src/doc/videoOps";

const clip = (id: string, trackId: string, start: number, dur: number, o: Partial<TClip> = {}): TClip => ({ id, trackId, type: "media", mediaId: "m", start, srcStart: 0, srcEnd: dur, speed: 1, volume: 1, balance: 0, fadeIn: 0, fadeOut: 0,
  transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, crop: { l: 0, t: 0, r: 0, b: 0 }, filters: { ...DEFAULT_FILTERS }, keyframes: {}, ...o });
const doc = (...cs: TClip[]) => { const v = newProject("p", "p").video; v.clips = Object.fromEntries(cs.map((c) => [c.id, c])); return v; };
const img = (id: string): LayerNode => ({ kind: "image", id, name: id, visible: true, locked: false, opacity: 1, blend: "source-over", x: 0, y: 0, scale: 1, rotation: 0, mediaId: "m", filters: { ...DEFAULT_FILTERS } });

test("history: select-like no-ops add nothing; gesture = one undo step", () => {
  let h = createHistory({ n: 0 }); const same = h.present; assert.equal(commit(h, same), h);
  h = beginGesture(h); for (let i = 1; i <= 50; i++) h = updateGesture(h, { n: i }); h = endGesture(h);
  assert.equal(h.past.length, 1); assert.equal(h.present.n, 50);
  h = undo(h); assert.equal(h.present.n, 0); assert.ok(canRedo(h)); h = redo(h); assert.equal(h.present.n, 50);
  h = commit(h, { n: 99 }); assert.equal(canRedo(h), false); assert.ok(canUndo(h));
  const base = { n: 1 }; const e = endGesture(updateGesture(beginGesture(createHistory(base)), base)); assert.equal(e.past.length, 0);
});
test("history limit", () => { let h = createHistory(0, 3); for (let i = 1; i < 10; i++) h = commit(h, i); assert.equal(h.past.length, 3); });

test("move: blocks overlap and locked tracks, clamps at 0, allows cross-track same kind only", () => {
  let v = doc(clip("a", "V1", 0, 2), clip("b", "V1", 3, 2)); assert.equal(V.moveClip(v, "b", 1), v); assert.equal(V.moveClip(v, "b", 2)?.clips["b"]?.start, 2);
  assert.equal(V.moveClip(v, "a", -5).clips["a"]?.start ?? 0, 0); assert.equal(V.moveClip(v, "b", 0, "A1"), v);
  v = V.addTrack(v, "video"); const id = v.tracks.find((t) => t.id.startsWith("V") && t.id !== "V1")!.id; assert.equal(V.moveClip(v, "b", 0, id).clips["b"]?.trackId, id);
  v = V.patchTrack(v, "V1", { locked: true }); assert.equal(V.moveClip(v, "a", 1), v);
});
test("split keeps source continuity with speed, partitions keyframes, rewires transitions", () => {
  let v = doc(clip("a", "V1", 1, 4, { speed: 2, srcStart: 2, srcEnd: 10, keyframes: { x: [{ id: "k1", t: 0.5, v: 0, ease: "linear" }, { id: "k2", t: 3, v: 1, ease: "linear" }] } }), clip("n", "V1", 5, 1));
  v = V.setTransition(v, "a", "n", "dissolve", 0.5, "l", "t1"); const s = V.splitClip(v, "a", 2, "a2");
  assert.equal(s.clips["a"]?.srcEnd, 4); assert.equal(s.clips["a2"]?.srcStart, 4); assert.equal(s.clips["a2"]?.start, 2); assert.equal(clipEnd(s.clips["a2"]!), 5);
  assert.deepEqual(s.clips["a"]?.keyframes.x?.map((k) => k.id), ["k1"]); assert.deepEqual(s.clips["a2"]?.keyframes.x?.map((k) => [k.id, k.t]), [["k2", 2]]);
  assert.equal(s.transitions[0]?.fromClipId, "a2"); assert.equal(V.splitClip(v, "a", 1, "z"), v); assert.equal(V.splitClip(v, "a", 99, "z"), v);
});
test("trim start/end respect source bounds, min duration and neighbours", () => {
  const v = doc(clip("a", "V1", 2, 4, { srcStart: 1, srcEnd: 5 }), clip("b", "V1", 7, 2));
  assert.equal(V.trimStart(v, "a", 3).clips["a"]?.srcStart, 2); assert.equal(V.trimStart(v, "a", 0).clips["a"]?.start, 1);
  assert.equal(V.trimEnd(v, "a", 4, 5).clips["a"]?.srcEnd, 3); assert.equal(V.trimEnd(v, "a", 99, 5).clips["a"]?.srcEnd, 5);
  assert.ok(clipEnd(V.trimStart(v, "a", 100).clips["a"]!) - V.trimStart(v, "a", 100).clips["a"]!.start >= V.MIN_DUR - 1e-9);
});
test("duplicate lands in free space; delete cleans transitions; speed refuses overlap", () => {
  let v = doc(clip("a", "V1", 0, 2), clip("b", "V1", 2, 2)); v = V.setTransition(v, "a", "b", "fade", 0.5, "l", "t");
  const d = V.duplicateClip(v, "a", "a2"); assert.equal(d.clips["a2"]?.start, 4); assert.equal(V.deleteClips(v, ["b"]).transitions.length, 0);
  assert.equal(V.setSpeed(v, "a", 0.5), v); assert.equal(V.setSpeed(doc(clip("a", "V1", 0, 2)), "a", 2).clips["a"]?.speed, 2);
});
test("snap prefers nearest edge within radius", () => {
  const v = doc(clip("a", "V1", 0, 2), clip("b", "V1", 5, 1)); assert.deepEqual(V.snap(v, 4.95, 3, 0.1), { t: 5, hit: 5 }); assert.deepEqual(V.snap(v, 3.9, 3, 0.1), { t: 3.9, hit: null }); assert.equal(V.snap(v, 5.02, 5.01, 0.1, "b").hit, 5.01);
});
test("tracks: add keeps video above, remove drops its clips", () => {
  let v = doc(clip("a", "V1", 0, 1)); v = V.addTrack(v, "audio"); assert.equal(v.tracks.at(-1)?.kind, "audio"); v = V.addTrack(v, "video");
  assert.ok(v.tracks.findIndex((t) => t.id === "V2") > v.tracks.findIndex((t) => t.id === "V1")); assert.equal(V.removeTrack(v, "V1").clips["a"], undefined);
});

test("layer tree: add/reorder/group/ungroup/move/duplicate/remove", () => {
  let r = group("root", "Root", []); for (const i of ["a", "b", "c"]) r = addNode(r, img(i));
  r = reorder(r, "a", 1); assert.deepEqual(r.children.map((c) => c.id), ["b", "a", "c"]); assert.equal(reorder(r, "c", 5), r);
  r = groupNodes(r, ["b", "a"], "g1"); assert.deepEqual(r.children.map((c) => c.id), ["g1", "c"]); const g = find(r, "g1")!.node; assert.equal(g.kind === "group" && g.children.length, 2);
  r = reorder(r, "a", -1); const g2 = find(r, "g1")!.node; assert.deepEqual(g2.kind === "group" && g2.children.map((c) => c.id), ["a", "b"]);
  assert.equal(moveTo(r, "g1", "g1"), r); r = moveTo(r, "c", "g1"); assert.equal(find(r, "c")?.parent.id, "g1");
  let n = 0; r = duplicate(r, "g1", () => `n${n++}`); assert.equal(r.children.length, 2); assert.equal(new Set(flatten(r).map((x) => x.id)).size, flatten(r).length);
  r = ungroup(r, "g1"); assert.ok(!find(r, "g1")); r = removeNode(r, "a"); assert.ok(!find(r, "a"));
});

test("detach audio: independent clips, source kept, delete either side leaves the other, link restores", () => {
  let v = doc(clip("v", "V1", 2, 10, { volume: 0.7, fadeIn: 1 })); v.tracks = [...v.tracks]; const a = v.tracks.find((t) => t.kind === "audio")!;
  assert.equal(V.canDetach(v, "v", true), true); assert.equal(V.canDetach(v, "v", false), false);
  const d = V.detachAudio(v, "v", "a", a.id, "L1");
  assert.equal(d.clips.v!.detached, true); assert.equal(d.clips.a!.trackId, a.id); assert.equal(d.clips.a!.volume, 0.7); assert.equal(d.clips.a!.fadeIn, 1); assert.equal(d.clips.v!.fadeIn, 0);
  assert.equal(clipGain(d, d.clips.v!, 3), 0); assert.ok(clipGain(d, d.clips.a!, 3) > 0);
  assert.equal(V.detachAudio(d, "v", "a2", a.id, "L2"), d);
  const noVid = V.deleteClips(d, ["v"]); assert.ok(noVid.clips.a && !noVid.clips.v);
  const noAud = V.deleteClips(d, ["a"]); assert.ok(noAud.clips.v && !noAud.clips.a);
  const mv = V.moveClip(d, "a", 5); assert.equal(mv.clips.a!.start, 5); assert.equal(mv.clips.v!.start, 2);
  const back = V.linkAudio(mv, "a"); assert.equal(back.clips.a, undefined); assert.equal(back.clips.v!.detached, undefined); assert.equal(back.clips.v!.volume, 0.7);
  assert.equal(V.linkAudio(noVid, "a"), noVid);
});

test("clip switches: mute/disable silence or hide, lock protects, lock itself can always be toggled", () => {
  const v = doc(clip("a", "V1", 0, 4)); const m = V.setClipFlag(v, ["a"], "muted", true);
  assert.equal(clipGain(m, m.clips.a!, 1), 0); assert.equal(evaluateFrame(m, 1).length, 1);
  const d = V.setClipFlag(v, ["a"], "disabled", true); assert.equal(clipGain(d, d.clips.a!, 1), 0); assert.equal(evaluateFrame(d, 1).length, 0);
  const l = V.setClipFlag(v, ["a"], "locked", true); assert.equal(V.moveClip(l, "a", 3), l); assert.equal(V.deleteClips(l, ["a"]), l); assert.equal(V.setClipFlag(l, ["a"], "muted", true), l);
  assert.equal(V.setClipFlag(l, ["a"], "locked", false).clips.a!.locked, undefined); assert.equal(V.flagTarget(m, ["a"], "muted"), false); assert.equal(V.flagTarget(v, ["a"], "muted"), true);
});
test("markers: add (one per frame), rename, move, remove, neighbours, snapping", () => {
  let v = doc(clip("a", "V1", 0, 4)); v = V.addMarker(v, 2, "m1"); assert.equal(V.addMarker(v, 2.001, "dup"), v); v = V.addMarker(v, 1, "m2", "Intro");
  assert.deepEqual(V.sortedMarkers(v).map((m) => m.id), ["m2", "m1"]); assert.equal(V.neighbourMarker(v, 1.5, 1)!.id, "m1"); assert.equal(V.neighbourMarker(v, 1.5, -1)!.id, "m2"); assert.equal(V.neighbourMarker(v, 2, 1), undefined);
  assert.equal(V.snap(v, 2.05, 10, 0.1).hit, 2); v = V.renameMarker(v, "m1", "Cut"); v = V.moveMarker(v, "m1", 3); assert.equal(v.markers!.find((m) => m.id === "m1")!.t, 3); assert.equal(V.removeMarker(v, "m1").markers!.length, 1);
});
test("track layout: height clamps, collapse is a fixed slim row", () => {
  const t = doc().tracks[0]!; assert.equal(V.rowHeight({ ...t, height: 9999 }), V.TRACK_H.max); assert.equal(V.rowHeight({ ...t, height: 1 }), V.TRACK_H.min); assert.equal(V.rowHeight({ ...t, collapsed: true }), V.COLLAPSED_H); assert.equal(V.rowHeight({ ...t, height: undefined }), V.defaultRow(t.kind));
});
test("copy/paste: offsets kept, new ids, tracks reused, collisions go to a free/new track, transitions and link pairs remapped", () => {
  let v = doc(clip("a", "V1", 0, 2), clip("b", "V1", 2, 2)); v = V.setTransition(v, "a", "b", "dissolve", 0.5, "l", "tr1");
  const snap = V.copyClips(v, ["a", "b"])!; let n = 0; const mk = (): string => `n${++n}`;
  const p = V.pasteClips(v, snap, 10, mk); assert.equal(p.ids.length, 2); const [x, y] = p.ids.map((i) => p.video.clips[i]!); assert.equal(x!.start, 10); assert.equal(y!.start, 12); assert.equal(x!.trackId, "V1");
  assert.equal(p.video.transitions.length, v.transitions.length * 2); assert.ok(p.video.clips.a && p.video.clips.b);
  const q = V.pasteClips(p.video, snap, 0, mk); assert.notEqual(q.video.clips[q.ids[0]!]!.trackId, "V1"); assert.ok(q.video.tracks.length > p.video.tracks.length);
  const a = v.tracks.find((t) => t.kind === "audio")!; const d = V.detachAudio(doc(clip("vv", "V1", 0, 3)), "vv", "aa", a.id, "L"); const both = V.copyClips(d, ["vv", "aa"])!; const pp = V.pasteClips(d, both, 20, mk);
  const [pv, pa] = pp.ids.map((i) => pp.video.clips[i]!); assert.equal(pv!.linkId, pa!.linkId); assert.notEqual(pv!.linkId, "L");
  const one = V.pasteClips(d, V.copyClips(d, ["vv"])!, 20, mk); assert.equal(one.video.clips[one.ids[0]!]!.linkId, undefined);
  const to = V.pasteClips(v, V.copyClips(v, ["a"])!, 5, mk, v.tracks.find((t) => t.kind === "video" && t.id !== "V1")?.id); assert.equal(to.ids.length, 1);
  assert.equal(V.copyClips(v, ["nope"]), null);
});

test("persistence: markers, track layout, clip switches and links survive a JSON round trip; corrupt values are dropped", async () => {
  const { migrateProject } = await import("../src/doc/migrate");
  const p = newProject("p", "p"); p.media["m"] = { id: "m", name: "m", kind: "video", duration: 4, width: 16, height: 9, hasAudio: true } as never;
  p.video.clips = { v: clip("v", "V1", 0, 4, { detached: true, linkId: "L", muted: true, disabled: true, locked: true }), a: clip("a", p.video.tracks.find((t) => t.kind === "audio")!.id, 0, 4, { linkId: "L" }) };
  p.video.markers = [{ id: "k1", t: 1.5, name: "Intro" }]; p.video.tracks[0] = { ...p.video.tracks[0]!, height: 90, collapsed: true };
  const back = migrateProject(JSON.parse(JSON.stringify(p))); assert.deepEqual(back.video.markers, [{ id: "k1", t: 1.5, name: "Intro" }]);
  assert.equal(back.video.tracks[0]!.height, 90); assert.equal(back.video.tracks[0]!.collapsed, true); const c = back.video.clips.v!; assert.ok(c.detached && c.muted && c.disabled && c.locked && c.linkId === "L");
  const bad = JSON.parse(JSON.stringify(p)); bad.video.markers = [{ id: "x", t: "soon" }, { id: "y", t: -1 }, { id: "z", t: 2, name: 7 }]; bad.video.tracks[0].height = "tall";
  const fixed = migrateProject(bad); assert.deepEqual(fixed.video.markers, [{ id: "z", t: 2, name: "" }]); assert.equal(fixed.video.tracks[0]!.height, undefined);
});

test("compound clips: create, nested evaluation, flattened audio timing, break apart, prune, media removal", async () => {
  const { flatClips, liveClipIds, mediaUseCount } = await import("../src/doc/compose");
  let v = doc(clip("a", "V1", 2, 3), clip("b", "V1", 5, 2)); v = V.setTransition(v, "a", "b", "dissolve", 0.5, "l", "t1");
  const c = V.createCompound(v, ["a", "b"], "K", "C"); const cc = c.clips.C!;
  assert.deepEqual(Object.keys(c.clips), ["C"]); assert.equal(cc.type, "compound"); assert.equal(cc.start, 2); assert.equal(clipEnd(cc), 7); assert.equal(c.compounds!.K!.length, 5);
  assert.equal(c.compounds!.K!.clips.a!.start, 0); assert.equal(c.compounds!.K!.transitions.length, 1); assert.equal(c.transitions.length, 0);
  const f = evaluateFrame(c, 3); assert.equal(f.length, 1); assert.equal(f[0]!.compoundId, "K"); assert.equal(f[0]!.sourceTime, 1);
  const flat = flatClips(c); assert.deepEqual(flat.map((x) => x.clip.id).sort(), ["C/a", "C/b"]); assert.equal(flat.find((x) => x.clip.id === "C/b")!.clip.start, 5);
  assert.ok(flat[0]!.gain(3) > 0); assert.equal(flatClips(V.setClipFlag(c, ["C"], "muted", true))[0]!.gain(3), 0);
  assert.ok(liveClipIds(c, 3).has("C/a") && liveClipIds(c, 3).has("C")); assert.equal(mediaUseCount(c, "m"), 2);
  let t = V.splitClip(c, "C", 4, "C2"); const right = flatClips(t).filter((x) => x.clip.id.startsWith("C2/")); assert.equal(right.length, 2);
  const tail = right.find((x) => x.clip.id === "C2/a")!.clip; assert.equal(tail.start, 4); assert.ok(Math.abs(clipEnd(tail) - 5) < 1e-6);
  const fast = V.setSpeed(c, "C", 2); const fa = flatClips(fast).find((x) => x.clip.id === "C/a")!.clip; assert.equal(fa.speed, 2); assert.equal(clipEnd(flatClips(fast).find((x) => x.clip.id === "C/b")!.clip), clipEnd(fast.clips.C!));
  let n = 0; const back = V.breakApart(c, "C", () => `n${++n}`)!; const bc = Object.values(back.video.clips).sort((x, y) => x.start - y.start); assert.deepEqual(bc.map((x) => [x.start, clipDuration(x)]), [[2, 3], [5, 2]]); assert.equal(back.video.transitions.length, 1); assert.equal(back.video.compounds, undefined);
  assert.equal(V.deleteClips(c, ["C"]).compounds, undefined); const dup = V.duplicateClip(c, "C", "C3"); assert.ok(V.deleteClips(dup, ["C"]).compounds!.K);
  assert.deepEqual(Object.keys(V.dropMedia(c, "m").clips), []); assert.equal(V.dropMedia(c, "m").compounds, undefined);
  const lockedDoc = V.setClipFlag(v, ["a"], "locked", true); assert.equal(V.createCompound(lockedDoc, ["a", "b"], "K", "C"), lockedDoc);
  const gap = doc(clip("a", "V1", 0, 2), clip("x", "V1", 2, 2), clip("b", "V1", 4, 2)); const g = V.createCompound(gap, ["a", "b"], "K", "C"); assert.notEqual(g.clips.C!.trackId, "V1"); assert.ok(g.clips.x);
});

test("compound persistence: survives a JSON round trip; missing media / dangling / cyclic compounds are rejected", async () => {
  const { migrateProject } = await import("../src/doc/migrate");
  const p = newProject("p", "p"); p.media["m"] = { id: "m", name: "m", kind: "video", duration: 4, width: 16, height: 9, hasAudio: true } as never;
  p.video.clips = { a: clip("a", "V1", 0, 2), b: clip("b", "V1", 2, 2) }; p.video = V.createCompound(p.video, ["a", "b"], "K", "C");
  const back = migrateProject(JSON.parse(JSON.stringify(p))); assert.equal(back.video.clips.C!.type, "compound"); assert.equal(Object.keys(back.video.compounds!.K!.clips).length, 2);
  const dangling = JSON.parse(JSON.stringify(p)); delete dangling.video.compounds; assert.throws(() => migrateProject(dangling));
  const noMedia = JSON.parse(JSON.stringify(p)); noMedia.video.compounds.K.clips.a.mediaId = "gone"; assert.throws(() => migrateProject(noMedia));
  const cyc = JSON.parse(JSON.stringify(p)); cyc.video.compounds.K.clips.a = { ...cyc.video.compounds.K.clips.a, type: "compound", compoundId: "K" }; assert.throws(() => migrateProject(cyc));
});

test("filterCss leaves defaults out (no filter pipeline for untouched clips) and keeps order and values for changed ones", async () => {
  const { DEFAULT_FILTERS, filterCss, hasPixelEffects } = await import("../src/editor/effects");
  assert.equal(filterCss(DEFAULT_FILTERS), "none"); assert.equal(hasPixelEffects(DEFAULT_FILTERS), false);
  assert.equal(filterCss({ ...DEFAULT_FILTERS, contrast: 120, brightness: 90 }), "brightness(90%) contrast(120%)"); assert.equal(filterCss({ ...DEFAULT_FILTERS, blur: 2.5 }), "blur(2.5px)");
  assert.equal(filterCss({ ...DEFAULT_FILTERS, exposure: 1 }), "brightness(200%)"); assert.equal(filterCss({ ...DEFAULT_FILTERS, sharpen: 40 }), "none");
});
test("compound pass-through is taken only for an untouched placement", async () => {
  const { isPassThrough } = await import("../src/render/compositor"); const { DEFAULT_FILTERS } = await import("../src/editor/effects");
  const base = { clipId: "c", trackId: "V1", type: "compound" as const, compoundId: "K", sourceTime: 0, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, t: 0, r: 0, b: 0 }, filters: { ...DEFAULT_FILTERS }, reveal: null };
  assert.equal(isPassThrough(base), true);
  for (const patch of [{ x: 1 }, { y: -1 }, { scale: 1.01 }, { rotation: 1 }, { opacity: 0.99 }, { crop: { l: 0.1, t: 0, r: 0, b: 0 } }, { filters: { ...DEFAULT_FILTERS, blur: 1 } }, { filters: { ...DEFAULT_FILTERS, sharpen: 10 } }, { reveal: { l: 0, t: 0, r: 0.5, b: 1 } }]) assert.equal(isPassThrough({ ...base, ...patch }), false, JSON.stringify(patch));
});
