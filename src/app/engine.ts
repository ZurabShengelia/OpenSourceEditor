import { clipDuration, clipEnd, docDuration, flatClips, liveClipIds } from "../doc/compose";
import type { TClip } from "../doc/schema";
import { renderVideo, type Resolver, type Source } from "../render/compositor";
import { fitRect, type VideoExportOptions } from "./exportPlan";
import { bitmaps, runtime } from "./media";
import { getDoc, transport } from "./store";

interface Node { el: HTMLMediaElement; gain: GainNode | null; pan: StereoPannerNode | null }
type Listener = () => void;

class Player {
  frame = document.createElement("canvas");
  private fctx = this.frame.getContext("2d")!;
  private nodes = new Map<string, Node>();
  private ac: AudioContext | null = null; private master: GainNode | null = null;
  private raf = 0; private t0 = 0; private wall0 = 0; private views = new Set<Listener>(); private enders = new Set<Listener>();
  quality = 1;
  private recording = false; private exportPlay = false; private out: HTMLCanvasElement | null = null;
  get isRecording(): boolean { return this.recording; }

  onFrame(f: Listener): () => void { this.views.add(f); return () => this.views.delete(f); }
  private audio(): AudioContext | null {
    if (this.ac) return this.ac;
    const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!C) return null;
    this.ac = new C(); this.master = this.ac.createGain(); this.master.connect(this.ac.destination); return this.ac;
  }
  private node(c: TClip): Node | null {
    const hit = this.nodes.get(c.id); const rt = c.mediaId ? runtime.get(c.mediaId) : undefined;
    if (hit) { if (hit.el.src === rt?.url) return hit; this.drop(c.id); }
    if (!rt || (rt.kind !== "video" && rt.kind !== "audio")) return null;
    const el = document.createElement(rt.kind === "video" ? "video" : "audio"); el.preload = "auto"; el.src = rt.url; if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.addEventListener("seeked", () => this.draw()); el.addEventListener("loadeddata", () => this.draw());
    let gain: GainNode | null = null, pan: StereoPannerNode | null = null; const ac = this.audio();
    if (ac && this.master) { const src = ac.createMediaElementSource(el); gain = ac.createGain(); pan = ac.createStereoPanner(); src.connect(gain); gain.connect(pan); pan.connect(this.master); }
    else el.muted = false;
    const n = { el, gain, pan }; this.nodes.set(c.id, n); return n;
  }
  private drop(id: string): void { const n = this.nodes.get(id); if (!n) return; n.el.pause(); n.el.removeAttribute("src"); n.el.load(); n.gain?.disconnect(); n.pan?.disconnect(); this.nodes.delete(id); }

  private flatCache: { v: unknown; map: Map<string, TClip> } | null = null;
  private flatIndex(): Map<string, TClip> { const v = getDoc().video; if (this.flatCache?.v !== v) this.flatCache = { v, map: new Map(flatClips(v).map((f) => [f.clip.id, f.clip])) }; return this.flatCache.map; }
  resolver: Resolver = {
    media: (id, st, clipId) => {
      const rt = runtime.get(id); if (!rt) return bitmaps.get(id) ?? null;
      if (rt.kind === "image" || rt.kind === "bitmap") return rt.img ?? null;
      const c = clipId ? this.flatIndex().get(clipId) : undefined; void st; const n = c ? this.node(c) : null; return (n?.el as unknown as Source) ?? null;
    },
    mask: (id) => bitmaps.get(id) ?? null,
  };

  sync(t: number, playing: boolean): void {
    const doc = getDoc(); const v = doc.video; const live = liveClipIds(v, t); const flat = flatClips(v); const known = new Set(flat.map((f) => f.clip.id));
    for (const id of [...this.nodes.keys()]) if (!known.has(id)) this.drop(id);
    for (const { clip: c, gain } of flat) {
      if (c.type !== "media") continue; const rt = c.mediaId ? runtime.get(c.mediaId) : undefined; if (!rt || (rt.kind !== "video" && rt.kind !== "audio")) continue;
      const inside = t >= c.start && t < clipEnd(c); if (!inside && !live.has(c.id)) { this.nodes.get(c.id)?.el.pause(); if (this.nodes.get(c.id)?.gain) this.nodes.get(c.id)!.gain!.gain.value = 0; continue; }
      const n = this.node(c); if (!n) continue;
      const src = Math.max(0, c.srcStart + (Math.min(Math.max(t, c.start), clipEnd(c)) - c.start) * c.speed);
      n.el.playbackRate = Math.min(16, Math.max(0.0625, c.speed));
      if (n.gain) n.gain.gain.value = inside ? gain(t) : 0; else n.el.volume = inside ? Math.min(1, gain(t)) : 0;
      if (n.pan) n.pan.pan.value = Math.max(-1, Math.min(1, c.balance));
      if (playing && inside) { if (n.el.paused) { n.el.currentTime = src; void n.el.play().catch(() => undefined); } else if (Math.abs(n.el.currentTime - src) > 0.3) n.el.currentTime = src; }
      else { if (!n.el.paused) n.el.pause(); if (Math.abs(n.el.currentTime - src) > 0.03) n.el.currentTime = src; }
    }
  }
  draw(): void {
    const v = getDoc().video; const w = Math.round(v.width * this.quality), h = Math.round(v.height * this.quality);
    if (this.frame.width !== w || this.frame.height !== h) { this.frame.width = w; this.frame.height = h; }
    renderVideo(this.fctx, v, transport.t, this.resolver, v.width, v.height, this.quality);
    if (this.out) { const o = this.out.getContext("2d")!, r = fitRect(w, h, this.out.width, this.out.height); o.fillStyle = "#000"; o.fillRect(0, 0, this.out.width, this.out.height); o.drawImage(this.frame, r.x, r.y, r.w, r.h); }
    const now = performance.now(); if (!this.recording || now - this.lastViewDraw > 120) { this.lastViewDraw = now; this.views.forEach((f) => f()); }
  }
  private lastViewDraw = 0;
  refresh(): void { if (!transport.playing) this.sync(transport.t, false); this.draw(); }
  seek(t: number): void { if (this.recording) return; const end = docDuration(getDoc().video); transport.set(Math.min(Math.max(0, t), Math.max(end, t)), transport.playing); if (transport.playing) { this.t0 = transport.t; this.wall0 = performance.now(); } this.refresh(); }

  play(): void {
    if (transport.playing || (this.recording && !this.exportPlay)) return; const end = docDuration(getDoc().video); if (end <= 0) return; if (transport.t >= end - 0.02) transport.set(0, false);
    void this.audio()?.resume(); this.t0 = transport.t; this.wall0 = performance.now(); transport.set(transport.t, true);
    const tick = (): void => {
      const t = this.t0 + (performance.now() - this.wall0) / 1000; const e = docDuration(getDoc().video);
      if (t >= e) { this.halt(); transport.set(e, false); this.refresh(); this.enders.forEach((f) => f()); return; }
      transport.set(t, true); this.sync(t, true); this.draw(); this.raf = requestAnimationFrame(tick);
    }; this.raf = requestAnimationFrame(tick);
  }
  pause(): void { if (this.recording) return; this.halt(); }
  private halt(): void { cancelAnimationFrame(this.raf); transport.set(transport.t, false); for (const n of this.nodes.values()) n.el.pause(); }
  toggle(): void { if (transport.playing) this.pause(); else this.play(); }

  async record(o: VideoExportOptions, onProgress: (p: number) => void, onStart: () => void, signal: AbortSignal): Promise<Blob> {
    if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record video");
    if (this.recording) throw new Error("An export is already running");
    const v0 = getDoc().video; const end = docDuration(v0); if (end <= 0) throw new Error("The timeline is empty");
    this.halt(); this.recording = true; const prevQ = this.quality; const prevOut = this.out;
    let dest: MediaStreamAudioDestinationNode | null = null; let stream: MediaStream | null = null; let unsub = (): void => undefined;
    try {
      const k = o.width / v0.width; const fr = fitRect(v0.width, v0.height, o.width, o.height);
      this.quality = fr.w / v0.width;
      if (Math.abs(fr.w - o.width) < 1 && Math.abs(fr.h - o.height) < 1) { this.out = null; this.quality = k; }
      else { const c = document.createElement("canvas"); c.width = o.width; c.height = o.height; this.out = c; }
      transport.set(0, false); this.sync(0, false); this.draw(); await new Promise((r) => setTimeout(r, 500)); if (signal.aborted) return this.cancelled();
      const ac = o.audio ? this.audio() : null; await ac?.resume(); dest = ac?.createMediaStreamDestination() ?? null; if (dest && this.master) this.master.connect(dest);
      stream = (this.out ?? this.frame).captureStream(o.fps); dest?.stream.getAudioTracks().forEach((tr) => stream!.addTrack(tr));
      const rec = new MediaRecorder(stream, { mimeType: o.mime, videoBitsPerSecond: o.videoBps, ...(dest ? { audioBitsPerSecond: o.audioBps } : {}) }); const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const stopped = new Promise<void>((res, rej) => { rec.onstop = () => res(); rec.onerror = (ev) => { const er = (ev as unknown as { error?: { name?: string; message?: string } }).error; rej(new Error(`The browser stopped recording${er?.name ? ` (${er.name}${er.message ? `: ${er.message}` : ""})` : ""}. This size or frame rate may be more than this machine can encode in real time; try a lower resolution or frame rate.`)); }; });
      unsub = transport.subscribe(() => onProgress(Math.min(1, transport.t / end)));
      const ended = new Promise<void>((res) => { const f = (): void => { this.enders.delete(f); res(); }; this.enders.add(f); signal.addEventListener("abort", () => { this.halt(); this.enders.delete(f); res(); }, { once: true }); });
      rec.start(250); onStart(); this.exportPlay = true; this.play(); this.exportPlay = false; await ended; await new Promise((r) => setTimeout(r, 150));
      if (rec.state !== "inactive") rec.stop(); await stopped;
      if (signal.aborted) return this.cancelled();
      return new Blob(chunks, { type: o.mime.split(";")[0] });
    } finally {
      unsub(); if (dest && this.master) this.master.disconnect(dest); stream?.getTracks().forEach((tr) => tr.stop());
      this.recording = false; this.exportPlay = false; this.out = prevOut; this.quality = prevQ; this.halt(); transport.set(0, false); this.refresh();
    }
  }
  private cancelled(): never { throw new Error("Export cancelled"); }
}
export const player = new Player();

export { clipDuration };
