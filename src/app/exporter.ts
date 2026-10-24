import { useSyncExternalStore } from "react";
import { renderPhoto } from "../render/compositor";
import { docDuration } from "../doc/compose";
import { IDLE, codecString, isActive, memoAsync, reduce, type ACodec, type ExportEvent, type ExportJob, type ExportKind, type ImgType, type PhotoExportOptions, type VCodec, type VideoExportOptions } from "./exportPlan";
import { offlineAvailable, offlineExport, preflightOffline, probeOffline } from "./offlineExport";
import { resources } from "./resources";
import { player } from "./engine";
import { canvasToBlob } from "./media";
import { getDoc, setUi } from "./store";

let job: ExportJob = IDLE; const subs = new Set<() => void>(); let abort: AbortController | null = null; let timer = 0;
export const getJob = (): ExportJob => job;
export const useExportJob = (): ExportJob => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => job);
export const useExportActive = (): ExportKind | null => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => (isActive(job) ? job.kind : null));
function send(e: ExportEvent): void {
  const next = reduce(job, e); if (next === job) return; job = next; subs.forEach((f) => f()); window.clearTimeout(timer);
  const t = job.token;
  if (job.phase === "completed") timer = window.setTimeout(() => { if (job.token === t) send({ type: "reset" }); }, 3500);
  if (job.phase === "cancelled") timer = window.setTimeout(() => { if (job.token === t) send({ type: "reset" }); }, 2500);
}
export const dismissExport = (): void => send({ type: "reset" });
export const cancelExport = (): void => { abort?.abort(); };
export const exportActive = (): boolean => isActive(job);

const safe = (s: string): string => s.replace(/[^\w.-]+/g, "_") || "opensourceeditor";
function download(blob: Blob, name: string): void { const a = document.createElement("a"); const url = URL.createObjectURL(blob); resources.objectUrls++; a.href = url; a.download = name; a.click(); setTimeout(() => { URL.revokeObjectURL(url); resources.objectUrls--; }, 4000); }

export async function startVideoExport(o: VideoExportOptions): Promise<void> {
  if (isActive(job)) return;
  if (docDuration(getDoc().video) <= 0) { send({ type: "start", kind: "video", label: "" }); send({ type: "fail", error: "The timeline is empty. Add a clip before exporting." }); return; }
  const offline = o.method === "offline" && !!o.offline; send({ type: "start", kind: "video", label: `Exporting ${o.formatLabel} ${o.width}×${o.height} at ${o.fps} fps (${offline ? "frame-accurate" : "real time"})` }); const ac = new AbortController(); abort = ac;
  try {
    if (offline) await preflightOffline({ ...o.offline!, width: o.width, height: o.height, fps: o.fps, videoBps: o.videoBps, audioBps: o.audioBps }); if (ac.signal.aborted) throw new Error("Export cancelled");
    const blob = offline ? await offlineExport({ ...o.offline!, width: o.width, height: o.height, fps: o.fps, videoBps: o.videoBps, audioBps: o.audioBps }, (p) => send({ type: "progress", p }), () => send({ type: "run" }), ac.signal) : await player.record(o, (p) => send({ type: "progress", p }), () => send({ type: "run" }), ac.signal);
    if (!blob.size) throw new Error("The browser produced an empty recording");
    download(blob, `${safe(getDoc().name)}.${o.ext}`); send({ type: "done", label: `Exported ${o.formatLabel}` }); setUi({ status: `Exported ${o.formatLabel}` });
  } catch (e) { if (ac.signal.aborted) send({ type: "cancel" }); else send({ type: "fail", error: e instanceof Error ? e.message : "Export failed" }); }
  finally { abort = null; }
}

export async function photoBlob(o: PhotoExportOptions, signal?: AbortSignal): Promise<Blob> {
  const P = getDoc().photo; const full = document.createElement("canvas"); full.width = P.width; full.height = P.height;
  renderPhoto(full.getContext("2d")!, P, player.resolver, o.background);
  let out = full; if (o.width !== P.width || o.height !== P.height) { out = document.createElement("canvas"); out.width = o.width; out.height = o.height; const x = out.getContext("2d")!; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(full, 0, 0, o.width, o.height); }
  if (signal?.aborted) throw new Error("Export cancelled");
  const blob = await canvasToBlob(out, o.type, o.type === "image/png" ? undefined : o.quality);
  if (blob.type !== o.type) throw new Error(`This browser cannot encode ${o.type.split("/")[1]!.toUpperCase()}; it produced ${blob.type || "an unknown type"} instead`);
  return blob;
}
export async function startPhotoExport(o: PhotoExportOptions): Promise<void> {
  if (isActive(job)) return; send({ type: "start", kind: "photo", label: "Exporting image" }); send({ type: "run" }); const ac = new AbortController(); abort = ac;
  try {
    const blob = await photoBlob(o, ac.signal); const kind = o.type.split("/")[1]!.toUpperCase();
    download(blob, `${safe(getDoc().name)}.${o.type === "image/jpeg" ? "jpg" : o.type.split("/")[1]}`); send({ type: "done", label: `Exported ${kind}` }); setUi({ status: `Exported ${kind} ${o.width}×${o.height}` });
  } catch (e) { if (ac.signal.aborted) send({ type: "cancel" }); else send({ type: "fail", error: e instanceof Error ? e.message : "Export failed" }); }
  finally { abort = null; }
}

