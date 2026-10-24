import { be, concat, f64, str } from "./bytes";
import type { VideoColor } from "./color";

export interface MuxChunk { timestamp: number; duration: number; key: boolean; data: Uint8Array | Blob }
export type Part = Uint8Array | Blob;
export const partSize = (p: Part): number => (p instanceof Blob ? p.size : p.length);
export const concatParts = (parts: readonly Part[]): Uint8Array => { const bufs = parts.map((p) => { if (p instanceof Blob) throw new Error("finalize() needs in-memory data; use finalizeBlob()"); return p; }); return concat(bufs); };
export interface WebmOptions { video: { codec: "vp8" | "vp9"; width: number; height: number; fps: number; color?: VideoColor }; audio?: { sampleRate: number; channels: number; description?: Uint8Array; preSkip?: number } }

const id = (v: number): Uint8Array => { const b: number[] = []; let x = v; while (x > 0) { b.unshift(x & 0xff); x = Math.floor(x / 256); } return Uint8Array.from(b); };
const vint = (n: number): Uint8Array => { for (let len = 1; len <= 8; len++) { if (n < 2 ** (7 * len) - 1) { const o = be(n, len); o[0]! |= 1 << (8 - len); return o; } } throw new Error("EBML size too large"); };
const el = (idv: number, ...payload: Uint8Array[]): Uint8Array => { const body = concat(payload); return concat([id(idv), vint(body.length), body]); };
const uint = (v: number): Uint8Array => { let n = 1; while (n < 8 && v >= 2 ** (8 * n)) n++; return be(v, n); };
const ELu = (idv: number, v: number): Uint8Array => el(idv, uint(v));
const ELs = (idv: number, s: string): Uint8Array => el(idv, str(s));

export function opusHead(channels: number, sampleRate: number, preSkip = 312): Uint8Array {
  const o = new Uint8Array(19); o.set(str("OpusHead")); o[8] = 1; o[9] = channels; o[10] = preSkip & 255; o[11] = preSkip >> 8; new DataView(o.buffer).setUint32(12, sampleRate, true); return o;
}

export class WebmMuxer {
  private v: MuxChunk[] = []; private a: MuxChunk[] = [];
  constructor(private o: WebmOptions) {}
  addVideo(c: MuxChunk): void { this.v.push(c); }
  addAudio(c: MuxChunk): void { this.a.push(c); }
  parts(): Part[] {
    const { video, audio } = this.o; const ms = (us: number): number => Math.round(us / 1000);
    let end = 0; for (const c of this.v) end = Math.max(end, c.timestamp + c.duration); for (const c of this.a) end = Math.max(end, c.timestamp + c.duration);
    const ebml = el(0x1a45dfa3, ELu(0x4286, 1), ELu(0x42f7, 1), ELu(0x42f2, 4), ELu(0x42f3, 8), ELs(0x4282, "webm"), ELu(0x4287, 4), ELu(0x4285, 2));
    const info = el(0x1549a966, ELu(0x2ad7b1, 1_000_000), ELs(0x4d80, "OpenSourceEditor"), ELs(0x5741, "OpenSourceEditor"), el(0x4489, f64(ms(end))));
    const vt = el(0xae, ELu(0xd7, 1), ELu(0x73c5, 1), ELu(0x83, 1), ELu(0x9c, 0), ELs(0x86, video.codec === "vp9" ? "V_VP9" : "V_VP8"), ELu(0x23e383, Math.round(1e9 / video.fps)), el(0xe0, ELu(0xb0, video.width), ELu(0xba, video.height), ...(video.color ? [el(0x55b0, ELu(0x55b1, video.color.matrix), ELu(0x55b9, video.color.fullRange ? 2 : 1), ELu(0x55ba, video.color.transfer), ELu(0x55bb, video.color.primaries))] : [])));
    const pre = audio?.preSkip ?? 312; const at = audio ? el(0xae, ELu(0xd7, 2), ELu(0x73c5, 2), ELu(0x83, 2), ELu(0x9c, 0), ELs(0x86, "A_OPUS"), el(0x63a2, audio.description ?? opusHead(audio.channels, audio.sampleRate, pre)),
      ELu(0x56aa, Math.round((pre / 48000) * 1e9)), ELu(0x56bb, 80_000_000), el(0xe1, el(0xb5, f64(audio.sampleRate)), ELu(0x9f, audio.channels))) : new Uint8Array(0);
    const tracks = el(0x1654ae6b, vt, at);
    const all = [...this.v.map((c) => ({ c, t: 1 })), ...this.a.map((c) => ({ c, t: 2 }))].sort((x, y) => x.c.timestamp - y.c.timestamp || x.t - y.t);
    const clusters: { start: number; parts: Part[]; len: number; hasKey: boolean }[] = []; let cur: { start: number; blocks: { parts: Part[]; len: number }[]; hasKey: boolean } | null = null;
    const flush = (): void => { if (cur) { const tc = ELu(0xe7, cur.start); const inner = tc.length + cur.blocks.reduce((n, b) => n + b.len, 0); const head = concat([id(0x1f43b675), vint(inner)]); clusters.push({ start: cur.start, hasKey: cur.hasKey, len: head.length + inner, parts: [head, tc, ...cur.blocks.flatMap((b) => b.parts)] }); } cur = null; };
    for (const { c, t } of all) {
      const tm = ms(c.timestamp); if (cur && (tm - cur.start > 4000 || (t === 1 && c.key && tm - cur.start > 1000))) flush(); if (!cur) cur = { start: tm, blocks: [], hasKey: false };
      const rel = tm - cur.start; if (t === 1 && c.key) cur.hasKey = true;
      const dl = partSize(c.data); const bh = Uint8Array.from([0x80 | t, (rel >> 8) & 255, rel & 255, c.key ? 0x80 : 0]); const bhead = concat([id(0xa3), vint(bh.length + dl), bh]); cur.blocks.push({ len: bhead.length + dl, parts: [bhead, c.data] });
    }
    flush();
    let pos = info.length + tracks.length; const cuePts: Uint8Array[] = [];
    for (const cl of clusters) { if (cl.hasKey) cuePts.push(el(0xbb, ELu(0xb3, cl.start), el(0xb7, ELu(0xf7, 1), ELu(0xf1, pos)))); pos += cl.len; }
    const cues = el(0x1c53bb6b, ...cuePts); const segLen = info.length + tracks.length + clusters.reduce((n, c) => n + c.len, 0) + cues.length;
    return [ebml, concat([id(0x18538067), vint(segLen)]), info, tracks, ...clusters.flatMap((c) => c.parts), cues];
  }
  finalize(): Uint8Array { return concatParts(this.parts()); }
  finalizeBlob(): Blob { return new Blob(this.parts() as BlobPart[], { type: "video/webm" }); }
}
