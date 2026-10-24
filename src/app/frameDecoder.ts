import { demuxVideo, type Read, type VideoTrack } from "./demux/demux";
import { resources } from "./resources";

interface VFrame { timestamp: number; displayWidth: number; displayHeight: number; close(): void }
interface VDecoder { decodeQueueSize: number; state: string; configure(c: unknown): void; decode(c: unknown): void; flush(): Promise<void>; reset(): void; close(): void }
const G = globalThis as unknown as { VideoDecoder?: (new (init: { output: (f: VFrame) => void; error: (e: Error) => void }) => VDecoder) & { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> }; EncodedVideoChunk?: new (init: { type: string; timestamp: number; data: Uint8Array }) => unknown };
const MAX_BATCH_BYTES = 24 * 1024 * 1024;

export const decodeFlags = { direct: true };
export const blobReader = (b: Blob): Read => async (o, l) => new Uint8Array(await b.slice(o, o + l).arrayBuffer());
export async function openTrack(blob: Blob): Promise<VideoTrack | null> {
  if (!decodeFlags.direct || !G.VideoDecoder || !G.EncodedVideoChunk) return null;
  const tr = await demuxVideo(blobReader(blob), blob.size); if (!tr) return null;
  try { const s = await G.VideoDecoder.isConfigSupported(cfg(tr)); return s.supported ? tr : null; } catch { return null; }
}
const cfg = (tr: VideoTrack): Record<string, unknown> => ({ codec: tr.codec, codedWidth: tr.width, codedHeight: tr.height, ...(tr.description ? { description: tr.description } : {}) });

