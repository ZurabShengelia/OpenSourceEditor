import { DEFAULT_FILTERS } from "../editor/effects";
import { clipDuration, clipEnd } from "./compose";
import type { Compound, Marker, TClip, Track, Transition, TransitionKind, VideoDoc } from "./schema";

const withClip = (v: VideoDoc, c: TClip): VideoDoc => ({ ...v, clips: { ...v.clips, [c.id]: c } });
const trackOf = (v: VideoDoc, id: string): Track | undefined => v.tracks.find((t) => t.id === id);
export const isLocked = (v: VideoDoc, c: TClip): boolean => c.locked === true || trackOf(v, c.trackId)?.locked === true;
export const MIN_DUR = 0.05;

export function addTrack(v: VideoDoc, kind: Track["kind"]): VideoDoc {
  const n = v.tracks.filter((t) => t.kind === kind).length + 1; const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : "T";
  let id = `${prefix}${n}`; while (v.tracks.some((t) => t.id === id)) id += "x";
  const track: Track = { id, kind, name: `${prefix}${n}`, muted: false, solo: false, locked: false, visible: true };
  const idx = kind === "audio" ? v.tracks.length : Math.max(0, v.tracks.map((t) => t.kind).lastIndexOf(kind) + 1 || v.tracks.length);
  const tracks = [...v.tracks]; tracks.splice(idx, 0, track); return { ...v, tracks };
}
export function removeTrack(v: VideoDoc, id: string): VideoDoc {
  const clips = Object.fromEntries(Object.entries(v.clips).filter(([, c]) => c.trackId !== id));
  return { ...v, tracks: v.tracks.filter((t) => t.id !== id), clips, transitions: v.transitions.filter((t) => t.trackId !== id) };
}
export function patchTrack(v: VideoDoc, id: string, p: Partial<Pick<Track, "name" | "muted" | "solo" | "locked" | "visible" | "collapsed" | "height">>): VideoDoc {
  return { ...v, tracks: v.tracks.map((t) => (t.id === id ? { ...t, ...p } : t)) };
}

export function overlaps(v: VideoDoc, trackId: string, start: number, dur: number, ignore?: string): boolean {
  return Object.values(v.clips).some((c) => c.trackId === trackId && c.id !== ignore && start < clipEnd(c) - 1e-6 && start + dur > c.start + 1e-6);
}

export function moveClip(v: VideoDoc, id: string, start: number, trackId?: string): VideoDoc {
  const c = v.clips[id]; if (!c || isLocked(v, c)) return v;
  const target = trackId ?? c.trackId, tt = trackOf(v, target), ft = trackOf(v, c.trackId);
  if (!tt || !ft || tt.locked || (tt.kind === "audio") !== (ft.kind === "audio")) return v;
  const s = Math.max(0, start); if (overlaps(v, target, s, clipDuration(c), id)) return v;
  if (s === c.start && target === c.trackId) return v;
  return withClip(v, { ...c, start: s, trackId: target });
}

export function trimStart(v: VideoDoc, id: string, t: number): VideoDoc {
  const c = v.clips[id]; if (!c || isLocked(v, c)) return v;
  const lo = c.type === "text" ? -Infinity : c.start - c.srcStart / c.speed;
  const nt = Math.min(Math.max(t, lo, 0), clipEnd(c) - MIN_DUR); const d = nt - c.start; if (d === 0) return v;
  if (overlaps(v, c.trackId, nt, clipEnd(c) - nt, id)) return v;
  return withClip(v, { ...c, start: nt, srcStart: Math.max(0, c.srcStart + d * c.speed), keyframes: shiftKeys(c.keyframes, d) });
}
export function trimEnd(v: VideoDoc, id: string, t: number, sourceDuration?: number): VideoDoc {
  const c = v.clips[id]; if (!c || isLocked(v, c)) return v;
  const maxSrc = c.type === "text" ? Infinity : sourceDuration ?? Infinity;
  const srcEnd = Math.min(maxSrc, Math.max(c.srcStart + MIN_DUR * c.speed, c.srcStart + (t - c.start) * c.speed)); if (srcEnd === c.srcEnd) return v;
  const next = { ...c, srcEnd }; if (overlaps(v, c.trackId, c.start, clipDuration(next), id)) return v;
  return withClip(v, next);
}
function shiftKeys(k: TClip["keyframes"], d: number): TClip["keyframes"] {
  const out: TClip["keyframes"] = {};
  for (const [p, list] of Object.entries(k) as [keyof TClip["keyframes"], NonNullable<TClip["keyframes"][keyof TClip["keyframes"]]>][])
    out[p] = list.map((x) => ({ ...x, t: x.t - d })).filter((x) => x.t >= -1e-9).map((x) => ({ ...x, t: Math.max(0, x.t) }));
  return out;
}

