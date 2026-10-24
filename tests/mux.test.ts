import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Mp4Muxer } from "../src/app/mux/mp4";
import { WebmMuxer } from "../src/app/mux/webm";
import { adtsChunks, countFrames, decodeErrors, ff, h264Chunks, ivfChunks, oggOpusChunks, probe, tmp } from "./helpers/ffmedia";

const SRC = ["-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2"], AUD = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2"];
const write = (path: string, bytes: Uint8Array): string => { writeFileSync(path, bytes); return path; };
const stream = (j: any, t: string): any => j.streams.find((s: any) => s.codec_type === t);

test("WebM muxer: real VP8 + Opus decodes cleanly, exact frame count, seekable", () => {
  const d = tmp(); ff(...SRC, "-c:v", "libvpx", "-b:v", "400k", "-g", "30", "-f", "ivf", join(d, "v.ivf")); ff(...AUD, "-c:a", "libopus", "-f", "opus", join(d, "a.opus"));
  const v = ivfChunks(join(d, "v.ivf"), "vp8", 30), a = oggOpusChunks(join(d, "a.opus")); assert.equal(v.length, 60);
  const m = new WebmMuxer({ video: { codec: "vp8", width: 320, height: 180, fps: 30 }, audio: { sampleRate: 48000, channels: 1, preSkip: a.preSkip } }); v.forEach((c) => m.addVideo(c)); a.chunks.forEach((c) => m.addAudio(c));
  const out = write(join(d, "o.webm"), m.finalize()); const j = probe(out);
  assert.equal(stream(j, "video").codec_name, "vp8"); assert.equal(stream(j, "audio").codec_name, "opus"); assert.equal(stream(j, "video").width, 320); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), "");
  assert.ok(Math.abs(Number(j.format.duration) - 2) < 0.05, `duration ${j.format.duration}`);
  const seek = decodeErrors(out); void seek; ff("-ss", "1.0", "-i", out, "-frames:v", "1", join(d, "seek.png"));
});
test("WebM muxer: VP9 only (no audio)", () => {
  const d = tmp(); ff(...SRC, "-c:v", "libvpx-vp9", "-b:v", "400k", "-g", "30", "-f", "ivf", join(d, "v.ivf")); const v = ivfChunks(join(d, "v.ivf"), "vp9", 30);
  const m = new WebmMuxer({ video: { codec: "vp9", width: 320, height: 180, fps: 30 } }); v.forEach((c) => m.addVideo(c)); const out = write(join(d, "o.webm"), m.finalize());
  assert.equal(stream(probe(out), "video").codec_name, "vp9"); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), "");
});
test("MP4 muxer: real H.264 + AAC decodes cleanly, exact frame count, keyframes and timing right", () => {
  const d = tmp(); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30", "-profile:v", "high", "-x264-params", "aud=1", "-f", "h264", join(d, "v.h264")); ff(...AUD, "-c:a", "aac", "-f", "adts", join(d, "a.aac"));
  const { chunks, avcC } = h264Chunks(join(d, "v.h264"), 30), a = adtsChunks(join(d, "a.aac")); assert.equal(chunks.length, 60); assert.ok(chunks[0]!.key && !chunks[1]!.key);
  const m = new Mp4Muxer({ video: { width: 320, height: 180, description: avcC }, audio: { codec: "aac", sampleRate: a.sampleRate, channels: a.channels, description: a.asc } }); chunks.forEach((c) => m.addVideo(c)); a.chunks.forEach((c) => m.addAudio(c));
  const out = write(join(d, "o.mp4"), m.finalize()); const j = probe(out);
  assert.match(j.format.format_name, /mp4/); assert.equal(stream(j, "video").codec_name, "h264"); assert.equal(stream(j, "audio").codec_name, "aac"); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), "");
  assert.ok(Math.abs(Number(stream(j, "video").duration) - 2) < 0.02); assert.equal(stream(j, "video").r_frame_rate, "30/1"); assert.ok(Math.abs(Number(j.format.duration) - 2) < 0.1);
  const kf = probe(out, ["-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-select_streams", "v"]); void kf;
});
test("MP4 muxer: H.264 + Opus (dOps) is readable", () => {
  const d = tmp(); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", "-g", "30", "-x264-params", "aud=1", "-f", "h264", join(d, "v.h264")); ff(...AUD, "-c:a", "libopus", "-f", "opus", join(d, "a.opus"));
  const { chunks, avcC } = h264Chunks(join(d, "v.h264"), 30), a = oggOpusChunks(join(d, "a.opus"));
  const m = new Mp4Muxer({ video: { width: 320, height: 180, description: avcC }, audio: { codec: "opus", sampleRate: 48000, channels: 1, preSkip: a.preSkip } }); chunks.forEach((c) => m.addVideo(c)); a.chunks.forEach((c) => m.addAudio(c));
  const out = write(join(d, "o.mp4"), m.finalize()); const j = probe(out); assert.equal(stream(j, "audio").codec_name, "opus"); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), "");
});
test("MP4 muxer handles B-frames: a real x264 stream with 3 B-frames is remuxed with identical presentation times and decodes cleanly", async () => {
  const { demuxVideo } = await import("../src/app/demux/demux"); const { readFileSync } = await import("node:fs"); const { execFileSync } = await import("node:child_process"); const { bufRead } = await import("./helpers/ffmedia");
  const d = tmp(); ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "3", "-b_strategy", "2", "-g", "30", join(d, "bf.mp4"));
  const src = new Uint8Array(readFileSync(join(d, "bf.mp4"))); const tr = (await demuxVideo(bufRead(src), src.length))!; assert.ok(tr.samples.some((s, i) => i && s.pts < tr.samples[i - 1]!.pts), "source really has reordered frames");
  const m = new Mp4Muxer({ video: { width: 320, height: 180, description: tr.description! } }); tr.samples.forEach((s) => m.addVideo({ timestamp: s.pts, duration: 33333, key: s.key, data: src.subarray(s.offset, s.offset + s.size) }));
  const out = write(join(d, "o.mp4"), m.finalize()); const pts = (p: string): number[] => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "frame=pts_time", "-of", "csv=p=0", p]).toString().trim().split("\n").map((l) => Number(l.split(",")[0])).sort((a, b) => a - b);
  const a = pts(join(d, "bf.mp4")), b = pts(out); assert.equal(b.length, a.length); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), ""); let worst = 0; a.forEach((t, i) => (worst = Math.max(worst, Math.abs(t - b[i]!)))); assert.ok(worst < 0.001, `presentation times differ by ${worst} s`);
  assert.ok(b[0]! >= 0 && b[0]! < 0.001, `starts at ${b[0]}`); assert.ok(Math.abs(Number(stream(probe(out), "video").duration) - Number(stream(probe(join(d, "bf.mp4")), "video").duration)) < 0.05);
  const bad = new Mp4Muxer({ video: { width: 2, height: 2, description: new Uint8Array(7) } }); for (const t of [0, 100000, 40000, 300000]) bad.addVideo({ timestamp: t, duration: 1, key: t === 0, data: new Uint8Array(1) }); assert.throws(() => bad.finalize(), /irregular/);
  const dup = new Mp4Muxer({ video: { width: 2, height: 2, description: new Uint8Array(7) } }); for (const t of [0, 66666, 33333, 33333]) dup.addVideo({ timestamp: t, duration: 1, key: t === 0, data: new Uint8Array(1) }); assert.throws(() => dup.finalize(), /same presentation time/);
});

