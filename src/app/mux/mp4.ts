import { be, concat, str, u8 } from "./bytes";
import { concatParts, partSize, type MuxChunk, type Part } from "./webm";
import type { VideoColor } from "./color";

export interface Mp4Options {
  video: { width: number; height: number; description: Uint8Array; color?: VideoColor };
  audio?: { codec: "aac" | "opus"; sampleRate: number; channels: number; description?: Uint8Array; preSkip?: number;
 priming?: number;
 samples?: number };
}
const box = (type: string, ...p: Uint8Array[]): Uint8Array => { const body = concat(p); return concat([be(8 + body.length, 4), str(type), body]); };
const full = (type: string, version: number, flags: number, ...p: Uint8Array[]): Uint8Array => box(type, u8(version), be(flags, 3), ...p);
const MATRIX = concat([be(0x10000, 4), be(0, 4), be(0, 4), be(0, 4), be(0x10000, 4), be(0, 4), be(0, 4), be(0, 4), be(0x40000000, 4)]);
const desc = (tag: number, ...p: Uint8Array[]): Uint8Array => { const b = concat(p); if (b.length > 127) throw new Error("descriptor too long"); return concat([u8(tag, b.length), b]); };

interface Sample { t: number; dur: number; size: number; key: boolean; data: Part; track: 0 | 1; ct?: number }
const SCALE_V = 90000;

export class Mp4Muxer {
  private v: MuxChunk[] = []; private a: MuxChunk[] = [];
  constructor(private o: Mp4Options) {}
  addVideo(c: MuxChunk): void { this.v.push(c); }
  addAudio(c: MuxChunk): void { this.a.push(c); }

