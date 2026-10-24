import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { migrateProject } from "../src/doc/migrate";
import { clipEnd, flatClips, evaluateFrame } from "../src/doc/compose";

const fixture = (): any => JSON.parse(readFileSync(new URL("./fixtures/project-prev-delivery.json", import.meta.url), "utf8"));
test("a project saved by the previously delivered version still loads, with every feature intact", () => {
  const p = migrateProject(fixture()); const v = p.video;
  assert.equal(p.name, "Fixture from previous delivery"); assert.deepEqual(Object.keys(v.clips).sort(), ["c", "c-audio", "comp1"]);
  assert.equal(v.clips.comp1!.type, "compound"); assert.equal(v.clips.comp1!.muted, true); assert.ok(v.compounds!.K1); assert.equal(Object.keys(v.compounds!.K1!.clips).length, 2); assert.equal(v.compounds!.K1!.transitions.length, 1);
  assert.equal(v.clips.c!.detached, true); assert.equal(v.clips["c-audio"]!.linkId, "L1"); assert.equal(v.markers![0]!.name, "Intro"); assert.equal(v.clips.c!.speed, 2);
  const inner = v.compounds!.K1!.clips.a!; assert.equal(inner.filters.brightness, 110); assert.equal(inner.filters.blur, 2); assert.equal(inner.keyframes.scale!.length, 2); assert.equal(inner.transform.rotation, 5);
  assert.ok(flatClips(v).length >= 3 && evaluateFrame(v, 1).length === 1 && clipEnd(v.clips.comp1!) > 6);
});
test("loading is idempotent: save -> load -> save -> load gives the same project", () => {
  const once = migrateProject(fixture()); const twice = migrateProject(JSON.parse(JSON.stringify(once))); assert.deepEqual(twice, once);
});
test("a project from before the optional fields existed (no markers, compounds, clip flags, links, track layout) loads and behaves the same", () => {
  const raw = fixture(); const v = raw.video; delete v.markers; delete v.compounds; v.clips = Object.fromEntries(Object.entries(v.clips).filter(([k, c]: [string, any]) => c.type !== "compound" && k !== "c-audio").map(([k, c]: [string, any]) => { delete c.detached; delete c.linkId; delete c.muted; delete c.disabled; delete c.locked; return [k, c]; }));
  for (const t of v.tracks) { delete t.collapsed; delete t.height; } v.transitions = [];
  const p = migrateProject(raw); assert.deepEqual(Object.keys(p.video.clips), ["c"]); assert.equal(p.video.markers, undefined); assert.equal(p.video.compounds, undefined); assert.equal(evaluateFrame(p.video, 8.5).length, 1);
});
test("corrupt or hostile project files are rejected cleanly instead of loading half-broken", () => {
  for (const bad of [null, 5, "x", {}, { version: 2 }, { ...fixture(), video: null }, { ...fixture(), video: { ...fixture().video, clips: { a: { id: "zzz" } } } }]) assert.throws(() => migrateProject(bad as never));
});