export class FrameDecoder {
  private dec: VDecoder | null = null; private out = new Map<number, VFrame>(); private fed = -1; private err: Error | null = null; private wake: (() => void) | null = null; private wantPts = -Infinity;
  private readonly lookahead: number; private win: { lo: number; hi: number; buf: Uint8Array } | null = null; private floorPts = -Infinity;
  private readonly sortedPts: number[]; private readonly sortedIdx: number[]; private readonly prefixMax: number[]; private readonly keys: number[];
  readonly canvas: OffscreenCanvas | HTMLCanvasElement; private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  constructor(private tr: VideoTrack, private read: Read) {
    this.lookahead = Math.max(2, Math.min(10, Math.floor(96e6 / Math.max(1, (tr.width * tr.height * 3) / 2))));
    const order = tr.samples.map((s, i) => ({ p: s.pts, i })).sort((a, b) => a.p - b.p || a.i - b.i); this.sortedPts = order.map((o) => o.p); this.sortedIdx = order.map((o) => o.i);
    let m = -1; this.prefixMax = this.sortedIdx.map((i) => (m = Math.max(m, i))); this.keys = tr.samples.flatMap((s, i) => (s.key ? [i] : []));
    const sw = tr.rotation % 180 === 0; const cw = (sw ? tr.width : tr.height) || 2, ch = (sw ? tr.height : tr.width) || 2;
    this.canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(cw, ch) : Object.assign(document.createElement("canvas"), { width: cw, height: ch });
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
  }
  private start(): void {
    if (this.dec) { try { this.dec.close(); } catch { } resources.decoders--; } this.drop(); this.err = null; this.fed = -1;
    this.dec = new G.VideoDecoder!({ output: (f) => { if (this.tr.samples[f.timestamp]!.pts < this.wantPts || this.out.has(f.timestamp)) f.close(); else this.out.set(f.timestamp, f); this.wake?.(); }, error: (e) => { this.err = e; this.wake?.(); } });
    resources.decoders++; this.dec.configure(cfg(this.tr));
  }
  private drop(): void { for (const f of this.out.values()) f.close(); this.out.clear(); }
  private async until(pred: () => boolean, ms: number): Promise<boolean> { const end = performance.now() + ms; while (!pred()) { if (this.err) throw this.err; const left = end - performance.now(); if (left <= 0) return false; await new Promise<void>((r) => { const t = setTimeout(r, Math.min(left, 4)); this.wake = () => { clearTimeout(t); r(); }; }); } return true; }
  private async bytes(lo: number, hi: number): Promise<Uint8Array> {
    const w = this.win; if (w && lo >= w.lo && hi <= w.hi) return w.buf.subarray(lo - w.lo, hi - w.lo);
    const len = Math.max(hi - lo, 4 * 1024 * 1024); const buf = await this.read(lo, len); this.win = { lo, hi: lo + buf.length, buf }; return buf.subarray(0, hi - lo);
  }
  private async feed(from: number, to: number): Promise<void> {
    const S = this.tr.samples; let a = from;
    while (a <= to) {
      let b = a, bytes = S[a]!.size; while (b < to && bytes + S[b + 1]!.size < MAX_BATCH_BYTES) { b++; bytes += S[b]!.size; }
      let lo = Infinity, hi = 0; for (let i = a; i <= b; i++) { lo = Math.min(lo, S[i]!.offset); hi = Math.max(hi, S[i]!.offset + S[i]!.size); }
      const buf = await this.bytes(lo, hi);
      for (let i = a; i <= b; i++) { const s = S[i]!; this.dec!.decode(new G.EncodedVideoChunk!({ type: s.key ? "key" : "delta", timestamp: i, data: buf.subarray(s.offset - lo, s.offset - lo + s.size) })); this.fed = i; while (this.dec!.decodeQueueSize > 16) { if (this.err) throw this.err; await this.until(() => this.dec!.decodeQueueSize <= 16, 20).catch(() => false); } }
      a = b + 1;
    }
  }
  async frameAt(us: number): Promise<void> {
    const S = this.tr.samples; let lo = 0, hi = this.sortedPts.length - 1, s = 0; while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.sortedPts[mid]! <= us + 1000) { s = mid; lo = mid + 1; } else hi = mid - 1; }
    const d0 = this.sortedIdx[s]!, D = this.prefixMax[s]!; this.wantPts = S[d0]!.pts;
    if (!this.out.has(d0)) {
      let k = 0; { let l = 0, h = this.keys.length - 1; while (l <= h) { const m = (l + h) >> 1; if (this.keys[m]! <= d0) { k = this.keys[m]!; l = m + 1; } else h = m - 1; } }
      if (!this.dec || this.dec.state === "closed" || this.fed < 0 || k > this.fed + 1 || S[d0]!.pts < this.floorPts) { this.start(); this.fed = k - 1; this.floorPts = -Infinity; }
      await this.feed(this.fed + 1, Math.min(S.length - 1, D + this.lookahead));
      let tries = 0; while (!(await this.until(() => this.out.has(d0), 60))) {
        if (this.fed >= S.length - 1) { await this.dec!.flush(); this.fed = -1; if (!this.out.has(d0)) throw new Error("decoder produced no frame for this time"); break; }
        if (++tries > 24) throw new Error("decoder did not output the requested frame"); await this.feed(this.fed + 1, Math.min(S.length - 1, this.fed + 4));
      }
    } else if (this.fed >= 0 && this.fed < Math.min(S.length - 1, D + this.lookahead)) await this.feed(this.fed + 1, Math.min(S.length - 1, D + this.lookahead));
    const f = this.out.get(d0)!; const rot = this.tr.rotation; const dw = rot % 180 === 0 ? f.displayWidth : f.displayHeight, dh = rot % 180 === 0 ? f.displayHeight : f.displayWidth; if (this.canvas.width !== dw || this.canvas.height !== dh) { this.canvas.width = dw; this.canvas.height = dh; }
    this.ctx.save(); if (rot === 90) { this.ctx.translate(dw, 0); this.ctx.rotate(Math.PI / 2); } else if (rot === 180) { this.ctx.translate(dw, dh); this.ctx.rotate(Math.PI); } else if (rot === 270) { this.ctx.translate(0, dh); this.ctx.rotate(-Math.PI / 2); }
    this.ctx.drawImage(f as unknown as CanvasImageSource, 0, 0); this.ctx.restore();
    for (const [i, fr] of this.out) if (S[i]!.pts < this.wantPts) { fr.close(); this.out.delete(i); }
    this.floorPts = this.wantPts;
  }
  close(): void { if (this.dec) { try { this.dec.close(); } catch { } resources.decoders--; } this.dec = null; this.drop(); }
}
