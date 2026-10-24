import { docDuration, flatClips, liveSources } from "../doc/compose";
import type { VideoDoc } from "../doc/schema";
import { renderVideo, fxCacheStats, type Resolver, type Source, clearEffectCache } from "../render/compositor";
import { mixAudio, type MixClip, type Pcm } from "./audioMix";
import { codecString, fitRect, type OfflinePlan } from "./exportPlan";
import { Mp4Muxer } from "./mux/mp4";
import { WebmMuxer, partSize, type MuxChunk } from "./mux/webm";
import { BT709_LIMITED, colorFromEncoder, type VideoColor } from "./mux/color";
import { FrameDecoder, blobReader, openTrack } from "./frameDecoder";
import type { VideoTrack } from "./demux/demux";
import { faults, resources } from "./resources";

export interface OfflineOptions extends OfflinePlan { width: number; height: number; fps: number; videoBps: number; audioBps: number }
export class OfflineUnsupported extends Error {}
export class NeedMainThread extends Error {}
export interface EnvMedia { kind: string; blob: Blob; url?: string; img?: unknown }
export interface ExportEnv { video: VideoDoc; media(id: string): EnvMedia | undefined; bitmap(id: string): Source | null; mix?: Mix | null }
export type Mix = { left: Float32Array; right: Float32Array };
export interface ExportHooks { onProgress(p: number): void; onStart(): void }
const AUDIO_RATE = 48000;
const SPILL_BYTES = 8 * 1024 * 1024;
class Spill {
  private batch: MuxChunk[] = []; private bytes = 0;
  add(c: MuxChunk): void { this.batch.push(c); this.bytes += partSize(c.data); if (this.bytes >= SPILL_BYTES) this.flush(); }
  flush(): void { if (!this.batch.length) return; const blob = new Blob(this.batch.map((c) => c.data) as BlobPart[]); let off = 0; for (const c of this.batch) { const n = partSize(c.data); c.data = blob.slice(off, off + n); off += n; } this.batch = []; this.bytes = 0; }
}
export const offlineStats = { seek: 0, render: 0, encode: 0, backpressure: 0, frames: 0, directClips: 0, openDecoders: 0, peakDecoders: 0, worker: 0, fxHits: 0, fxMisses: 0, seekedClips: 0, audioMs: 0, flushMs: 0, muxMs: 0, totalMs: 0 };

interface Enc<C> { state: string; encodeQueueSize: number; configure(c: unknown): void; encode(x: C, o?: unknown): void; flush(): Promise<void>; close(): void }
type EncCtor<C> = new (init: { output: (chunk: EncChunk, meta?: { decoderConfig?: { description?: ArrayBuffer | ArrayBufferView } }) => void; error: (e: Error) => void }) => Enc<C>;
interface EncChunk { type: string; timestamp: number; duration?: number | null; byteLength: number; copyTo(dst: Uint8Array): void }
const G = globalThis as unknown as { VideoEncoder?: EncCtor<unknown> & { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> }; AudioEncoder?: EncCtor<unknown> & { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> };
  VideoFrame?: new (src: unknown, init: { timestamp: number; duration?: number }) => { close(): void }; AudioData?: new (init: unknown) => { close(): void } };

