import assert from "node:assert/strict";
import { test } from "node:test";
import { IDLE, estimateBytes, fitRect, isActive, linkedSize, outputSize, reduce, videoBitrate, type ExportJob } from "../src/app/exportPlan";

test("export lifecycle: legal paths only, terminal phases carry no progress", () => {
  let j: ExportJob = IDLE;
  assert.equal(reduce(j, { type: "progress", p: 0.5 }), j); assert.equal(reduce(j, { type: "done", label: "x" }), j);
  j = reduce(j, { type: "start", kind: "video", label: "Exporting" }); assert.equal(j.phase, "preparing"); assert.ok(isActive(j));
  assert.equal(reduce(j, { type: "start", kind: "photo", label: "y" }), j);
  assert.equal(reduce(j, { type: "reset" }), j);
  j = reduce(j, { type: "run" }); j = reduce(j, { type: "progress", p: 0.42 }); assert.equal(j.progress, 0.42);
  j = reduce(j, { type: "progress", p: 7 }); assert.equal(j.progress, 1);
  const done = reduce(j, { type: "done", label: "Exported WebM" }); assert.equal(done.phase, "completed"); assert.equal(done.progress, 0);
  assert.equal(reduce(done, { type: "progress", p: 0.9 }).progress, 0);
  assert.equal(reduce(reduce(done, { type: "reset" }), { type: "start", kind: "photo", label: "z" }).phase, "preparing");
  const c = reduce(j, { type: "cancel" }); assert.equal(c.phase, "cancelled"); assert.equal(c.progress, 0); assert.equal(reduce(c, { type: "reset" }).phase, "idle");
  const f = reduce(j, { type: "fail", error: "boom" }); assert.equal(f.phase, "failed"); assert.equal(f.error, "boom"); assert.equal(reduce(f, { type: "reset" }).error, null);
  assert.ok(reduce(IDLE, { type: "start", kind: "video", label: "" }).token > IDLE.token);
});
test("output size: short side names the resolution, even dimensions, source shape preserved", () => {
  assert.deepEqual(outputSize(1920, 1080, "1080", "original"), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize(1920, 1080, "720", "original"), { w: 1280, h: 720 });
  assert.deepEqual(outputSize(1920, 1080, "original", "original"), { w: 1920, h: 1080 });
  assert.deepEqual(outputSize(1920, 1080, "1080", "9:16"), { w: 1080, h: 1920 });
  assert.deepEqual(outputSize(1920, 1080, "2160", "16:9"), { w: 3840, h: 2160 });
  assert.deepEqual(outputSize(1920, 1080, "1080", "1:1"), { w: 1080, h: 1080 });
  assert.deepEqual(outputSize(1920, 1080, "1080", "4:3"), { w: 1440, h: 1080 });
  const o = outputSize(1000, 563, "720", "original"); assert.ok(o.w % 2 === 0 && o.h % 2 === 0);
});
test("bitrate, size estimate, letterbox fit, linked photo size", () => {
  assert.ok(videoBitrate(1920, 1080, 60, "high") > videoBitrate(1920, 1080, 30, "high")); assert.ok(videoBitrate(3840, 2160, 60, "high") <= 80_000_000);
  assert.equal(estimateBytes(10, 8_000_000, 0), 10_000_000);
  assert.deepEqual(fitRect(1920, 1080, 1080, 1920), { x: 0, y: (1920 - 607.5) / 2, w: 1080, h: 607.5 });
  assert.deepEqual(linkedSize(2048, 1150, "w", 1024), { w: 1024, h: 575 }); assert.deepEqual(linkedSize(2048, 1150, "h", 575), { w: 1024, h: 575 });
});

