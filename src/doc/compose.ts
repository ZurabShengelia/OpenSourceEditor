import { valueAt } from "./keyframes";
import type { Compound, TClip, Track, Transition, VideoDoc } from "./schema";

export const clipDuration = (c: TClip): number => (c.srcEnd - c.srcStart) / c.speed;
export const clipEnd = (c: TClip): number => c.start + clipDuration(c);
export const docDuration = (v: VideoDoc): number => Math.max(0, ...Object.values(v.clips).map(clipEnd));

export interface DrawItem {
  clipId: string; trackId: string; type: "media" | "text" | "compound"; mediaId?: string; compoundId?: string;
  sourceTime: number; x: number; y: number; scale: number; rotation: number; opacity: number;
  crop: TClip["crop"]; filters: TClip["filters"];
  reveal: { l: number; t: number; r: number; b: number } | null;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
export function fadeGain(c: TClip, tl: number): number {
  const d = clipDuration(c); const l = tl - c.start;
  let g = 1;
  if (c.fadeIn > 0) g = Math.min(g, clamp01(l / c.fadeIn));
  if (c.fadeOut > 0) g = Math.min(g, clamp01((d - l) / c.fadeOut));
  return g;
}

export function transitionProgress(tr: Transition, from: TClip, to: TClip, t: number): number | null {
  if (tr.kind === "cut" || tr.duration <= 0) return null;
  const mid = (clipEnd(from) + to.start) / 2;
  const a = mid - tr.duration / 2;
  if (t < a || t > a + tr.duration) return null;
  return (t - a) / tr.duration;
}

const trackById = (v: VideoDoc): Map<string, Track> => new Map(v.tracks.map((t) => [t.id, t]));
export function anySolo(v: VideoDoc, kind: Track["kind"][]): boolean { return v.tracks.some((t) => t.solo && kind.includes(t.kind)); }

export function evaluateFrame(v: VideoDoc, t: number): DrawItem[] {
  const soloV = anySolo(v, ["video", "text"]); const out: DrawItem[] = [];
  const clips = Object.values(v.clips);
  for (const track of v.tracks) {
    if (track.kind === "audio" || !track.visible || (soloV && !track.solo)) continue;
    const mine = clips.filter((c) => c.trackId === track.id && !c.disabled).sort((a, b) => a.start - b.start);
    const trs = v.transitions.filter((x) => x.trackId === track.id);
    for (const c of mine) {
      const trIn = trs.find((x) => x.toClipId === c.id), trOut = trs.find((x) => x.fromClipId === c.id);
      const tIn = trIn ? mine.find((m) => m.id === trIn.fromClipId) : undefined, tOut = trOut ? mine.find((m) => m.id === trOut.toClipId) : undefined;
      const preroll = trIn && tIn ? Math.max(0, c.start - (clipEnd(tIn) + c.start) / 2 + trIn.duration / 2) : 0;
      const postroll = trOut && tOut ? Math.max(0, (clipEnd(c) + tOut.start) / 2 + trOut.duration / 2 - clipEnd(c)) : 0;
      if (t < c.start - preroll || t >= clipEnd(c) + postroll) continue;
      const local = Math.min(Math.max(t - c.start, 0), clipDuration(c));
      let x = valueAt(c, "x", local), y = valueAt(c, "y", local), opacity = valueAt(c, "opacity", local) * fadeGain(c, t);
      let reveal: DrawItem["reveal"] = null;
      const apply = (tr: Transition, p: number, incoming: boolean): void => {
        const k = incoming ? p : 1 - p;
        if (tr.kind === "fade") opacity *= k;
        else if (tr.kind === "dissolve") { if (incoming) opacity *= k; }
        else if (tr.kind === "slide") { const o = 1 - k, sgn = incoming ? 1 : -1;
          if (tr.dir === "l") x += sgn * o; else if (tr.dir === "r") x -= sgn * o; else if (tr.dir === "u") y += sgn * o; else y -= sgn * o; }
        else if (tr.kind === "wipe" && incoming) reveal = tr.dir === "l" ? { l: 1 - k, t: 0, r: 1, b: 1 } : tr.dir === "r" ? { l: 0, t: 0, r: k, b: 1 } : tr.dir === "u" ? { l: 0, t: 1 - k, r: 1, b: 1 } : { l: 0, t: 0, r: 1, b: k };
        else if (tr.kind === "wipe") opacity *= 1;
      };
      if (trIn && tIn) { const p = transitionProgress(trIn, tIn, c, t); if (p !== null) apply(trIn, p, true); else if (t < c.start) continue; }
      if (trOut && tOut) { const p = transitionProgress(trOut, c, tOut, t); if (p !== null) apply(trOut, p, false); else if (t >= clipEnd(c)) continue; }
      const item: DrawItem = { clipId: c.id, trackId: c.trackId, type: c.type, sourceTime: c.srcStart + local * c.speed, x, y, scale: valueAt(c, "scale", local), rotation: valueAt(c, "rotation", local), opacity: clamp01(opacity), crop: c.crop, filters: c.filters, reveal };
      if (c.mediaId !== undefined) item.mediaId = c.mediaId;
      if (c.type === "compound" && c.compoundId && v.compounds?.[c.compoundId]) item.compoundId = c.compoundId; else if (c.type === "compound") continue;
      out.push(item);
    }
  }
  return out;
}

export function clipGain(v: VideoDoc, c: TClip, t: number): number {
  if (c.detached || c.muted || c.disabled) return 0;
  const tr = trackById(v).get(c.trackId); if (!tr || tr.muted) return 0;
  const solo = anySolo(v, ["video", "audio"]); if (solo && !tr.solo) return 0;
  return Math.max(0, valueAt(c, "volume", Math.min(Math.max(t - c.start, 0), clipDuration(c)))) * fadeGain(c, t);
}

export const compoundView = (v: VideoDoc, c: Compound): VideoDoc => ({ fps: v.fps, width: v.width, height: v.height, tracks: c.tracks, clips: c.clips, transitions: c.transitions, ...(v.compounds ? { compounds: v.compounds } : {}) });
export const innerTime = (c: TClip, t: number): number => c.srcStart + (Math.min(Math.max(t, c.start), clipEnd(c)) - c.start) * c.speed;

export interface FlatClip { clip: TClip; gain: (t: number) => number }
export function flatClips(v: VideoDoc, depth = 0): FlatClip[] {
  const out: FlatClip[] = [];
  for (const c of Object.values(v.clips)) {
    if (c.type === "media") { out.push({ clip: c, gain: (t) => clipGain(v, c, t) }); continue; }
    if (c.type !== "compound" || !c.compoundId || depth > 8) continue; const comp = v.compounds?.[c.compoundId]; if (!comp) continue;
    for (const f of flatClips(compoundView(v, comp), depth + 1)) {
      const ic = f.clip, lo = Math.max(ic.start, c.srcStart), hi = Math.min(clipEnd(ic), c.srcEnd); if (hi - lo <= 1e-6) continue;
      out.push({
        clip: { ...ic, id: `${c.id}/${ic.id}`, start: c.start + (lo - c.srcStart) / c.speed, srcStart: ic.srcStart + (lo - ic.start) * ic.speed, srcEnd: ic.srcStart + (hi - ic.start) * ic.speed, speed: ic.speed * c.speed },
        gain: (t) => clipGain(v, c, t) * f.gain(innerTime(c, t)),
      });
    }
  }
  return out;
}
export function liveClipIds(v: VideoDoc, t: number, prefix = "", depth = 0): Set<string> {
  const out = new Set<string>();
  for (const it of evaluateFrame(v, t)) {
    out.add(prefix + it.clipId);
    if (it.compoundId && depth < 8) { const comp = v.compounds?.[it.compoundId]; if (comp) for (const id of liveClipIds(compoundView(v, comp), it.sourceTime, `${prefix}${it.clipId}/`, depth + 1)) out.add(id); }
  }
  return out;
}
export function mediaUseCount(v: VideoDoc, mediaId: string): number {
  return Object.values(v.clips).filter((c) => c.mediaId === mediaId).length + Object.values(v.compounds ?? {}).reduce((n, comp) => n + Object.values(comp.clips).filter((c) => c.mediaId === mediaId).length, 0);
}

export function liveSources(v: VideoDoc, t: number, prefix = "", depth = 0, out: Map<string, { mediaId: string; sourceTime: number }> = new Map()): Map<string, { mediaId: string; sourceTime: number }> {
  for (const it of evaluateFrame(v, t)) {
    if (it.mediaId) out.set(prefix + it.clipId, { mediaId: it.mediaId, sourceTime: it.sourceTime });
    else if (it.compoundId && depth < 8) { const comp = v.compounds?.[it.compoundId]; if (comp) liveSources(compoundView(v, comp), it.sourceTime, `${prefix}${it.clipId}/`, depth + 1, out); }
  }
  return out;
}