export const offlineAvailable = (): boolean => !!G.VideoEncoder && !!G.VideoFrame;
const bytes = (d: ArrayBuffer | ArrayBufferView | undefined): Uint8Array | undefined => (d ? new Uint8Array(d instanceof ArrayBuffer ? d.slice(0) : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : undefined);
const mkCanvas = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
type Ctx2 = Parameters<typeof renderVideo>[0];

export async function probeOffline(p: OfflinePlan, w: number, h: number, fps: number, bps: number): Promise<{ ok: boolean; reason?: string }> {
  if (!G.VideoEncoder || !G.VideoFrame) return { ok: false, reason: "This browser has no WebCodecs video encoder" };
  try { const cfg = { codec: codecString(p.codec, w, h, fps), width: w, height: h, framerate: fps, bitrate: bps, ...(p.codec === "h264" ? { avc: { format: "avc" } } : {}) }; if (!(await G.VideoEncoder.isConfigSupported(cfg)).supported) return { ok: false, reason: `The ${p.codec.toUpperCase()} encoder does not support ${w}×${h} at ${fps} fps here` }; } catch { return { ok: false, reason: "Could not verify encoder support" }; }
  if (p.audioCodec !== "none") { if (!G.AudioEncoder || !G.AudioData) return { ok: false, reason: "This browser has no WebCodecs audio encoder" }; try { if (!(await G.AudioEncoder.isConfigSupported(audioConfig(p.audioCodec, 128000))).supported) return { ok: false, reason: `This browser cannot encode ${p.audioCodec.toUpperCase()} audio` }; } catch { return { ok: false, reason: "Could not verify audio encoder support" }; } }
  return { ok: true };
}
const audioConfig = (c: "opus" | "aac", bps: number): Record<string, unknown> => ({ codec: c === "opus" ? "opus" : "mp4a.40.2", sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: bps, ...(c === "aac" ? { aac: { format: "aac" } } : {}) });

const once = (el: HTMLMediaElement, ev: string, ms: number): Promise<void> => new Promise((res, rej) => { const t = setTimeout(() => { el.removeEventListener(ev, f); rej(new Error(`Timed out waiting for the video to ${ev === "seeked" ? "seek" : "load"}`)); }, ms); const f = (): void => { clearTimeout(t); res(); }; el.addEventListener(ev, f, { once: true }); });
class Decoders {
  constructor(private env: ExportEnv) {}
  private els = new Map<string, HTMLVideoElement>(); private direct = new Map<string, FrameDecoder | "no">(); private tracks = new Map<string, Promise<VideoTrack | null>>();
  get(id: string): CanvasImageSource | null { const d = this.direct.get(id); if (d && d !== "no") return d.canvas as CanvasImageSource; return this.els.get(id) ?? null; }
  private async viaElement(fid: string, mediaId: string, sourceTime: number): Promise<void> {
    const rt = this.env.media(mediaId)!; let el = this.els.get(fid);
    if (typeof document === "undefined") throw new NeedMainThread("This clip needs the page to decode it");
    if (!el) { el = document.createElement("video"); el.muted = true; el.preload = "auto"; el.playsInline = true; el.src = rt.url ?? ""; this.els.set(fid, el); resources.videoElements++; offlineStats.seekedClips++; if (el.readyState < 2) await once(el, "loadeddata", 15000); }
    const d = Number.isFinite(el.duration) ? el.duration : sourceTime + 1; const t = Math.max(0, Math.min(sourceTime + 0.001, d - 0.001));
    if (Math.abs(el.currentTime - t) < 5e-4 && el.readyState >= 2) return;
    const done = once(el, "seeked", 8000); el.currentTime = t; await done;
  }
  async prepare(want: Map<string, { mediaId: string; sourceTime: number }>): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const [fid, { mediaId, sourceTime }] of want) {
      const rt = this.env.media(mediaId); if (!rt || rt.kind !== "video") continue;
      jobs.push((async () => {
        let d = this.direct.get(fid);
        if (d === undefined) { let tp = this.tracks.get(mediaId); if (!tp) { tp = openTrack(rt.blob); this.tracks.set(mediaId, tp); } const tr = await tp; if (tr) { d = new FrameDecoder(tr, blobReader(rt.blob)); offlineStats.directClips++; offlineStats.peakDecoders = Math.max(offlineStats.peakDecoders, ++offlineStats.openDecoders); } else d = "no"; this.direct.set(fid, d); }
        if (d !== "no") { try { await d.frameAt(sourceTime * 1e6); return; } catch { d.close(); this.direct.set(fid, "no"); offlineStats.directClips--; offlineStats.openDecoders--; } }
        await this.viaElement(fid, mediaId, sourceTime);
      })());
    }
    await Promise.all(jobs);
    this.releaseFinished(want);
  }
  private releaseFinished(want: Map<string, unknown>): void {
    for (const [id, d] of this.direct) if (!want.has(id)) { if (d !== "no") { d.close(); offlineStats.openDecoders--; } this.direct.delete(id); }
    for (const [id, el] of this.els) if (!want.has(id)) { el.removeAttribute("src"); el.load(); resources.videoElements--; this.els.delete(id); }
  }
  dispose(): void { for (const d of this.direct.values()) if (d !== "no") { d.close(); offlineStats.openDecoders--; } this.direct.clear(); for (const el of this.els.values()) { el.removeAttribute("src"); el.load(); resources.videoElements--; } this.els.clear(); }
}

