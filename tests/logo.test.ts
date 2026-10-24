import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

process.env.NODE_ENV = "production";
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { LOGO_ASPECT, LOGO_VIEWBOX, LogoArt, Mark } = await import("../src/ui/Logo");

const root = new URL("..", import.meta.url).pathname;
const file = (p: string): Buffer => readFileSync(root + p);
const html = file("index.html").toString("utf8");

test("every icon index.html links to exists in public/, and none is an inline data: URI", () => {
  const links = [...html.matchAll(/<link\s+rel="(icon|apple-touch-icon)"[^>]*href="([^"]+)"/g)].map((m) => m[2]!);
  assert.ok(links.length >= 3, "svg + ico favicon and an apple-touch-icon");
  for (const href of links) { assert.ok(!href.startsWith("data:"), `${href} must be a real file`); assert.ok(existsSync(root + "public" + href), `public${href} is missing`); }
});

test("public/logo.svg and favicon.svg are icon-only (no wordmark) and valid", () => {
  for (const name of ["public/logo.svg", "public/favicon.svg"]) {
    const svg = file(name).toString("utf8");
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name); assert.match(svg, /viewBox="/, name);
    assert.doesNotMatch(svg, /<text|<tspan|<image|OpenSourceEditor/i, `${name} must not contain a wordmark or an embedded raster`);
    assert.ok(svg.length < 6000, `${name} is ${svg.length} bytes: it should be small vector art, not an embedded image`);
  }
});

test("public/logo.svg is exactly what Logo.tsx renders (the generated assets cannot drift from the in-app logo)", () => {
  const v = LOGO_VIEWBOX;
  const expected = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${v.x} ${v.y} ${v.w} ${v.h}" width="${v.w}" height="${v.h}">${renderToStaticMarkup(createElement(LogoArt, { uid: "logo", compact: false }))}</svg>\n`;
  assert.equal(file("public/logo.svg").toString("utf8"), expected, "run `npx tsx scripts/make-icons.ts` after changing Logo.tsx");
});

test("favicon.ico holds 16, 32 and 48 px PNG frames; apple-touch-icon is a 180 px PNG", () => {
  const png = (b: Buffer): [number, number] => { assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const ico = file("public/favicon.ico"); assert.equal(ico.readUInt16LE(0), 0); assert.equal(ico.readUInt16LE(2), 1, "ICO type"); const n = ico.readUInt16LE(4); assert.equal(n, 3);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) { const e = 6 + 16 * i, px = ico[e]!, len = ico.readUInt32LE(e + 8), off = ico.readUInt32LE(e + 12); assert.ok(off + len <= ico.length, "frame inside the file"); assert.deepEqual(png(ico.subarray(off, off + len)), [px, px]); sizes.push(px); }
  assert.deepEqual(sizes, [16, 32, 48]);
  assert.deepEqual(png(file("public/apple-touch-icon.png")), [180, 180]);
});

test("Mark keeps the artwork's proportions at every size and is decorative unless titled", () => {
  for (const size of [16, 22, 60]) {
    const svg = renderToStaticMarkup(createElement(Mark, { size })); const h = Number(/height="([\d.]+)"/.exec(svg)![1]), w = Number(/width="([\d.]+)"/.exec(svg)![1]);
    assert.equal(h, size); assert.ok(Math.abs(w / h - LOGO_ASPECT) < 0.01, `${size}px mark is stretched: ${w}x${h}`); assert.match(svg, /aria-hidden="true"/); assert.doesNotMatch(svg, /<text/);
  }
  assert.match(renderToStaticMarkup(createElement(Mark, { size: 22, title: "OpenSourceEditor" })), /role="img" aria-label="OpenSourceEditor"/);
});

test("compact variant (under 20 px) differs from the full mark only by the three film holes; gradient ids are unique per instance", () => {
  const full = renderToStaticMarkup(createElement(LogoArt, { uid: "a", compact: false })), compact = renderToStaticMarkup(createElement(LogoArt, { uid: "a", compact: true }));
  const clip = (s: string): string => /<clipPath[^>]*><path[^>]* d="([^"]+)"/.exec(s)![1]!;
  assert.ok(clip(full).startsWith(clip(compact)), "same outline and play cutout first"); assert.equal(clip(full).slice(clip(compact).length).match(/M/g)!.length, 3, "exactly the three holes are added");
  assert.equal(full.replace(clip(full), "").length, compact.replace(clip(compact), "").length, "everything else is identical");
  assert.match(renderToStaticMarkup(createElement(Mark, { size: 16 })), /osl-clip-/); const ids = (s: string): string[] => [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(new Set([...ids(renderToStaticMarkup(createElement(LogoArt, { uid: "x" }))), ...ids(renderToStaticMarkup(createElement(LogoArt, { uid: "y" })))]).size, 12, "two marks on one page never share a gradient id");
});
