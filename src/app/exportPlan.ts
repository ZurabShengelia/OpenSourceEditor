
export type ExportPhase = "idle" | "preparing" | "exporting" | "completed" | "cancelled" | "failed";
export type ExportKind = "video" | "photo";
export interface ExportJob { phase: ExportPhase; kind: ExportKind | null; progress: number; label: string; error: string | null; token: number }
export const IDLE: ExportJob = { phase: "idle", kind: null, progress: 0, label: "", error: null, token: 0 };
export const isActive = (j: ExportJob): boolean => j.phase === "preparing" || j.phase === "exporting";

export type ExportEvent =
  | { type: "start"; kind: ExportKind; label: string }
  | { type: "run" } | { type: "progress"; p: number } | { type: "done"; label: string }
  | { type: "cancel" } | { type: "fail"; error: string } | { type: "reset" };

export function reduce(j: ExportJob, e: ExportEvent): ExportJob {
  switch (e.type) {
    case "start": return isActive(j) ? j : { phase: "preparing", kind: e.kind, progress: 0, label: e.label, error: null, token: j.token + 1 };
    case "run": return j.phase === "preparing" ? { ...j, phase: "exporting" } : j;
    case "progress": return j.phase === "exporting" ? { ...j, progress: Math.min(1, Math.max(0, e.p)) } : j;
    case "done": return isActive(j) ? { ...j, phase: "completed", progress: 0, label: e.label } : j;
    case "cancel": return isActive(j) ? { ...j, phase: "cancelled", progress: 0, label: "Export cancelled" } : j;
    case "fail": return isActive(j) ? { ...j, phase: "failed", progress: 0, error: e.error } : j;
    case "reset": return isActive(j) ? j : { ...IDLE, token: j.token };
  }
}

export type Aspect = "original" | "16:9" | "9:16" | "1:1" | "4:3";
export type ResolutionId = "original" | "720" | "1080" | "1440" | "2160";
export type QualityId = "low" | "medium" | "high";
export const RESOLUTIONS: readonly { id: ResolutionId; label: string; short: number }[] = [
  { id: "original", label: "Original", short: 0 }, { id: "720", label: "720p", short: 720 }, { id: "1080", label: "1080p", short: 1080 }, { id: "1440", label: "1440p", short: 1440 }, { id: "2160", label: "4K (2160p)", short: 2160 }];
export const ASPECTS: readonly { id: Aspect; label: string }[] = [{ id: "original", label: "Original" }, { id: "16:9", label: "16:9" }, { id: "9:16", label: "9:16" }, { id: "1:1", label: "1:1" }, { id: "4:3", label: "4:3" }];
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

export function outputSize(srcW: number, srcH: number, res: ResolutionId, aspect: Aspect): { w: number; h: number } {
  const ratio = aspect === "original" ? srcW / srcH : (() => { const [a, b] = aspect.split(":").map(Number) as [number, number]; return a / b; })();
  const short = RESOLUTIONS.find((r) => r.id === res)?.short ?? 0;
  if (!short) {
    if (aspect === "original") return { w: even(srcW), h: even(srcH) };
    const s = Math.min(srcW, srcH); return ratio >= 1 ? { w: even(s * ratio), h: even(s) } : { w: even(s), h: even(s / ratio) };
  }
  return ratio >= 1 ? { w: even(short * ratio), h: even(short) } : { w: even(short), h: even(short / ratio) };
}
const BPP: Record<QualityId, number> = { low: 0.05, medium: 0.09, high: 0.16 };
export function videoBitrate(w: number, h: number, fps: number, q: QualityId): number { return Math.round(Math.min(80_000_000, Math.max(1_000_000, w * h * fps * BPP[q]))); }
export function estimateBytes(durationSec: number, videoBps: number, audioBps: number): number { return Math.round(durationSec * (videoBps + audioBps) / 8); }
export function fitRect(srcW: number, srcH: number, dstW: number, dstH: number): { x: number; y: number; w: number; h: number } {
  const k = Math.min(dstW / srcW, dstH / srcH); const w = srcW * k, h = srcH * k; return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}
export type ExportMethod = "offline" | "realtime";
export type VCodec = "vp9" | "vp8" | "h264"; export type ACodec = "opus" | "aac" | "none";
export function codecString(codec: VCodec, w: number, h: number, fps: number): string {
  const r = w * h * fps;
  if (codec === "vp8") return "vp8";
  if (codec === "vp9") return r <= 1920 * 1080 * 60 ? "vp09.00.41.08" : "vp09.00.51.08";
  return `avc1.${r <= 1920 * 1080 * 30 ? "640028" : r <= 1920 * 1080 * 60 ? "64002A" : r <= 4096 * 2304 * 30 ? "640033" : "640034"}`;
}
export interface OfflinePlan { container: "webm" | "mp4"; codec: VCodec; audioCodec: ACodec }
export interface VideoExportOptions { mime: string; ext: string; formatLabel: string; width: number; height: number; fps: 30 | 60; videoBps: number; audio: boolean; audioBps: number; method?: ExportMethod; offline?: OfflinePlan }

export type ImgType = "image/png" | "image/jpeg" | "image/webp";
export interface PhotoExportOptions { type: ImgType; width: number; height: number; quality: number; background: string | null }
export const hasAlpha = (t: ImgType): boolean => t !== "image/jpeg";
export function linkedSize(srcW: number, srcH: number, edit: "w" | "h", v: number): { w: number; h: number } {
  const n = Math.min(16384, Math.max(1, Math.round(v))); return edit === "w" ? { w: n, h: Math.max(1, Math.round(n * srcH / srcW)) } : { w: Math.max(1, Math.round(n * srcW / srcH)), h: n };
}

export interface FormatGroup<F extends { id: string; ext: string; codec: VCodec }> { id: "mp4" | "webm"; label: "MP4" | "WebM"; ext: string; options: F[] }
export const CODEC_CHOICE: Record<VCodec, { label: string; hint: string }> = {
  h264: { label: "H.264", hint: "Plays almost everywhere. Hardware encoding is used only if your browser provides it." },
  vp9: { label: "VP9", hint: "Smaller files at the same quality, but slower to encode." },
  vp8: { label: "VP8", hint: "Faster to encode and lighter on the CPU, but makes larger files." } };
const ORDER: VCodec[] = ["h264", "vp9", "vp8"];
export function groupFormats<F extends { id: string; ext: string; codec: VCodec }>(list: readonly F[]): FormatGroup<F>[] {
  const out: FormatGroup<F>[] = []; for (const ext of ["mp4", "webm"] as const) { const options = list.filter((f) => f.ext === ext).sort((a, b) => ORDER.indexOf(a.codec) - ORDER.indexOf(b.codec)); if (options.length) out.push({ id: ext, label: ext === "mp4" ? "MP4" : "WebM", ext, options }); }
  return out;
}

export function memoAsync<T>(cache: Map<string, Promise<T>>, key: string, run: () => Promise<T>, keep: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(key); if (hit) return hit;
  const p = run().then((v) => { if (!keep(v)) cache.delete(key); return v; }, (e: unknown) => { cache.delete(key); throw e; });
  cache.set(key, p); return p;
}