async function decodeAudio(blob: Blob): Promise<Pcm | null> {
  try { const ctx = new OfflineAudioContext(2, 1, AUDIO_RATE); const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); return { sampleRate: AUDIO_RATE, channels: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)) }; } catch { return null; }
}
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function drain(e: Enc<unknown>, max: number, signal: AbortSignal, failed: () => Error | null): Promise<void> {
  while (e.encodeQueueSize > max) {
    if (signal.aborted) throw new Error("Export cancelled"); const er = failed(); if (er) throw er;
    await new Promise<void>((r) => { const t = setTimeout(r, 20); const ev = e as unknown as { addEventListener?(n: string, f: () => void, o?: unknown): void }; if (ev.addEventListener) ev.addEventListener("dequeue", () => { clearTimeout(t); r(); }, { once: true }); else { clearTimeout(t); setTimeout(r, 2); } });
  }
}

export async function prepareMix(env: ExportEnv, signal: AbortSignal): Promise<Mix | null> {
  const v = env.video, dur = docDuration(v); const cache = new Map<string, Promise<Pcm | null>>(); const clips: MixClip[] = [];
  for (const f of flatClips(v)) { const c = f.clip; const rt = c.mediaId ? env.media(c.mediaId) : undefined; if (!c.mediaId || !rt || (rt.kind !== "video" && rt.kind !== "audio")) continue;
    if (!cache.has(c.mediaId)) cache.set(c.mediaId, decodeAudio(rt.blob)); const pcm = await cache.get(c.mediaId)!; if (signal.aborted) throw new Error("Export cancelled"); if (!pcm) continue;
    clips.push({ pcm, srcStart: c.srcStart, srcEnd: c.srcEnd, speed: c.speed, start: c.start, balance: c.balance, gain: f.gain }); }
  return clips.length ? mixAudio(clips, AUDIO_RATE, dur) : null;
}
export async function exportFrames(o: OfflineOptions, env: ExportEnv, hooks: ExportHooks, signal: AbortSignal): Promise<Blob> {
  const { onProgress, onStart } = hooks;
  if (!offlineAvailable()) throw new OfflineUnsupported("This browser has no WebCodecs encoder");
  const cancelled = (): never => { throw new Error("Export cancelled"); };
  const v = env.video; const dur = docDuration(v); if (dur <= 0) throw new Error("The timeline is empty");
  Object.assign(offlineStats, { seek: 0, render: 0, encode: 0, backpressure: 0, frames: 0, directClips: 0, openDecoders: 0, peakDecoders: 0, worker: 0, fxHits: 0, fxMisses: 0, seekedClips: 0, audioMs: 0, flushMs: 0, muxMs: 0, totalMs: 0 }); const T0 = performance.now(); const frames = Math.max(1, Math.ceil(dur * o.fps - 1e-9)); const frameUs = 1e6 / o.fps; const VE = G.VideoEncoder!; const dec = new Decoders(env);
  fxCacheStats.hits = 0; fxCacheStats.misses = 0; fxCacheStats.enabled = !faults.noFxCache; clearEffectCache();
  let venc: Enc<unknown> | null = null, aenc: Enc<unknown> | null = null; let encError: Error | null = null;
  const vchunks: MuxChunk[] = [], achunks: MuxChunk[] = []; const spill = new Spill(); let avcC: Uint8Array | undefined, aDesc: Uint8Array | undefined; let vColor: VideoColor | undefined;
  try {
    let mix: Mix | null = null; const A0 = performance.now();
    if (o.audioCodec !== "none") mix = env.mix !== undefined ? env.mix : await prepareMix(env, signal);
    onProgress(0.03); offlineStats.audioMs = performance.now() - A0;
    resources.encoders++; venc = new VE({ output: (ch, meta) => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); const vc = { timestamp: ch.timestamp, duration: ch.duration ?? frameUs, key: ch.type === "key", data: d }; vchunks.push(vc); spill.add(vc); avcC ??= bytes(meta?.decoderConfig?.description); if (!vColor && meta?.decoderConfig) vColor = colorFromEncoder((meta.decoderConfig as { colorSpace?: Parameters<typeof colorFromEncoder>[0] }).colorSpace); }, error: (e) => { encError = e; } });
    venc.configure({ codec: codecString(o.codec, o.width, o.height, o.fps), width: o.width, height: o.height, framerate: o.fps, bitrate: o.videoBps, ...(o.codec === "h264" ? { avc: { format: "avc" } } : {}) });
    if (mix && o.audioCodec !== "none") {
      resources.encoders++; aenc = new G.AudioEncoder!({ output: (ch, meta) => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); const ac = { timestamp: ch.timestamp, duration: ch.duration ?? 20000, key: true, data: d }; achunks.push(ac); spill.add(ac); aDesc ??= bytes(meta?.decoderConfig?.description); }, error: (e) => { encError = e; } });
      aenc.configure(audioConfig(o.audioCodec, o.audioBps));
    }
    const fr = fitRect(v.width, v.height, o.width, o.height); const scale = fr.w / v.width; const fw = Math.max(1, Math.ceil(v.width * scale)), fh = Math.max(1, Math.ceil(v.height * scale));
    const frame = mkCanvas(fw, fh); const fctx = frame.getContext("2d") as Ctx2; const same = Math.abs(fr.w - o.width) < 1 && Math.abs(fr.h - o.height) < 1; const outCv = same ? frame : mkCanvas(o.width, o.height);
    const resolver: Resolver = { media: (id, _t, clipId) => { const rt = env.media(id); if (!rt) return env.bitmap(id); if (rt.kind === "image" || rt.kind === "bitmap") return (rt.img ?? null) as Source | null; return (clipId ? dec.get(clipId) : null) as unknown as Source | null; }, mask: (id) => env.bitmap(id) };
    onStart();
    const keyEvery = Math.round(o.fps * 2); let lastYield = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) cancelled(); if (encError) throw encError; if (faults.encodeAtFrame === i) throw new Error(`Simulated encoder failure at frame ${i}`);
      const t = Math.min(i / o.fps, Math.max(0, dur - 1e-6)); const m0 = performance.now(); await dec.prepare(liveSources(v, t)); const m1 = performance.now();
      renderVideo(fctx, v, t, resolver, v.width, v.height, scale); const m2 = performance.now();
      if (!same) { const x = outCv.getContext("2d") as unknown as CanvasRenderingContext2D; x.fillStyle = "#000"; x.fillRect(0, 0, o.width, o.height); x.drawImage(frame as CanvasImageSource, fr.x, fr.y, fr.w, fr.h); }
      const vf = new G.VideoFrame!(outCv, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) }); venc.encode(vf, { keyFrame: i % keyEvery === 0 }); vf.close(); const m3 = performance.now();
      await drain(venc, 6, signal, () => encError);
      offlineStats.seek += m1 - m0; offlineStats.render += m2 - m1; offlineStats.encode += m3 - m2; offlineStats.backpressure += performance.now() - m3; offlineStats.frames++;
      if (i % 4 === 0) onProgress(0.03 + 0.94 * (i / frames));
      if (performance.now() - lastYield >= 12) { await sleep(0); lastYield = performance.now(); }
    }
    const F0 = performance.now(); await venc.flush(); if (encError) throw encError;
    if (mix && aenc) {
      const AD = G.AudioData!; const chunk = AUDIO_RATE;
      for (let p = 0; p < mix.left.length; p += chunk) { if (signal.aborted) cancelled(); const n = Math.min(chunk, mix.left.length - p); const planar = new Float32Array(n * 2); planar.set(mix.left.subarray(p, p + n), 0); planar.set(mix.right.subarray(p, p + n), n);
        const ad = new AD({ format: "f32-planar", sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((p * 1e6) / AUDIO_RATE), data: planar }); aenc.encode(ad); ad.close(); await drain(aenc, 8, signal, () => encError); }
      await aenc.flush(); if (encError) throw encError;
    }
    offlineStats.flushMs = performance.now() - F0; onProgress(0.99); const M0 = performance.now();
    if (faults.mux) throw new Error(faults.mux); const hasAudio = achunks.length > 0; const preSkip = aDesc && aDesc.length >= 12 && aDesc[0] === 0x4f ? aDesc[10]! | (aDesc[11]! << 8) : undefined;
    if (o.container === "webm") {
      if (hasAudio && o.audioCodec !== "opus") throw new Error("WebM can only carry Opus audio");
      const m = new WebmMuxer({ video: { codec: o.codec === "vp8" ? "vp8" : "vp9", width: o.width, height: o.height, fps: o.fps, color: vColor ?? BT709_LIMITED }, ...(hasAudio ? { audio: { sampleRate: AUDIO_RATE, channels: 2, ...(aDesc ? { description: aDesc } : {}), ...(preSkip !== undefined ? { preSkip } : {}) } } : {}) });
      vchunks.forEach((c) => m.addVideo(c)); achunks.forEach((c) => m.addAudio(c)); spill.flush(); const out = m.finalizeBlob(); offlineStats.muxMs = performance.now() - M0; offlineStats.totalMs = performance.now() - T0; return out;
    }
    if (!avcC) throw new Error("The H.264 encoder did not provide its configuration record");
    const m = new Mp4Muxer({ video: { width: o.width, height: o.height, description: avcC, color: vColor ?? BT709_LIMITED }, ...(hasAudio ? { audio: { codec: o.audioCodec === "aac" ? "aac" : "opus", sampleRate: AUDIO_RATE, channels: 2, ...(aDesc ? { description: aDesc } : {}), ...(preSkip !== undefined ? { preSkip } : {}) } } : {}) });
    vchunks.forEach((c) => m.addVideo(c)); achunks.forEach((c) => m.addAudio(c)); spill.flush(); const out = m.finalizeBlob(); offlineStats.muxMs = performance.now() - M0; offlineStats.totalMs = performance.now() - T0; return out;
  } finally {
    dec.dispose(); offlineStats.fxHits = fxCacheStats.hits; offlineStats.fxMisses = fxCacheStats.misses; clearEffectCache(); for (const e of [venc, aenc]) if (e) { try { if (e.state !== "closed") e.close(); } catch { } resources.encoders--; }
  }
}