  private track(kind: "vide" | "soun", id: number, timescale: number, samples: Sample[], entry: Uint8Array, offsets: number[], w: number, h: number, movieDur: number, editStart = 0): Uint8Array {
    const dur = samples.reduce((s, x) => s + x.dur, 0);
    const stts: Uint8Array[] = []; { let run = 0, last = -1; const out: [number, number][] = []; for (const s of samples) { if (s.dur === last) run++; else { if (run) out.push([run, last]); run = 1; last = s.dur; } } if (run) out.push([run, last]); for (const [c, d] of out) stts.push(be(c, 4), be(d, 4)); stts.unshift(be(out.length, 4)); }
    const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean);
    const stbl = box("stbl", full("stsd", 0, 0, be(1, 4), entry), full("stts", 0, 0, ...stts),
      ...(kind === "vide" ? [full("stss", 0, 0, be(keys.length, 4), ...keys.map((k) => be(k, 4)))] : []),
      ...(kind === "vide" && samples.some((x) => x.ct) ? [(() => { const runs: [number, number][] = []; for (const x of samples) { const last = runs[runs.length - 1]; if (last && last[1] === x.ct!) last[0]++; else runs.push([1, x.ct!]); } return full("ctts", 0, 0, be(runs.length, 4), ...runs.flatMap(([n, o]) => [be(n, 4), be(o, 4)])); })()] : []),
      full("stsc", 0, 0, be(1, 4), be(1, 4), be(1, 4), be(1, 4)), full("stsz", 0, 0, be(0, 4), be(samples.length, 4), ...samples.map((s) => be(s.size, 4))), full("stco", 0, 0, be(offsets.length, 4), ...offsets.map((o) => be(o, 4))));
    const tkhd = full("tkhd", 0, 3, be(0, 4), be(0, 4), be(id, 4), be(0, 4), be(movieDur, 4), be(0, 8), be(0, 2), be(0, 2), be(kind === "soun" ? 0x0100 : 0, 2), be(0, 2), MATRIX, be(w * 65536, 4), be(h * 65536, 4));
    const mdhd = full("mdhd", 0, 0, be(0, 4), be(0, 4), be(timescale, 4), be(dur, 4), be(0x55c4, 2), be(0, 2));
    const hdlr = full("hdlr", 0, 0, be(0, 4), str(kind), be(0, 12), str(kind === "vide" ? "Video" : "Audio"), u8(0));
    const media = kind === "vide" ? full("vmhd", 0, 1, be(0, 8)) : full("smhd", 0, 0, be(0, 4));
    const dinf = box("dinf", full("dref", 0, 0, be(1, 4), full("url ", 0, 1)));
    const edts = editStart > 0 ? [box("edts", full("elst", 0, 0, be(1, 4), be(movieDur, 4), be(editStart, 4), be(0x10000, 4)))] : [];
    return box("trak", tkhd, ...edts, box("mdia", mdhd, hdlr, box("minf", media, dinf, stbl)));
  }

  parts(): Part[] {
    const { video, audio } = this.o; if (!this.v.length) throw new Error("MP4 muxer: no video");
    const toTicks = (us: number, scale: number): number => Math.round((us * scale) / 1e6);
    const vts = this.v.map((c) => toTicks(c.timestamp, SCALE_V)); const reordered = vts.some((t, i) => i > 0 && t <= vts[i - 1]!);
    let vs: Sample[]; let delay = 0;
    if (!reordered) vs = this.v.map((c, i) => { const next = this.v[i + 1]; const t = vts[i]!; return { t, dur: next ? vts[i + 1]! - t : toTicks(c.duration, SCALE_V), size: partSize(c.data), key: c.key, data: c.data, track: 0 as const }; });
    else {
      const sorted = [...vts].sort((a, b) => a - b); for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1]) throw new Error("MP4 muxer: two video frames have the same presentation time");
      const step = sorted[1]! - sorted[0]!; if (sorted.some((t, i) => i && Math.abs(t - sorted[i - 1]! - step) > 1)) throw new Error("MP4 muxer: reordered video with irregular frame times cannot be written correctly");
      const t0 = sorted[0]!; delay = 0; vts.forEach((t, i) => { delay = Math.max(delay, i * step - (t - t0)); });
      vs = this.v.map((c, i) => ({ t: i * step, dur: step, size: partSize(c.data), key: c.key, data: c.data, track: 0 as const, ct: vts[i]! - t0 + delay - i * step }));
    }
    const sr = audio?.sampleRate ?? 48000; const as: Sample[] = audio ? this.a.map((c) => ({ t: toTicks(c.timestamp, sr), dur: Math.max(1, toTicks(c.duration, sr)), size: partSize(c.data), key: true, data: c.data, track: 1 })) : [];
    const pre = audio?.preSkip ?? 312;
    const avc1 = box("avc1", be(0, 6), be(1, 2), be(0, 16), be(video.width, 2), be(video.height, 2), be(0x480000, 4), be(0x480000, 4), be(0, 4), be(1, 2), be(0, 32), be(0x18, 2), be(0xffff, 2), box("avcC", video.description), ...(video.color ? [box("colr", str("nclx"), be(video.color.primaries, 2), be(video.color.transfer, 2), be(video.color.matrix, 2), u8(video.color.fullRange ? 0x80 : 0))] : []));
    const aEntry = audio ? (audio.codec === "opus"
      ? box("Opus", be(0, 6), be(1, 2), be(0, 8), be(audio.channels, 2), be(16, 2), be(0, 2), be(0, 2), be(sr * 65536 > 0xffffffff ? 0 : sr * 65536, 4), box("dOps", u8(0, audio.channels), be(pre, 2), be(sr, 4), be(0, 2), u8(0)))
      : box("mp4a", be(0, 6), be(1, 2), be(0, 8), be(audio.channels, 2), be(16, 2), be(0, 2), be(0, 2), be(sr * 65536, 4),
        full("esds", 0, 0, desc(3, be(0, 2), u8(0), desc(4, u8(0x40, 0x15), be(0, 3), be(0, 4), be(0, 4), desc(5, audio.description ?? new Uint8Array(0))), desc(6, u8(2)))))) : null;
    const order = [...vs, ...as].sort((x, y) => x.t / (x.track ? sr : SCALE_V) - y.t / (y.track ? sr : SCALE_V) || x.track - y.track);
    const build = (base: number): { moov: Uint8Array; offs: number[][] } => {
      const offs: number[][] = [[], []]; let p = base; for (const s of order) { offs[s.track]!.push(p); p += s.size; }
      const vdur = vs.reduce((n, s) => n + s.dur, 0) / SCALE_V; const aTotal = as.reduce((n, s) => n + s.dur, 0); const aPrime = audio?.codec === "aac" ? Math.min(audio.priming ?? 0, aTotal) : 0; const aPlay = aPrime > 0 ? Math.min(aTotal - aPrime, audio?.samples ?? aTotal - aPrime) : aTotal; const adur = aPlay / sr; const movieDur = Math.round(Math.max(vdur, adur) * 1000);
      const mvhd = full("mvhd", 0, 0, be(0, 4), be(0, 4), be(1000, 4), be(movieDur, 4), be(0x10000, 4), be(0x0100, 2), be(0, 10), MATRIX, be(0, 24), be(audio ? 3 : 2, 4));
      return { offs, moov: box("moov", mvhd, this.track("vide", 1, SCALE_V, vs, avc1, offs[0]!, video.width, video.height, Math.round(vdur * 1000), delay), ...(audio && aEntry ? [this.track("soun", 2, sr, as, aEntry, offs[1]!, 0, 0, Math.round(adur * 1000), aPrime)] : [])) };
    };
    const ftyp = box("ftyp", str("isom"), be(512, 4), str("isom"), str("iso2"), str("avc1"), str("mp41"));
    const dry = build(0); const base = ftyp.length + dry.moov.length + 8; const real = build(base);
    const payloadLen = order.reduce((n, s) => n + s.size, 0); const total = 8 + payloadLen; if (total > 0xffffffff || base + payloadLen > 0xffffffff) throw new Error("MP4 muxer: file larger than 4 GB is not supported");
    return [ftyp, real.moov, concat([be(total, 4), str("mdat")]), ...order.map((s) => s.data)];
  }
  finalize(): Uint8Array { return concatParts(this.parts()); }
  finalizeBlob(): Blob { return new Blob(this.parts() as BlobPart[], { type: "video/mp4" }); }
}