import { score, search, fromMenu, type Command } from "../src/app/commandSearch";
const C = (title: string, group = "Edit", enabled = true, keywords = ""): Command => ({ id: title, title, group, enabled, keywords, run: () => undefined });
test("command palette ranking: all words must match, start-of-word and early hits win, disabled sink, keywords find", () => {
  const cmds = [C("Split at playhead", "Clip"), C("Add marker at playhead", "Timeline"), C("Detach audio from video", "Audio", true, "separate sound"), C("Undo", "Edit", false), C("Redo", "Edit"), C("Link audio & video", "Audio")];
  assert.deepEqual(search(cmds, "").map((c) => c.title), ["Split at playhead", "Add marker at playhead", "Detach audio from video", "Redo", "Link audio & video", "Undo"]);
  assert.equal(search(cmds, "playhead")[0]!.title, "Split at playhead"); assert.deepEqual(search(cmds, "audio vid").map((c) => c.title), ["Link audio & video", "Detach audio from video"]);
  assert.equal(search(cmds, "separate")[0]!.title, "Detach audio from video"); assert.equal(search(cmds, "timeline")[0]!.title, "Add marker at playhead");
  assert.deepEqual(search(cmds, "do").map((c) => c.title), ["Redo", "Undo"]); assert.equal(search(cmds, "undo")[0]!.title, "Undo"); assert.equal(search(cmds, "un").at(-1)!.title, "Undo");
  const m = fromMenu("File", [{ label: "Open project…", shortcut: "Ctrl+O", onSelect: () => undefined }, { sep: true }, { heading: "x" }, { label: "Save", disabled: true, onSelect: () => undefined }]);
  assert.deepEqual(m.map((c) => [c.title, c.enabled]), [["Open project", true], ["Save", false]]);
});

import { CODEC_CHOICE, groupFormats } from "../src/app/exportPlan";
test("groupFormats shows MP4 and WebM only, with codecs kept as options and no codec or audio names in the labels", () => {
  const list = [{ id: "webm-vp8", ext: "webm", codec: "vp8" as const }, { id: "mp4", ext: "mp4", codec: "h264" as const }, { id: "webm-vp9", ext: "webm", codec: "vp9" as const }];
  const g = groupFormats(list); assert.deepEqual(g.map((x) => x.label), ["MP4", "WebM"]); assert.deepEqual(g[1]!.options.map((o) => o.id), ["webm-vp9", "webm-vp8"], "VP9 is preferred over VP8");
  assert.deepEqual(g.map((x) => x.options.every((o) => o.ext === x.ext)), [true, true], "a group never mixes containers");
  for (const x of g) assert.doesNotMatch(x.label, /opus|aac|vp\d|h\.?264|codecs?=/i);
  assert.deepEqual(groupFormats([{ id: "mp4", ext: "mp4", codec: "h264" as const }]).map((x) => x.label), ["MP4"], "a format the browser cannot write is not invented");
  assert.deepEqual(groupFormats([]), []);
});
test("codec hints do not claim numbers that were not measured", () => { for (const c of Object.values(CODEC_CHOICE)) assert.doesNotMatch(c.hint, /\d+\s?%/); });

import { memoAsync } from "../src/app/exportPlan";
test("memoAsync asks once per key, shares a pending answer, and forgets failures and 'could not find out' answers", async () => {
  const cache = new Map<string, Promise<{ ok: boolean }>>(); let calls = 0;
  const ask = (ok: boolean, delay = 0) => async () => { calls++; await new Promise((r) => setTimeout(r, delay)); return { ok }; };
  const [a, b] = await Promise.all([memoAsync(cache, "k", ask(true, 5)), memoAsync(cache, "k", ask(true, 5))]);
  assert.equal(calls, 1, "two callers at once share one question"); assert.equal(a, b);
  await memoAsync(cache, "k", ask(true)); assert.equal(calls, 1, "a later caller gets the remembered answer");
  await memoAsync(cache, "other", ask(true)); assert.equal(calls, 2, "a different key is a different question");
  await memoAsync(cache, "flaky", ask(false), (v) => v.ok); await memoAsync(cache, "flaky", ask(true), (v) => v.ok); assert.equal(calls, 4, "an answer `keep` rejects is asked again");
  await assert.rejects(memoAsync(cache, "boom", async () => { calls++; throw new Error("x"); }), /x/); assert.equal(cache.has("boom"), false, "a rejection is not cached");
  assert.deepEqual(await memoAsync(cache, "boom", ask(true)), { ok: true });
});