export function splitClip(v: VideoDoc, id: string, t: number, newId: string): VideoDoc {
  const c = v.clips[id]; if (!c || isLocked(v, c) || t <= c.start + MIN_DUR / 2 || t >= clipEnd(c) - MIN_DUR / 2) return v;
  const cut = c.srcStart + (t - c.start) * c.speed, local = t - c.start;
  const left: TClip = { ...c, srcEnd: cut, fadeOut: 0, keyframes: Object.fromEntries(Object.entries(c.keyframes).map(([p, l]) => [p, l.filter((k) => k.t <= local)])) };
  const right: TClip = { ...c, id: newId, start: t, srcStart: cut, fadeIn: 0, keyframes: shiftKeys(c.keyframes, local) };
  const transitions = v.transitions.map((x) => (x.fromClipId === id ? { ...x, fromClipId: newId } : x));
  return { ...v, clips: { ...v.clips, [id]: left, [newId]: right }, transitions };
}

export function duplicateClip(v: VideoDoc, id: string, newId: string): VideoDoc {
  const c = v.clips[id]; if (!c) return v;
  let s = clipEnd(c); const d = clipDuration(c);
  while (overlaps(v, c.trackId, s, d)) s = Math.max(...Object.values(v.clips).filter((o) => o.trackId === c.trackId && s < clipEnd(o) && s + d > o.start).map(clipEnd));
  return withClip(v, { ...c, id: newId, start: s, keyframes: JSON.parse(JSON.stringify(c.keyframes)) as TClip["keyframes"] });
}
export function deleteClips(v: VideoDoc, ids: readonly string[]): VideoDoc { const r = deleteClipsRaw(v, ids); return r === v ? v : pruneCompounds(r); }
function deleteClipsRaw(v: VideoDoc, ids: readonly string[]): VideoDoc {
  const kill = new Set(ids.filter((i) => v.clips[i] && !isLocked(v, v.clips[i]!))); if (!kill.size) return v;
  return { ...v, clips: Object.fromEntries(Object.entries(v.clips).filter(([k]) => !kill.has(k))), transitions: v.transitions.filter((t) => !kill.has(t.fromClipId) && !kill.has(t.toClipId)) };
}
export function patchClip(v: VideoDoc, id: string, p: Partial<Omit<TClip, "id">>): VideoDoc {
  const c = v.clips[id]; return !c || isLocked(v, c) ? v : withClip(v, { ...c, ...p });
}
export function setSpeed(v: VideoDoc, id: string, speed: number): VideoDoc {
  const c = v.clips[id]; if (!c || isLocked(v, c)) return v; const s = Math.min(16, Math.max(0.1, speed));
  const next = { ...c, speed: s }; return overlaps(v, c.trackId, c.start, clipDuration(next), id) ? v : withClip(v, next);
}

