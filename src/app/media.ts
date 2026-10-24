import type { MediaKind, MediaRef } from "../doc/schema";
import { loadPeaks, type Peaks } from "../editor/waveform";

export interface Runtime { id: string; kind: MediaKind; blob: Blob; url: string; img?: HTMLImageElement; peaks?: Peaks | null }
export const runtime = new Map<string, Runtime>();
export const bitmaps = new Map<string, HTMLCanvasElement>();
let rev = 0; const subs = new Set<() => void>();
export const bumpRev = (): void => { rev++; subs.forEach((f) => f()); };
export const subscribeMedia = (f: () => void): (() => void) => { subs.add(f); return () => subs.delete(f); };
export const mediaRev = (): number => rev;
export const uid = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`);

export function kindOf(mime: string): MediaKind | null { return mime.startsWith("video/") ? "video" : mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : null; }

const THUMB = 96;
const loadImg = (url: string): Promise<HTMLImageElement> => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("This image could not be decoded")); i.src = url; });
function probe(kind: "video" | "audio", url: string): Promise<HTMLVideoElement | HTMLAudioElement> {
  return new Promise((res, rej) => { const el = document.createElement(kind); el.preload = "auto"; el.muted = true; el.onloadedmetadata = () => res(el); el.onerror = () => rej(new Error(`This ${kind} file could not be read by the browser`)); el.src = url; });
}
function thumbFrom(src: CanvasImageSource, w: number, h: number): string {
  const k = THUMB / Math.max(w, h), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.7);
}

export async function ingest(blob: Blob, name: string, id = uid(), knownKind?: MediaKind): Promise<MediaRef> {
  const kind = knownKind ?? kindOf(blob.type); if (!kind) throw new Error(`"${name}" is not a supported video, audio or image file`);
  const url = URL.createObjectURL(blob); const ref: MediaRef = { id, kind, name, mime: blob.type };
  try {
    if (kind === "image" || kind === "bitmap") { const img = await loadImg(url); runtime.set(id, { id, kind, blob, url, img }); ref.width = img.naturalWidth; ref.height = img.naturalHeight; ref.thumb = thumbFrom(img, img.naturalWidth, img.naturalHeight); }
    else if (kind === "video") {
      const v = (await probe("video", url)) as HTMLVideoElement; await settleDuration(v); ref.duration = v.duration; ref.width = v.videoWidth; ref.height = v.videoHeight;
      await new Promise<void>((r) => { v.onseeked = () => r(); v.currentTime = Math.min(0.1, v.duration / 2); setTimeout(r, 1500); });
      try { ref.thumb = thumbFrom(v, v.videoWidth, v.videoHeight); } catch { }
      runtime.set(id, { id, kind, blob, url }); void loadPeaks(id, blob).then((p) => { const r = runtime.get(id); if (r) { r.peaks = p; ref.hasAudio = !!p; bumpRev(); } });
    } else {
      const a = (await probe("audio", url)) as HTMLAudioElement; await settleDuration(a); ref.duration = a.duration; runtime.set(id, { id, kind, blob, url });
      void loadPeaks(id, blob).then((p) => { const r = runtime.get(id); if (r) { r.peaks = p; bumpRev(); } });
    }
  } catch (e) { URL.revokeObjectURL(url); runtime.delete(id); throw e; }
  return ref;
}
export function dropRuntime(id: string): void { const r = runtime.get(id); if (r) { URL.revokeObjectURL(r.url); runtime.delete(id); } }
export function clearRuntime(): void { for (const id of [...runtime.keys()]) dropRuntime(id); bitmaps.clear(); }

export function newBitmap(w: number, h: number, fill?: string): { id: string; canvas: HTMLCanvasElement } {
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h; const x = canvas.getContext("2d", { willReadFrequently: true })!;
  if (fill) { x.fillStyle = fill; x.fillRect(0, 0, w, h); } const id = uid(); bitmaps.set(id, canvas); return { id, canvas };
}
export function cloneBitmap(id: string): { id: string; canvas: HTMLCanvasElement } {
  const src = bitmaps.get(id); const { id: nid, canvas } = newBitmap(src?.width ?? 1, src?.height ?? 1);
  if (src) canvas.getContext("2d")!.drawImage(src, 0, 0); return { id: nid, canvas };
}
export const canvasToBlob = (c: HTMLCanvasElement, type = "image/png", q?: number): Promise<Blob> => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(`This browser cannot encode ${type}`))), type, q));

async function settleDuration(el: HTMLMediaElement): Promise<void> {
  if (Number.isFinite(el.duration)) return;
  await new Promise<void>((r) => { const done = (): void => { el.removeEventListener("durationchange", chk); r(); }; const chk = (): void => { if (Number.isFinite(el.duration)) { el.currentTime = 0; done(); } }; el.addEventListener("durationchange", chk); el.currentTime = 1e101; setTimeout(done, 2000); });
}