test("files assembled from Blob slices (spilled encoder output) are byte-identical to files assembled from memory, for WebM and MP4", async () => {
  const { readFileSync } = await import("node:fs"); const { demuxVideo } = await import("../src/app/demux/demux"); const { bufRead } = await import("./helpers/ffmedia");
  const d = tmp(); ff(...SRC, "-c:v", "libvpx", "-b:v", "400k", "-g", "30", "-f", "ivf", join(d, "v.ivf")); ff(...AUD, "-c:a", "libopus", "-f", "opus", join(d, "a.opus"));
  const v = ivfChunks(join(d, "v.ivf"), "vp8", 30), a = oggOpusChunks(join(d, "a.opus")); const spillAll = (cs: typeof v) => { const blob = new Blob(cs.map((c) => c.data as Uint8Array)); let o = 0; return cs.map((c) => { const n = (c.data as Uint8Array).length; const r = { ...c, data: blob.slice(o, o + n) }; o += n; return r; }); };
  const mk = (vs: typeof v, as: typeof a.chunks) => { const m = new WebmMuxer({ video: { codec: "vp8", width: 320, height: 180, fps: 30 }, audio: { sampleRate: 48000, channels: 1, preSkip: a.preSkip } }); vs.forEach((c) => m.addVideo(c)); as.forEach((c) => m.addAudio(c)); return m; };
  const mem = mk(v, a.chunks).finalize(); const blob = new Uint8Array(await mk(spillAll(v), spillAll(a.chunks)).finalizeBlob().arrayBuffer()); assert.equal(blob.length, mem.length); assert.ok(Buffer.from(blob).equals(Buffer.from(mem)), "WebM bytes differ");
  assert.throws(() => mk(spillAll(v), a.chunks).finalize(), /finalizeBlob/);
  const out = join(d, "o.webm"); writeFileSync(out, blob); assert.equal(countFrames(out), 60); assert.equal(decodeErrors(out), "");
  ff(...SRC, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", join(d, "b.mp4")); const src = new Uint8Array(readFileSync(join(d, "b.mp4"))); const tr = (await demuxVideo(bufRead(src), src.length))!; const chunks = tr.samples.map((s) => ({ timestamp: s.pts, duration: 33333, key: s.key, data: src.slice(s.offset, s.offset + s.size) }));
  const mm = (cs: typeof chunks) => { const m = new Mp4Muxer({ video: { width: 320, height: 180, description: tr.description! } }); cs.forEach((c) => m.addVideo(c)); return m; };
  const memM = mm(chunks).finalize(); const blobM = new Uint8Array(await mm(spillAll(chunks as never) as never).finalizeBlob().arrayBuffer()); assert.ok(Buffer.from(blobM).equals(Buffer.from(memM)), "MP4 bytes differ");
});