export type AudioCodec = "aac" | "opus" | "none";
export interface VideoFormat { id: string; label: string; mime: string; ext: string; codec: "vp9" | "vp8" | "h264"; audio: AudioCodec; note?: string }
interface FormatDef { id: string; ext: string; codec: VideoFormat["codec"]; variants: { mime: string; audio: AudioCodec; label: string; note?: string }[] }
const DEFS: FormatDef[] = [
  { id: "mp4", ext: "mp4", codec: "h264", variants: [
    { mime: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", audio: "aac", label: "MP4" },
    { mime: "video/mp4;codecs=avc1.42E01E,opus", audio: "opus", label: "MP4", note: "This browser can't write the most widely supported audio format into MP4, so the sound is stored in a format that browsers and VLC play but QuickTime may not." },
    { mime: "video/mp4;codecs=avc1.42E01E", audio: "none", label: "MP4", note: "This browser cannot write sound into MP4, so the file will have no sound. Choose WebM to keep it." }] },
  { id: "webm-vp9", ext: "webm", codec: "vp9", variants: [{ mime: "video/webm;codecs=vp9,opus", audio: "opus", label: "WebM" }] },
  { id: "webm-vp8", ext: "webm", codec: "vp8", variants: [{ mime: "video/webm;codecs=vp8,opus", audio: "opus", label: "WebM" }] }];
export function supportedFormats(): VideoFormat[] {
  if (typeof MediaRecorder === "undefined") return [];
  return DEFS.flatMap((d): VideoFormat[] => { const v = d.variants.find((x) => MediaRecorder.isTypeSupported(x.mime)); return v ? [{ id: d.id, label: v.label, mime: v.mime, ext: d.ext, codec: d.codec, audio: v.audio, ...(v.note ? { note: v.note } : {}) }] : []; });
}
type Probed = { ok: boolean; reason?: string };
const probed = new Map<string, Promise<Probed>>();
export function probeEncoder(f: { codec: VCodec }, w: number, h: number, fps: number, bitrate: number): Promise<Probed> {
  return memoAsync(probed, `${f.codec}|${w}x${h}|${fps}|${bitrate}`, async (): Promise<Probed> => {
    const E = (globalThis as unknown as { VideoEncoder?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> } }).VideoEncoder;
    if (!E) return w * h <= 1920 * 1080 ? { ok: true } : { ok: false, reason: "This browser cannot confirm it can encode above 1080p" };
    const codec = codecString(f.codec, w, h, fps);
    try { const r = await E.isConfigSupported({ codec, width: w, height: h, framerate: fps, bitrate }); return r.supported ? { ok: true } : { ok: false, reason: `Not supported by this browser's ${f.codec.toUpperCase()} encoder` }; }
    catch { return { ok: false, reason: "Could not verify encoder support" }; }
  }, (r) => r.ok || r.reason !== "Could not verify encoder support");
}

export interface OfflineFormat { id: string; label: string; ext: string; container: "webm" | "mp4"; codec: VCodec; audio: ACodec; note?: string }
export async function offlineFormats(): Promise<OfflineFormat[]> {
  if (!offlineAvailable()) return [];
  const ok = async (container: "webm" | "mp4", codec: VCodec, audioCodec: ACodec): Promise<boolean> => (await probeOffline({ container, codec, audioCodec }, 1280, 720, 30, 4_000_000)).ok;
  const out: OfflineFormat[] = [];
  if (await ok("mp4", "h264", "none")) { const a: ACodec = (await ok("mp4", "h264", "aac")) ? "aac" : (await ok("mp4", "h264", "opus")) ? "opus" : "none";
    out.push({ id: "mp4", container: "mp4", codec: "h264", ext: "mp4", audio: a, label: "MP4",
      ...(a === "opus" ? { note: "This browser can't write the most widely supported audio format into MP4, so the sound is stored in a format that browsers and VLC play but QuickTime may not." } : a === "none" ? { note: "This browser cannot encode sound for MP4, so the file will have no sound. Choose WebM to keep it." } : {}) }); }
  const wa: ACodec = (await ok("webm", "vp9", "opus")) ? "opus" : "none"; const wnote = wa === "none" ? { note: "This browser cannot encode sound for WebM, so the file will have no sound." } : {};
  if (await ok("webm", "vp9", "none")) out.push({ id: "webm-vp9", container: "webm", codec: "vp9", ext: "webm", audio: wa, label: "WebM", ...wnote });
  if (await ok("webm", "vp8", "none")) out.push({ id: "webm-vp8", container: "webm", codec: "vp8", ext: "webm", audio: wa, label: "WebM", ...wnote });
  return out;
}

let imageTypes: Promise<ImgType[]> | null = null; let imageTypesNow: ImgType[] | null = null;
export const knownImageTypes = (): ImgType[] | null => imageTypesNow;
export function supportedImageTypes(): Promise<ImgType[]> {
  imageTypes ??= (async () => { const c = document.createElement("canvas"); c.width = c.height = 1; const out: ImgType[] = [];
    for (const t of ["image/png", "image/jpeg", "image/webp"] as const) { try { const b = await canvasToBlob(c, t, 0.9); if (b.type === t) out.push(t); } catch { } }
    imageTypesNow = out.length ? out : ["image/png"]; return imageTypesNow; })();
  return imageTypes;
}
if (typeof document !== "undefined") void supportedImageTypes();