export async function preflightOffline(o: OfflineOptions): Promise<void> {
  if (faults.preflight) throw new Error(faults.preflight);
  const pf = await probeOffline(o, o.width, o.height, o.fps, o.videoBps); if (!pf.ok) throw new OfflineUnsupported(`${pf.reason ?? "This format is not supported here"}. Choose a lower resolution or frame rate, or a different format.`);
  let err: Error | null = null; let vOut = 0, vKey = false, avcDesc = false; const VE = G.VideoEncoder!; resources.encoders++;
  const ve = new VE({ output: (ch, meta) => { vOut++; vKey ||= ch.type === "key"; if (meta?.decoderConfig?.description) avcDesc = true; }, error: (e) => { err = e; } });
  try {
    ve.configure({ codec: codecString(o.codec, o.width, o.height, o.fps), width: o.width, height: o.height, framerate: o.fps, bitrate: o.videoBps, ...(o.codec === "h264" ? { avc: { format: "avc" } } : {}) });
    const cv = mkCanvas(o.width, o.height); const cx2 = cv.getContext("2d") as unknown as CanvasRenderingContext2D; for (let i = 0; i < 3; i++) { cx2.fillStyle = i % 2 ? "#345" : "#abc"; cx2.fillRect(0, 0, o.width, o.height); const vf = new G.VideoFrame!(cv, { timestamp: Math.round((i * 1e6) / o.fps), duration: Math.round(1e6 / o.fps) }); ve.encode(vf, { keyFrame: i === 0 }); vf.close(); }
    await ve.flush(); if (err) throw err;
    if (!vOut || !vKey) throw new Error(`The ${o.codec.toUpperCase()} encoder accepted its settings but produced no usable output at ${o.width}×${o.height}`); if (o.codec === "h264" && !avcDesc) throw new Error("The H.264 encoder did not provide the configuration MP4 needs");
  } finally { try { if (ve.state !== "closed") ve.close(); } catch { } resources.encoders--; }
  if (o.audioCodec !== "none") {
    let aOut = 0, aDescOk = false; resources.encoders++; const ae = new G.AudioEncoder!({ output: (ch, meta) => { aOut++; if (meta?.decoderConfig?.description) aDescOk = true; void ch; }, error: (e) => { err = e; } });
    try { ae.configure(audioConfig(o.audioCodec, o.audioBps)); const n = AUDIO_RATE / 2; const data = new Float32Array(n * 2); for (let i = 0; i < n; i++) data[i] = data[n + i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / AUDIO_RATE);
      const ad = new G.AudioData!({ format: "f32-planar", sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: 0, data }); ae.encode(ad); ad.close(); await ae.flush(); if (err) throw err;
      if (!aOut) throw new Error(`The ${o.audioCodec.toUpperCase()} audio encoder produced no output. Try exporting without audio, or choose WebM.`); if (o.audioCodec === "aac" && !aDescOk) throw new Error("The AAC encoder did not provide the configuration MP4 needs. Choose WebM, or export without audio."); }
    finally { try { if (ae.state !== "closed") ae.close(); } catch { } resources.encoders--; }
  }
}
