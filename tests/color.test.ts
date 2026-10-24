import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { BT709_LIMITED, colorFromEncoder, type VideoColor } from "../src/app/mux/color";
import { Mp4Muxer } from "../src/app/mux/mp4";
import { WebmMuxer } from "../src/app/mux/webm";
import { ff, h264Chunks, ivfChunks, probe, tmp } from "./helpers/ffmedia";

const SRC = ["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=1"];
const tags = (path: string): Record<string, string | undefined> => { const s = probe(path).streams.find((x: any) => x.codec_type === "video"); return { range: s.color_range, space: s.color_space, transfer: s.color_transfer, primaries: s.color_primaries }; };
const SRGB_FULL: VideoColor = { primaries: 1, transfer: 13, matrix: 1, fullRange: true };


function colourElement(path: string): { matrix?: number; range?: number; transfer?: number; primaries?: number } {
  const b = readFileSync(path); let i = -1; for (let k = 0; k + 3 < b.length; k++) if (b[k] === 0x55 && b[k + 1] === 0xb0 && (b[k + 2]! & 0x80)) { i = k; break; }
  if (i < 0) return {}; const end = i + 3 + (b[i + 2]! & 0x7f); const out: Record<string, number> = {}; let p = i + 3;
  while (p + 3 < end) { const id = (b[p]! << 8) | b[p + 1]!; const len = b[p + 2]! & 0x7f; let v = 0; for (let q = 0; q < len; q++) v = v * 256 + b[p + 3 + q]!; if (id === 0x55b1) out.matrix = v; if (id === 0x55b9) out.range = v; if (id === 0x55ba) out.transfer = v; if (id === 0x55bb) out.primaries = v; p += 3 + len; }
  return out;
}

function mp4(color?: VideoColor): string {
  const d = tmp(); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30", "-x264-params", "aud=1", "-f", "h264", join(d, "v.h264"));
  const { chunks, avcC } = h264Chunks(join(d, "v.h264"), 30); const m = new Mp4Muxer({ video: { width: 320, height: 180, description: avcC, ...(color ? { color } : {}) } }); chunks.forEach((c) => m.addVideo(c));
  const out = join(d, "o.mp4"); writeFileSync(out, m.finalize()); return out;
}
function webm(color?: VideoColor): string {
  const d = tmp(); ff(...SRC, "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "300k", "-g", "30", "-f", "ivf", join(d, "v.ivf"));
  const m = new WebmMuxer({ video: { codec: "vp9", width: 320, height: 180, fps: 30, ...(color ? { color } : {}) } }); ivfChunks(join(d, "v.ivf"), "vp9", 30).forEach((c) => m.addVideo(c));
  const out = join(d, "o.webm"); writeFileSync(out, m.finalize()); return out;
}

test("MP4 muxer writes a colr box: BT.709 limited is reported by ffprobe", () => {
  assert.deepEqual(tags(mp4(BT709_LIMITED)), { range: "tv", space: "bt709", transfer: "bt709", primaries: "bt709" });
});
test("MP4 muxer writes full range and sRGB transfer when asked", () => {
  assert.deepEqual(tags(mp4(SRGB_FULL)), { range: "pc", space: "bt709", transfer: "iec61966-2-1", primaries: "bt709" });
});
test("MP4 control: without color the container says nothing (this is the old behaviour)", () => {
  const t = tags(mp4()); assert.ok(!t.space || t.space === "unknown", `space=${t.space}`); assert.ok(!t.transfer || t.transfer === "unknown", `transfer=${t.transfer}`);
});
test("WebM muxer writes the Colour element: BT.709 limited (ffprobe for transfer/primaries, element parse for matrix and range)", () => {
  const f = webm(BT709_LIMITED); const t = tags(f); assert.equal(t.transfer, "bt709"); assert.equal(t.primaries, "bt709"); assert.deepEqual(colourElement(f), { matrix: 1, range: 1, transfer: 1, primaries: 1 });
});
test("WebM muxer writes full range and sRGB transfer when asked", () => {
  const f = webm(SRGB_FULL); const t = tags(f); assert.equal(t.transfer, "iec61966-2-1"); assert.equal(t.primaries, "bt709"); assert.deepEqual(colourElement(f), { matrix: 1, range: 2, transfer: 13, primaries: 1 });
});
test("WebM control: without color the container says nothing (this is the old behaviour)", () => {
  const t = tags(webm()); assert.ok(!t.space || t.space === "unknown", `space=${t.space}`); assert.ok(!t.transfer || t.transfer === "unknown", `transfer=${t.transfer}`);
});
test("colorFromEncoder maps what WebCodecs reports and falls back to BT.709 limited", () => {
  assert.deepEqual(colorFromEncoder({ primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: false }), { primaries: 1, transfer: 13, matrix: 1, fullRange: false });
  assert.deepEqual(colorFromEncoder(undefined), BT709_LIMITED); assert.deepEqual(colorFromEncoder({ matrix: "rgb", fullRange: true }), { primaries: 1, transfer: 1, matrix: 1, fullRange: true });
});