export function setTransition(v: VideoDoc, fromId: string, toId: string, kind: TransitionKind, duration: number, dir: Transition["dir"], id: string): VideoDoc {
  const a = v.clips[fromId], b = v.clips[toId]; if (!a || !b || a.trackId !== b.trackId || b.start < a.start) return v;
  const rest = v.transitions.filter((t) => !(t.fromClipId === fromId && t.toClipId === toId));
  const dur = Math.max(0, Math.min(duration, clipDuration(a), clipDuration(b)));
  return { ...v, transitions: [...rest, { id, trackId: a.trackId, fromClipId: fromId, toClipId: toId, kind, duration: dur, dir }] };
}
export const removeTransition = (v: VideoDoc, id: string): VideoDoc => ({ ...v, transitions: v.transitions.filter((t) => t.id !== id) });

export function snap(v: VideoDoc, t: number, playhead: number, radius: number, ignore?: string): { t: number; hit: number | null } {
  const pts = [0, playhead, ...(v.markers ?? []).map((m) => m.t)]; for (const c of Object.values(v.clips)) if (c.id !== ignore) pts.push(c.start, clipEnd(c));
  let best: number | null = null; for (const p of pts) if (Math.abs(p - t) <= radius && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
  return best === null ? { t, hit: null } : { t: best, hit: best };
}

const isVolKey = (p: string): boolean => p === "volume";
const pickKeys = (k: TClip["keyframes"], keepVolume: boolean): TClip["keyframes"] => Object.fromEntries(Object.entries(k).filter(([p]) => isVolKey(p) === keepVolume)) as TClip["keyframes"];
export function canDetach(v: VideoDoc, id: string, sourceHasAudio: boolean): boolean {
  const c = v.clips[id]; const t = c && trackOf(v, c.trackId);
  return !!c && !!t && t.kind === "video" && c.type === "media" && !c.detached && sourceHasAudio && !t.locked;
}
export function detachAudio(v: VideoDoc, id: string, audioClipId: string, audioTrackId: string, linkId: string): VideoDoc {
  const c = v.clips[id]; const at = trackOf(v, audioTrackId);
  if (!c || c.detached || c.type !== "media" || isLocked(v, c) || !at || at.kind !== "audio" || at.locked) return v;
  if (overlaps(v, audioTrackId, c.start, clipDuration(c))) return v;
  const audio: TClip = { ...c, id: audioClipId, trackId: audioTrackId, detached: undefined, linkId, keyframes: pickKeys(c.keyframes, true) };
  const video: TClip = { ...c, detached: true, linkId, fadeIn: 0, fadeOut: 0, keyframes: pickKeys(c.keyframes, false) };
  return { ...v, clips: { ...v.clips, [id]: video, [audioClipId]: audio } };
}
export function linkedVideoFor(v: VideoDoc, audioId: string): TClip | undefined {
  const a = v.clips[audioId]; if (!a || !a.linkId || trackOf(v, a.trackId)?.kind !== "audio") return undefined;
  return Object.values(v.clips).filter((c) => c.detached && c.linkId === a.linkId && c.mediaId === a.mediaId && trackOf(v, c.trackId)?.kind === "video")
    .sort((x, y) => Math.abs(x.start - a.start) - Math.abs(y.start - a.start))[0];
}
export function linkAudio(v: VideoDoc, audioId: string): VideoDoc {
  const a = v.clips[audioId]; const vid = a && linkedVideoFor(v, audioId); if (!a || !vid || isLocked(v, a) || isLocked(v, vid)) return v;
  const merged: TClip = { ...vid, detached: undefined, linkId: undefined, volume: a.volume, balance: a.balance, fadeIn: a.fadeIn, fadeOut: a.fadeOut, keyframes: { ...vid.keyframes, ...pickKeys(a.keyframes, true) } };
  const rest = { ...v.clips }; delete rest[audioId]; rest[vid.id] = merged;
  return { ...v, clips: rest, transitions: v.transitions.filter((t) => t.fromClipId !== audioId && t.toClipId !== audioId) };
}

export type ClipFlag = "muted" | "disabled" | "locked";
export function setClipFlag(v: VideoDoc, ids: readonly string[], flag: ClipFlag, on: boolean): VideoDoc {
  let clips = v.clips; let changed = false;
  for (const id of ids) { const c = clips[id]; if (!c || (!!c[flag]) === on) continue; if (flag !== "locked" && isLocked(v, c)) continue; clips = { ...clips, [id]: { ...c, [flag]: on || undefined } }; changed = true; }
  return changed ? { ...v, clips } : v;
}
export const flagTarget = (v: VideoDoc, ids: readonly string[], flag: ClipFlag): boolean => !ids.every((i) => v.clips[i]?.[flag]);

export const sortedMarkers = (v: VideoDoc): Marker[] => [...(v.markers ?? [])].sort((a, b) => a.t - b.t);
export function addMarker(v: VideoDoc, t: number, id: string, name = ""): VideoDoc {
  const tt = Math.max(0, t); if ((v.markers ?? []).some((m) => Math.abs(m.t - tt) < 1 / (2 * v.fps))) return v;
  return { ...v, markers: [...(v.markers ?? []), { id, t: tt, name: name || `Marker ${(v.markers?.length ?? 0) + 1}` }] };
}
export const renameMarker = (v: VideoDoc, id: string, name: string): VideoDoc => ({ ...v, markers: (v.markers ?? []).map((m) => (m.id === id ? { ...m, name } : m)) });
export const moveMarker = (v: VideoDoc, id: string, t: number): VideoDoc => ({ ...v, markers: (v.markers ?? []).map((m) => (m.id === id ? { ...m, t: Math.max(0, t) } : m)) });
export const removeMarker = (v: VideoDoc, id: string): VideoDoc => ({ ...v, markers: (v.markers ?? []).filter((m) => m.id !== id) });
export function neighbourMarker(v: VideoDoc, t: number, dir: -1 | 1): Marker | undefined {
  const eps = 1 / (2 * v.fps); const ms = sortedMarkers(v); return dir > 0 ? ms.find((m) => m.t > t + eps) : [...ms].reverse().find((m) => m.t < t - eps);
}

export const TRACK_H = { min: 32, max: 140, step: 14 } as const;
export const defaultRow = (k: Track["kind"]): number => (k === "video" ? 58 : k === "text" ? 36 : 52);
export const COLLAPSED_H = 22;
export const rowHeight = (t: Track): number => (t.collapsed ? COLLAPSED_H : Math.min(TRACK_H.max, Math.max(TRACK_H.min, t.height ?? defaultRow(t.kind))));

export interface ClipSnapshot { clips: TClip[]; transitions: Transition[]; kinds: Record<string, Track["kind"]> }
export function copyClips(v: VideoDoc, ids: readonly string[]): ClipSnapshot | null {
  const clips = ids.map((i) => v.clips[i]).filter((c): c is TClip => !!c); if (!clips.length) return null; const set = new Set(clips.map((c) => c.id));
  return { clips: clips.map((c) => ({ ...c })), transitions: v.transitions.filter((t) => set.has(t.fromClipId) && set.has(t.toClipId)).map((t) => ({ ...t })), kinds: Object.fromEntries(clips.map((c) => [c.trackId, trackOf(v, c.trackId)?.kind ?? "video"])) };
}
export function pasteClips(v: VideoDoc, snap: ClipSnapshot, at: number, mk: () => string, target?: string): { video: VideoDoc; ids: string[] } {
  const anchor = Math.min(...snap.clips.map((c) => c.start)); const srcTracks = new Set(snap.clips.map((c) => c.trackId)); const idMap = new Map<string, string>(); const linkMap = new Map<string, string>();
  const linkCount = new Map<string, number>(); for (const c of snap.clips) if (c.linkId) linkCount.set(c.linkId, (linkCount.get(c.linkId) ?? 0) + 1);
  let doc = v; const ids: string[] = [];
  for (const c of [...snap.clips].sort((a, b) => a.start - b.start)) {
    const kind = snap.kinds[c.trackId] ?? "video"; const dur = clipDuration(c); const start = Math.max(0, at + (c.start - anchor));
    const free = (t: Track): boolean => t.kind === kind && !t.locked && !overlaps(doc, t.id, start, dur);
    const tgt = target && srcTracks.size === 1 ? trackOf(doc, target) : undefined;
    let tr = (tgt && free(tgt) ? tgt : undefined) ?? doc.tracks.find((t) => t.id === c.trackId && free(t)) ?? doc.tracks.find(free);
    if (!tr) { doc = addTrack(doc, kind); tr = doc.tracks.filter((t) => t.kind === kind).at(-1)!; }
    const id = mk(); idMap.set(c.id, id); ids.push(id);
    let linkId: string | undefined; if (c.linkId && (linkCount.get(c.linkId) ?? 0) > 1) { linkId = linkMap.get(c.linkId) ?? mk(); linkMap.set(c.linkId, linkId); }
    const { locked: _l, ...rest } = c; void _l;
    const nc: TClip = { ...rest, id, trackId: tr.id, start, linkId, ...(c.locked ? { locked: true } : {}) }; if (!linkId) delete nc.linkId;
    doc = withClip(doc, nc);
  }
  const trs = snap.transitions.flatMap((t) => { const a = idMap.get(t.fromClipId), b = idMap.get(t.toClipId); const ca = a && doc.clips[a], cb = b && doc.clips[b]; return ca && cb && ca.trackId === cb.trackId ? [{ ...t, id: mk(), fromClipId: a, toClipId: b, trackId: ca.trackId }] : []; });
  return { video: trs.length ? { ...doc, transitions: [...doc.transitions, ...trs] } : doc, ids };
}

export function pruneCompounds(v: VideoDoc): VideoDoc {
  if (!v.compounds) return v; const keep = new Set<string>(); const visit = (clips: Record<string, TClip>): void => { for (const c of Object.values(clips)) if (c.compoundId && !keep.has(c.compoundId)) { keep.add(c.compoundId); const k = v.compounds?.[c.compoundId]; if (k) visit(k.clips); } };
  visit(v.clips); const ids = Object.keys(v.compounds); if (ids.every((i) => keep.has(i))) return v;
  const rest = Object.fromEntries(ids.filter((i) => keep.has(i)).map((i) => [i, v.compounds![i]!])); const { compounds: _c, ...nov } = v; void _c; return Object.keys(rest).length ? { ...nov, compounds: rest } : nov;
}
export function canCompound(v: VideoDoc, ids: readonly string[]): boolean { return ids.length > 0 && ids.every((i) => { const c = v.clips[i]; return !!c && !isLocked(v, c); }); }
export function createCompound(v: VideoDoc, ids: readonly string[], compId: string, clipId: string): VideoDoc {
  if (!canCompound(v, ids)) return v; const sel = ids.map((i) => v.clips[i]!); const set = new Set(ids);
  const start = Math.min(...sel.map((c) => c.start)), end = Math.max(...sel.map(clipEnd)); const srcTracks = v.tracks.filter((t) => sel.some((c) => c.trackId === t.id));
  const inner: Record<string, TClip> = Object.fromEntries(sel.map((c) => [c.id, { ...c, start: c.start - start, locked: undefined } as TClip])); for (const c of Object.values(inner)) if (c.locked === undefined) delete c.locked;
  const comp: Compound = { id: compId, name: `Compound ${Object.keys(v.compounds ?? {}).length + 1}`, length: end - start, tracks: srcTracks.map((t) => ({ ...t, muted: false, solo: false, locked: false })), clips: inner,
    transitions: v.transitions.filter((t) => set.has(t.fromClipId) && set.has(t.toClipId)) };
  const clips = Object.fromEntries(Object.entries(v.clips).filter(([i]) => !set.has(i))); const outerTrs = v.transitions.filter((t) => !set.has(t.fromClipId) && !set.has(t.toClipId));
  let doc: VideoDoc = { ...v, clips, transitions: outerTrs, compounds: { ...(v.compounds ?? {}), [compId]: comp } };
  const kind: Track["kind"] = srcTracks.some((t) => t.kind !== "audio") ? (srcTracks.some((t) => t.kind === "video") ? "video" : "text") : "audio";
  const preferred = srcTracks.find((t) => t.kind === kind); const free = (t: Track): boolean => t.kind === kind && !t.locked && !overlaps(doc, t.id, start, end - start);
  let tr = (preferred && free(preferred) ? preferred : undefined) ?? doc.tracks.find(free); if (!tr) { doc = addTrack(doc, kind); tr = doc.tracks.filter((t) => t.kind === kind).at(-1)!; }
  const cc: TClip = { id: clipId, trackId: tr.id, type: "compound", compoundId: compId, start, srcStart: 0, srcEnd: end - start, speed: 1, volume: 1, balance: 0, fadeIn: 0, fadeOut: 0,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, crop: { l: 0, t: 0, r: 0, b: 0 }, filters: { ...DEFAULT_FILTERS }, keyframes: {} };
  return withClip(doc, cc);
}
export function breakApart(v: VideoDoc, clipId: string, mk: () => string): { video: VideoDoc; ids: string[] } | null {
  const c = v.clips[clipId]; const comp = c?.type === "compound" && c.compoundId ? v.compounds?.[c.compoundId] : undefined; if (!c || !comp || isLocked(v, c)) return null;
  const mapped: TClip[] = []; const idMap = new Map<string, string>();
  for (const ic of Object.values(comp.clips)) { const lo = Math.max(ic.start, c.srcStart), hi = Math.min(clipEnd(ic), c.srcEnd); if (hi - lo <= 1e-6) continue;
    mapped.push({ ...ic, start: c.start + (lo - c.srcStart) / c.speed, srcStart: ic.srcStart + (lo - ic.start) * ic.speed, srcEnd: ic.srcStart + (hi - ic.start) * ic.speed, speed: ic.speed * c.speed }); }
  if (!mapped.length) return null; const keep = new Set(mapped.map((m) => m.id));
  const rest = { ...v.clips }; delete rest[clipId]; const base = pruneCompounds({ ...v, clips: rest, transitions: v.transitions.filter((t) => t.fromClipId !== clipId && t.toClipId !== clipId) });
  const snap: ClipSnapshot = { clips: mapped, transitions: comp.transitions.filter((t) => keep.has(t.fromClipId) && keep.has(t.toClipId)), kinds: Object.fromEntries(comp.tracks.map((t) => [t.id, t.kind])) };
  void idMap; return pasteClips(base, snap, Math.min(...mapped.map((m) => m.start)), mk);
}
export function dropMedia(v: VideoDoc, mediaId: string): VideoDoc {
  const strip = (clips: Record<string, TClip>, trs: Transition[]): { clips: Record<string, TClip>; transitions: Transition[] } => { const kept = Object.fromEntries(Object.entries(clips).filter(([, c]) => c.mediaId !== mediaId)); return { clips: kept, transitions: trs.filter((t) => kept[t.fromClipId] && kept[t.toClipId]) }; };
  const top = strip(v.clips, v.transitions); let compounds = v.compounds; if (compounds) compounds = Object.fromEntries(Object.entries(compounds).map(([k, comp]) => [k, { ...comp, ...strip(comp.clips, comp.transitions) }]));
  const empty = new Set(Object.values(compounds ?? {}).filter((c) => !Object.keys(c.clips).length).map((c) => c.id)); let clips = top.clips; let transitions = top.transitions;
  if (empty.size) { clips = Object.fromEntries(Object.entries(clips).filter(([, c]) => !(c.compoundId && empty.has(c.compoundId)))); transitions = transitions.filter((t) => clips[t.fromClipId] && clips[t.toClipId]); }
  const nv: VideoDoc = { ...v, clips, transitions, ...(compounds ? { compounds } : {}) }; return pruneCompounds(nv);
}
