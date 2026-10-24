import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { demuxVideo } from "../src/app/demux/demux";
import { WebmMuxer } from "../src/app/mux/webm";
import { bufRead, ff, ffPackets, ivfChunks, tmp } from "./helpers/ffmedia";

const SRC = ["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2.5"];
async function agree(path: string, codecStart: string): Promise<void> {
  const bytes = new Uint8Array(readFileSync(path)); const t = (await demuxVideo(bufRead(bytes), bytes.length))!; assert.ok(t, "demuxed"); assert.ok(t.codec.startsWith(codecStart), t.codec);
  const f = ffPackets(path); assert.equal(t.samples.length, f.length); let worst = 0;
  t.samples.forEach((s, i) => { worst = Math.max(worst, Math.abs(s.pts / 1e6 - f[i]!.pts)); assert.equal(s.key, f[i]!.key, `key flag @${i}`); assert.equal(s.size, f[i]!.size, `size @${i}`); });
  assert.ok(worst < 0.0011, `pts differ by ${worst}`); assert.equal(t.width, 320); assert.equal(t.height, 180);
  const first = t.samples[0]!; const data = t.whole ? t.whole.subarray(first.offset, first.offset + first.size) : bytes.subarray(first.offset, first.offset + first.size); assert.equal(data.length, first.size);
}
test("demux MP4 H.264 without B-frames", async () => { const d = tmp(), p = join(d, "a.mp4"); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "25", p); await agree(p, "avc1."); });
test("demux MP4 H.264 with B-frames (ctts + edit list give the right presentation times)", async () => { const d = tmp(), p = join(d, "b.mp4"); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "3", "-g", "30", p); await agree(p, "avc1."); const t = (await demuxVideo(bufRead(new Uint8Array(readFileSync(p))), readFileSync(p).length))!; const sorted = t.samples.map((s) => s.pts).sort((a, b) => a - b); assert.ok(sorted[0]! >= 0 && sorted[0]! < 1000, `first pts ${sorted[0]}`); assert.ok(t.samples.some((s, i) => i && s.pts < t.samples[i - 1]!.pts), "stream really is reordered"); });
test("demux MP4 with moov at the end (no faststart) and fragmented-free layout", async () => { const d = tmp(), p = join(d, "c.mp4"); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", p); await agree(p, "avc1."); });
test("demux WebM VP9 and VP8 from ffmpeg", async () => { const d = tmp(); ff(...SRC, "-c:v", "libvpx-vp9", "-b:v", "300k", "-g", "20", join(d, "v9.webm")); await agree(join(d, "v9.webm"), "vp09"); ff(...SRC, "-c:v", "libvpx", "-b:v", "300k", "-g", "20", join(d, "v8.webm")); await agree(join(d, "v8.webm"), "vp8"); });
test("demux WebM written by OpenSourceEditor's own muxer (round trip)", async () => { const d = tmp(); ff(...SRC, "-c:v", "libvpx", "-b:v", "300k", "-g", "25", "-f", "ivf", join(d, "v.ivf")); const chunks = ivfChunks(join(d, "v.ivf"), "vp8", 30); const m = new WebmMuxer({ video: { codec: "vp8", width: 320, height: 180, fps: 30 } }); chunks.forEach((c) => m.addVideo(c)); writeFileSync(join(d, "o.webm"), m.finalize()); await agree(join(d, "o.webm"), "vp8"); });
test("demux WebM with unknown-size segment/clusters (live recording style)", async () => { const d = tmp(); ff(...SRC, "-c:v", "libvpx", "-b:v", "300k", "-g", "20", "-f", "webm", "-live", "1", join(d, "live.webm")); await agree(join(d, "live.webm"), "vp8"); });
test("demux refuses what it cannot handle instead of guessing", async () => { const d = tmp(); ff(...SRC, "-c:v", "mpeg4", join(d, "m.mp4")); const b = new Uint8Array(readFileSync(join(d, "m.mp4"))); assert.equal(await demuxVideo(bufRead(b), b.length), null); assert.equal(await demuxVideo(bufRead(new Uint8Array(40)), 40), null); assert.equal(await demuxVideo(bufRead(Uint8Array.from([1, 2, 3])), 3), null); });

import { virtualWebm } from "./helpers/virtualWebm";
const ccw = (path: string): number => { const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream_side_data=rotation", "-of", "json", path]).toString()); const r = j.streams?.[0]?.side_data_list?.[0]?.rotation; return r === undefined ? 0 : Number(r); };
test("MP4 rotation metadata is read (0, 90, 180, 270) from the track header matrix", async () => {
  const d = tmp(); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", join(d, "base.mp4"));
  for (const deg of [0, 90, 180, 270]) { const p = join(d, `r${deg}.mp4`); ff("-display_rotation", String(deg), "-i", join(d, "base.mp4"), "-c", "copy", p); const want = ((-ccw(p) % 360) + 360) % 360; const b = new Uint8Array(readFileSync(p)); const t = (await demuxVideo(bufRead(b), b.length))!; assert.equal(t.rotation, want, `ffprobe says ${ccw(p)} ccw, demuxer says ${t.rotation} cw`); assert.equal(t.width, 320); assert.equal(t.height, 180); }
  const b0 = new Uint8Array(readFileSync(join(d, "base.mp4"))); assert.equal((await demuxVideo(bufRead(b0), b0.length))!.rotation, 0);
});
test("WebM over 1 GB (synthetic, never on disk) demuxes with memory bounded by one cluster, not the file", async () => {
  const v = virtualWebm({ clusters: 700, blocksPerCluster: 16, blockBytes: 96 * 1024 }); assert.ok(v.size > 1.0e9, `size ${v.size}`); let biggest = 0, reads = 0;
  const t = (await demuxVideo(async (o, l) => { biggest = Math.max(biggest, l); reads++; return v.read(o, l); }, v.size))!; assert.ok(t, "demuxed a >768 MB file (the old limit)");
  assert.equal(t.samples.length, v.samples); assert.equal(t.samples.filter((s) => s.key).length, 700); assert.equal(t.codec, "vp09.00.10.08"); assert.equal(t.width, 1280);
  assert.ok(biggest <= v.clusterBytes + 64, `largest single read ${biggest} B vs cluster ${v.clusterBytes} B`); assert.ok(biggest < 4 * 1024 * 1024, "never read more than a few MB at once");
  const s = t.samples; assert.equal(s[0]!.pts, 0); assert.equal(s[17]!.pts, 1 * 16 * 33 * 1000 + 33 * 1000); assert.equal(s[s.length - 1]!.pts, ((700 * 16 - 1) * 33) * 1000);
  for (const i of [0, 5000, s.length - 1]) { const b = await v.read(s[i]!.offset, s[i]!.size); assert.equal(b.length, 96 * 1024); }
});
test("WebM with unknown-size clusters larger than the first read window (window grows until the cluster ends)", async () => {
  const v = virtualWebm({ clusters: 4, blocksPerCluster: 80, blockBytes: 96 * 1024, unknownSizeClusters: true }); assert.ok(v.clusterBytes > 4 * 1024 * 1024);
  const t = (await demuxVideo(v.read, v.size))!; assert.ok(t); assert.equal(t.samples.length, 320); assert.equal(t.samples.filter((s) => s.key).length, 4); assert.equal(t.samples[319]!.pts, (319 * 33) * 1000);
});
