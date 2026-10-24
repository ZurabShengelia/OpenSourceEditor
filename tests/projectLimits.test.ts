import test from "node:test";
import assert from "node:assert/strict";
import { ProjectError, migrateProject, newProject } from "../src/doc/migrate";
import { MAX_CANVAS_SIDE, MAX_FPS } from "../src/doc/schema";

const fresh = () => JSON.parse(JSON.stringify(newProject("p1", "Test")));

test("a normal project still validates", () => {
  assert.equal(migrateProject(fresh()).id, "p1");
});

test("oversized or non-finite canvas dimensions are rejected", () => {
  for (const bad of [0, -5, MAX_CANVAS_SIDE + 1, 1e9, Infinity, NaN, "1280"]) {
    const a = fresh(); a.photo.width = bad; assert.throws(() => migrateProject(a), ProjectError);
    const b = fresh(); b.video.height = bad; assert.throws(() => migrateProject(b), ProjectError);
  }
});

test("the largest allowed canvas is accepted", () => {
  const a = fresh(); a.photo.width = MAX_CANVAS_SIDE; a.photo.height = MAX_CANVAS_SIDE;
  assert.doesNotThrow(() => migrateProject(a));
});

test("frame rates outside 1..MAX_FPS are rejected", () => {
  for (const bad of [0, -1, MAX_FPS + 1, NaN, Infinity]) { const a = fresh(); a.video.fps = bad; assert.throws(() => migrateProject(a), ProjectError); }
});

test("legacy v1 canvas sizes are clamped, not trusted", () => {
  const v1 = { version: 1, id: "x", name: "old", updatedAt: 1, state: { canvas: { w: 1e9, h: 4 }, layers: [] } };
  const p = migrateProject(v1);
  assert.equal(p.photo.width, MAX_CANVAS_SIDE);
  assert.equal(p.photo.height, 4);
});
