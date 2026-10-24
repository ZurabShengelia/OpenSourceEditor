import * as SEL from "./selection";
import { clipDuration, clipEnd, docDuration } from "../doc/compose";
import { ANIM_PRESETS, applyPreset, setKeyframe, deleteKeyframe as delKf, evalKeyframes, valueAt, type AnimPreset } from "../doc/keyframes";
import * as L from "../doc/layerOps";
import { emptyTrack, group } from "../doc/migrate";
import type { AdjustKind, AnimProp, Keyframe, LayerNode, MediaRef, PaintLayer, ProjectV2, TClip, TextProps, Transition, TransitionKind } from "../doc/schema";
import * as V from "../doc/videoOps";
import { DEFAULT_FILTERS } from "../editor/effects";
import { renderPhoto } from "../render/compositor";
import { askConfirm, askText } from "./dialogs";
import { player } from "./engine";
import { clipBox } from "./geometry";
import { nodeBox } from "./photoGeo";
import { bitmaps, bumpRev, cloneBitmap, dropRuntime, ingest, kindOf, newBitmap, runtime, uid } from "./media";
import { floodFill, hexToRgba, rgbaToHex, stamp, stampPoints } from "./paint";
import { alignDelta, rectOf, type AlignEdge } from "./snap";
import { edit, gesture, getDoc, getUi, setUi, transport } from "./store";

const say = (m: string): void => setUi({ status: m });
export const defaultText = (text = "Your text"): TextProps => ({ text, font: "Inter, system-ui, sans-serif", size: 64, weight: 700, italic: false, align: "center", color: "#ffffff", outline: 0, outlineColor: "#000000", shadow: 0 });
const baseNode = (name: string) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, blend: "source-over" as const, x: 0, y: 0, scale: 1, rotation: 0 });

export async function importFiles(files: File[]): Promise<void> {
  const mode = getUi().mode; const errors: string[] = [];
  for (const f of files) {
    try {
      const ref = await ingest(f, f.name); const doc0 = getDoc(); const firstVisual = !Object.keys(doc0.video.clips).length && ref.width && ref.height && ref.kind === "video";
      edit((d) => ({ ...d, media: { ...d.media, [ref.id]: ref }, video: firstVisual ? { ...d.video, width: even(ref.width!), height: even(ref.height!) } : d.video }));
      if (mode === "video" && ref.kind !== "bitmap") addClipFromMedia(ref.id); else if (mode === "photo" && ref.kind === "image") addImageLayer(ref.id);
      else if (mode === "photo" && ref.kind !== "image") say(`"${f.name}" was added to the media bin (photo mode places images only)`);
    } catch (e) { errors.push(e instanceof Error ? e.message : `Could not import ${f.name}`); }
  }
  if (errors.length) throw new Error(errors.join(" · "));
}
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
export function removeMedia(id: string): void {
  edit((d) => {
    const video = V.dropMedia(d.video, id);
    const prune = (g: import("../doc/schema").GroupNode): import("../doc/schema").GroupNode => ({ ...g, children: g.children.filter((n) => !(n.kind === "image" && n.mediaId === id)).map((n) => (n.kind === "group" ? prune(n) : n)) });
    const { [id]: _m, ...media } = d.media; void _m;
    return { ...d, media, video, photo: { ...d.photo, root: prune(d.photo.root) } };
  });
  setUi((u) => ({ selClips: u.selClips.filter((c) => getDoc().video.clips[c]) })); dropRuntime(id); player.refresh();
}

export function makeClip(over: Partial<TClip> & Pick<TClip, "id" | "trackId" | "type">): TClip {
  return { start: 0, srcStart: 0, srcEnd: 1, speed: 1, volume: 1, balance: 0, fadeIn: 0, fadeOut: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, crop: { l: 0, t: 0, r: 0, b: 0 }, filters: { ...DEFAULT_FILTERS }, keyframes: {}, ...over };
}
const trackEnd = (d: ProjectV2, trackId: string): number => Math.max(0, ...Object.values(d.video.clips).filter((c) => c.trackId === trackId).map(clipEnd));
export function addClipFromMedia(mediaId: string, trackId?: string, start?: number): string | null {
  const d = getDoc(); const m = d.media[mediaId]; if (!m || m.kind === "bitmap") return null;
  const want = m.kind === "audio" ? "audio" : "video"; let tid = trackId;
  const id = uid(); let nextDoc: ProjectV2 = d;
  if (!tid || d.video.tracks.find((t) => t.id === tid)?.kind !== want) { const found = d.video.tracks.find((t) => t.kind === want && !t.locked); if (found) tid = found.id; else { nextDoc = { ...d, video: V.addTrack(d.video, want) }; tid = nextDoc.video.tracks.find((t) => t.kind === want)!.id; } }
  const dur = m.kind === "image" ? 5 : m.duration && Number.isFinite(m.duration) ? m.duration : 5; let s = start ?? trackEnd(nextDoc, tid);
  if (V.overlaps(nextDoc.video, tid, s, dur)) s = trackEnd(nextDoc, tid);
  const clip = makeClip({ id, trackId: tid, type: "media", mediaId, start: s, srcEnd: dur });
  edit(() => ({ ...nextDoc, video: { ...nextDoc.video, clips: { ...nextDoc.video.clips, [id]: clip } } }));
  setUi({ selClips: [id], selLayers: [], selTransition: null }); player.refresh(); return id;
}
export function addTrack(kind: "video" | "audio" | "text"): void { edit((d) => ({ ...d, video: V.addTrack(d.video, kind) })); }
export function removeTrack(id: string): void {
  const d = getDoc(); if (d.video.tracks.length <= 1) return say("A project needs at least one track");
  const n = Object.values(d.video.clips).filter((c) => c.trackId === id).length; const name = d.video.tracks.find((t) => t.id === id)?.name ?? "track";
  const go = (): void => { edit((x) => ({ ...x, video: V.removeTrack(x.video, id) })); setUi({ selClips: [] }); player.refresh(); };
  if (!n) return go(); void askConfirm(`Delete track ${name}?`, `This deletes track ${name} and its ${n} clip${n > 1 ? "s" : ""}. You can undo it.`, { ok: "Delete track", danger: true }).then((ok) => { if (ok) go(); });
}
export function patchTrack(id: string, p: Parameters<typeof V.patchTrack>[2]): void { edit((d) => ({ ...d, video: V.patchTrack(d.video, id, p) })); player.refresh(); }
export function addTextClip(): void {
  const d = getDoc(); let tid = d.video.tracks.find((t) => t.kind === "text" && !t.locked)?.id; let doc = d;
  if (!tid) { doc = { ...d, video: V.addTrack(d.video, "text") }; tid = doc.video.tracks.find((t) => t.kind === "text")!.id; }
  let s = transport.t; if (V.overlaps(doc.video, tid, s, 3)) s = trackEnd(doc, tid); const id = uid();
  edit(() => ({ ...doc, video: { ...doc.video, clips: { ...doc.video.clips, [id]: makeClip({ id, trackId: tid!, type: "text", start: s, srcEnd: 3, text: defaultText() }) } } }));
  setUi({ selClips: [id], selLayers: [], inspectorTab: "" }); player.refresh();
}
export const patchClip = (id: string, p: Partial<Omit<TClip, "id">>): void => { edit((d) => ({ ...d, video: V.patchClip(d.video, id, p) })); player.refresh(); };
export const patchClips = (ids: string[], p: Partial<Omit<TClip, "id">>): void => { edit((d) => ids.reduce((acc, id) => ({ ...acc, video: V.patchClip(acc.video, id, p) }), d)); player.refresh(); };
export const patchText = (id: string, p: Partial<TextProps>): void => { const c = getDoc().video.clips[id]; if (c?.text) patchClip(id, { text: { ...c.text, ...p } }); };
export const setSpeed = (id: string, v: number): void => { edit((d) => ({ ...d, video: V.setSpeed(d.video, id, v) })); player.refresh(); };
export function moveClip(id: string, start: number, trackId?: string): void { edit((d) => ({ ...d, video: V.moveClip(d.video, id, start, trackId) })); player.refresh(); }
export function trimClip(id: string, side: "l" | "r", t: number): void {
  edit((d) => { const c = d.video.clips[id]; const src = c?.mediaId ? d.media[c.mediaId]?.duration : undefined; return { ...d, video: side === "l" ? V.trimStart(d.video, id, t) : V.trimEnd(d.video, id, t, src) }; }); player.refresh();
}
export function splitAtPlayhead(): void {
  const t = transport.t, d = getDoc(), sel = getUi().selClips;
  const targets = (sel.length ? sel : Object.keys(d.video.clips)).filter((id) => { const c = d.video.clips[id]; return c && t > c.start + 0.01 && t < clipEnd(c) - 0.01 && !V.isLocked(d.video, c); });
  if (!targets.length) return say("Move the playhead over a clip to split it");
  const fresh: string[] = []; edit((x) => ({ ...x, video: targets.reduce((v, id) => { const n = uid(); fresh.push(n); return V.splitClip(v, id, t, n); }, x.video) }));
  setUi({ selClips: fresh }); player.refresh();
}
export function detachAudio(ids: string[] = getUi().selClips): void {
  let done = 0;
  edit((d) => {
    let v = d.video;
    for (const id of ids) {
      const c = v.clips[id]; const has = c?.mediaId ? d.media[c.mediaId]?.hasAudio === true : false;
      if (!c || !V.canDetach(v, id, has || !!(c.mediaId && runtime.get(c.mediaId)?.peaks))) continue;
      const dur = clipDuration(c); let tid = v.tracks.find((t) => t.kind === "audio" && !t.locked && !V.overlaps(v, t.id, c.start, dur))?.id;
      if (!tid) { v = V.addTrack(v, "audio"); tid = v.tracks.filter((t) => t.kind === "audio").at(-1)!.id; }
      const next = V.detachAudio(v, id, uid(), tid, uid()); if (next !== v) { v = next; done++; }
    }
    return v === d.video ? d : { ...d, video: v };
  });
  player.refresh();
  say(done ? `Audio detached from ${done} clip${done > 1 ? "s" : ""}` : "Nothing to detach: select a video clip that has sound and is not locked");
}
export function linkAudio(ids: string[] = getUi().selClips): void {
  let n = 0;
  edit((d) => ({ ...d, video: ids.reduce((v, id) => { const next = V.linkAudio(v, id); if (next !== v) n++; return next; }, d.video) }));
  setUi({ selClips: getUi().selClips.filter((id) => !!getDoc().video.clips[id]) }); player.refresh();
  say(n ? "Audio linked to its video clip" : "No matching video clip to link to");
}
export const canLinkAudio = (id: string): boolean => !!V.linkedVideoFor(getDoc().video, id);
export const canDetachAudio = (id: string): boolean => { const d = getDoc(); const c = d.video.clips[id]; return !!c && !!c.mediaId && V.canDetach(d.video, id, d.media[c.mediaId]?.hasAudio === true || !!runtime.get(c.mediaId)?.peaks); };
let clipBoard: V.ClipSnapshot | null = null;
export const hasClipClipboard = (): boolean => clipBoard !== null;
export function copyClips(ids: string[] = getUi().selClips): void {
  const snap = V.copyClips(getDoc().video, ids); if (!snap) return say("Select a clip to copy");
  clipBoard = snap; say(`Copied ${snap.clips.length} clip${snap.clips.length > 1 ? "s" : ""}`);
}
export function cutClips(ids: string[] = getUi().selClips): void {
  const d = getDoc(); const cuttable = ids.filter((i) => d.video.clips[i] && !V.isLocked(d.video, d.video.clips[i]!)); if (!cuttable.length) return say(ids.length ? "Locked clips cannot be cut" : "Select a clip to cut");
  clipBoard = V.copyClips(d.video, cuttable); edit((x) => ({ ...x, video: V.deleteClips(x.video, cuttable) })); setUi({ selClips: [] }); player.refresh(); say(`Cut ${cuttable.length} clip${cuttable.length > 1 ? "s" : ""}`);
}
export function pasteClips(at: number = transport.t, track?: string): void {
  if (!clipBoard) return say("Nothing to paste: copy or cut a clip first");
  let ids: string[] = []; edit((d) => { const r = V.pasteClips(d.video, clipBoard!, at, uid, track); ids = r.ids; return { ...d, video: r.video }; }); setUi({ selClips: ids, selTransition: null }); player.refresh();
  say(`Pasted ${ids.length} clip${ids.length > 1 ? "s" : ""}`);
}
export function toggleClipFlag(flag: V.ClipFlag, ids: string[] = getUi().selClips): void {
  if (!ids.length) return say("Select a clip first"); const on = V.flagTarget(getDoc().video, ids, flag);
  edit((d) => ({ ...d, video: V.setClipFlag(d.video, ids, flag, on) })); player.refresh();
  say(`${flag === "muted" ? (on ? "Muted" : "Unmuted") : flag === "disabled" ? (on ? "Disabled" : "Enabled") : on ? "Locked" : "Unlocked"} ${ids.length} clip${ids.length > 1 ? "s" : ""}`);
}
export function addMarkerAt(t: number = transport.t): void {
  const fps = getDoc().video.fps; const tt = Math.round(t * fps) / fps; const before = getDoc().video.markers?.length ?? 0;
  edit((d) => ({ ...d, video: V.addMarker(d.video, tt, uid()) })); say((getDoc().video.markers?.length ?? 0) > before ? "Marker added" : "A marker already exists at this frame");
}
export async function renameMarker(id: string): Promise<void> {
  const m = getDoc().video.markers?.find((x) => x.id === id); if (!m) return; const n = await askText("Rename marker", m.name, { ok: "Rename" });
  if (n !== null && n.trim()) edit((d) => ({ ...d, video: V.renameMarker(d.video, id, n.trim().slice(0, 40)) }));
}
export const removeMarker = (id: string): void => edit((d) => ({ ...d, video: V.removeMarker(d.video, id) }));
export function moveMarkerTo(id: string, t: number): void { const fps = getDoc().video.fps; gesture.update((d) => ({ ...d, video: V.moveMarker(d.video, id, Math.round(t * fps) / fps) })); }
export function jumpToMarker(dir: -1 | 1): void { const m = V.neighbourMarker(getDoc().video, transport.t, dir); if (m) player.seek(m.t); else say(dir > 0 ? "No later marker" : "No earlier marker"); }
export function resizeTrack(id: string, dir: 1 | -1 | 0): void {
  const t = getDoc().video.tracks.find((k) => k.id === id); if (!t) return;
  patchTrack(id, dir === 0 ? { height: undefined, collapsed: false } : { collapsed: false, height: Math.min(V.TRACK_H.max, Math.max(V.TRACK_H.min, V.rowHeight(t) + dir * V.TRACK_H.step)) });
}
export const toggleCollapse = (id: string): void => { const t = getDoc().video.tracks.find((k) => k.id === id); if (t) patchTrack(id, { collapsed: !t.collapsed }); };
export async function renameTrack(id: string): Promise<void> {
  const t = getDoc().video.tracks.find((k) => k.id === id); if (!t) return; const n = await askText("Rename track", t.name, { ok: "Rename" }); if (n !== null && n.trim()) patchTrack(id, { name: n.trim().slice(0, 12) });
}
export function createCompoundClip(ids: string[] = getUi().selClips): void {
  const v0 = getDoc().video; if (!V.canCompound(v0, ids)) return say(ids.length ? "Locked clips cannot be wrapped in a compound clip" : "Select one or more clips first");
  const id = uid(); edit((d) => ({ ...d, video: V.createCompound(d.video, ids, uid(), id) })); setUi({ selClips: [id], selTransition: null }); player.refresh(); say("Compound clip created. Right-click it and choose Break apart to edit its contents");
}
export function breakApartCompound(id: string): void {
  let ids: string[] = []; const r = V.breakApart(getDoc().video, id, uid); if (!r) return say("This compound clip cannot be broken apart (locked or empty)");
  ids = r.ids; edit((d) => { const rr = V.breakApart(d.video, id, uid); if (rr) ids = rr.ids; return rr ? { ...d, video: rr.video } : d; }); setUi({ selClips: ids, selTransition: null }); player.refresh(); say(`Compound broken apart into ${ids.length} clip${ids.length > 1 ? "s" : ""}`);
}
export function duplicateClips(ids: string[]): void { const fresh: string[] = []; edit((d) => ({ ...d, video: ids.reduce((v, id) => { const n = uid(); fresh.push(n); return V.duplicateClip(v, id, n); }, d.video) })); setUi({ selClips: fresh }); player.refresh(); }
export function deleteSelection(): void {
  const u = getUi();
  if (u.mode === "video") { if (u.selTransition) { edit((d) => ({ ...d, video: V.removeTransition(d.video, u.selTransition!) })); setUi({ selTransition: null }); } else if (u.selClips.length) { edit((d) => ({ ...d, video: V.deleteClips(d.video, u.selClips) })); setUi({ selClips: [] }); } player.refresh(); }
  else if (u.selLayers.length) { edit((d) => ({ ...d, photo: { ...d.photo, root: u.selLayers.reduce((r, id) => (L.find(r, id)?.node.locked ? r : L.removeNode(r, id)), d.photo.root) } })); setUi({ selLayers: [], maskEdit: false }); }
}
export function nudge(dx: number, dy: number, fine: boolean, coarse = false): void {
  const u = getUi(), d = getDoc(), k = fine ? 0.1 : coarse ? 10 : 1;
  gesture.begin();
  if (u.mode === "video") { if (dy === 0) { for (const id of u.selClips) moveClip(id, (getDoc().video.clips[id]?.start ?? 0) + (dx * k) / d.video.fps); } else for (const id of u.selClips) { const c = getDoc().video.clips[id]; if (c) setAnimated(id, "y", valueAt(c, "y", localTime(id)) + (dy * k) / d.video.height); } }
  else for (const id of u.selLayers) patchNode(id, (n) => ({ x: n.x + dx * k, y: n.y + dy * k }));
  gesture.end();
}
const localTime = (id: string): number => { const c = getDoc().video.clips[id]; return c ? Math.min(Math.max(transport.t - c.start, 0), clipDuration(c)) : 0; };

export function setAnimated(id: string, prop: AnimProp, value: number): void {
  edit((d) => {
    const c = d.video.clips[id]; if (!c || V.isLocked(d.video, c)) return d;
    if (c.keyframes[prop]?.length) {
      const t = localTime(id), cur = (c.keyframes[prop] ?? []).find((k) => Math.abs(k.t - t) < 1e-3);
      return { ...d, video: V.patchClip(d.video, id, { keyframes: setKeyframe(c.keyframes, prop, { id: cur?.id ?? uid(), t, v: value, ease: cur?.ease ?? "linear" }) }) };
    }
    return { ...d, video: V.patchClip(d.video, id, prop === "volume" ? { volume: value } : { transform: { ...c.transform, [prop]: value } }) };
  });
  player.refresh();
}
export function toggleKeyframe(id: string, prop: AnimProp): void {
  const c = getDoc().video.clips[id]; if (!c) return; const t = localTime(id), ex = (c.keyframes[prop] ?? []).find((k) => Math.abs(k.t - t) < 0.5 / getDoc().video.fps);
  edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: ex ? delKf(c.keyframes, prop, ex.id) : setKeyframe(c.keyframes, prop, { id: uid(), t, v: valueAt(c, prop, t), ease: "linear" }) }) })); player.refresh();
}
export function removeKeyframe(id: string, prop: AnimProp, kid: string): void { const c = getDoc().video.clips[id]; if (c) { edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: delKf(c.keyframes, prop, kid) }) })); player.refresh(); } }
export function moveKeyframeTo(id: string, prop: AnimProp, kid: string, t: number): void {
  const c = getDoc().video.clips[id]; if (!c) return; const list = c.keyframes[prop] ?? [], k = list.find((x) => x.id === kid); if (!k) return;
  const moved = setKeyframe(delKf(c.keyframes, prop, kid), prop, { ...k, t: Math.min(clipDuration(c), Math.max(0, t)) }); edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: moved }) })); player.refresh();
}
export function setKeyframeEase(id: string, prop: AnimProp, kid: string, ease: Keyframe["ease"]): void { const c = getDoc().video.clips[id]; if (!c) return; edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: { ...c.keyframes, [prop]: (c.keyframes[prop] ?? []).map((k) => (k.id === kid ? { ...k, ease } : k)) } }) })); player.refresh(); }
export const keyframeAt = (c: TClip, prop: AnimProp, t: number, fps: number): Keyframe | undefined => (c.keyframes[prop] ?? []).find((k) => Math.abs(k.t - t) < 0.5 / fps);
export { evalKeyframes };

export function addTransition(fromId: string, kind: TransitionKind, duration = 1, dir: Transition["dir"] = "l"): void {
  const d = getDoc(), a = d.video.clips[fromId]; if (!a) return;
  const next = Object.values(d.video.clips).filter((c) => c.trackId === a.trackId && c.start >= a.start && c.id !== a.id).sort((x, y) => x.start - y.start)[0];
  if (!next) return say("Add a second clip after this one on the same track to place a transition");
  const id = uid(); edit((x) => ({ ...x, video: V.setTransition(x.video, a.id, next.id, kind, duration, dir, id) })); setUi({ selTransition: id, selClips: [] }); player.refresh();
}
export function patchTransition(id: string, p: Partial<Transition>): void { edit((d) => ({ ...d, video: { ...d.video, transitions: d.video.transitions.map((t) => (t.id === id ? { ...t, ...p } : t)) } })); player.refresh(); }

export const patchNode = (id: string, p: Partial<LayerNode> | ((n: LayerNode) => Partial<LayerNode>)): void =>
  edit((d) => { const f = L.find(d.photo.root, id); if (!f || (f.node.locked && !(typeof p !== "function" && "locked" in p))) return d; const patch = typeof p === "function" ? p(f.node) : p; return { ...d, photo: { ...d.photo, root: L.patchNode(d.photo.root, id, patch) } }; });
function insertPoint(d: ProjectV2): { parent: string; index?: number } { const id = getUi().selLayers[0]; const f = id ? L.find(d.photo.root, id) : null; return f ? { parent: f.parent.id, index: f.index + 1 } : { parent: d.photo.root.id }; }
function addNode(n: LayerNode): void { edit((d) => { const at = insertPoint(d); return { ...d, photo: { ...d.photo, root: L.addNode(d.photo.root, n, at.parent, at.index) } }; }); setUi({ selLayers: [n.id], maskEdit: false }); }
export function addImageLayer(mediaId: string): void {
  const m = getDoc().media[mediaId]; if (!m?.width || !m.height) return; const empty = !L.flatten(getDoc().photo.root).length;
  if (empty) edit((d) => ({ ...d, photo: { ...d.photo, width: m.width!, height: m.height! } }));
  const P = getDoc().photo, fit = Math.min(1, P.width / m.width, P.height / m.height); addNode({ ...baseNode(m.name.replace(/\.[^.]+$/, "")), kind: "image", mediaId, filters: { ...DEFAULT_FILTERS }, scale: fit });
}
export function addTextLayer(x = 0, y = 0): void { const P = getDoc().photo; addNode({ ...baseNode("Text"), x, y, kind: "text", props: { ...defaultText(), size: Math.round(P.height / 8) }, filters: { ...DEFAULT_FILTERS } }); }
export function addShapeLayer(shape: "rect" | "ellipse" | "line", x = 0, y = 0, w = 200, h = 140): void {
  addNode({ ...baseNode(shape === "rect" ? "Rectangle" : shape === "ellipse" ? "Ellipse" : "Line"), x, y, kind: "shape", shape, w, h, fill: getUi().brush.color, stroke: "#000000", strokeWidth: shape === "line" ? 6 : 0 });
}
export function addAdjustment(kind: AdjustKind = "brightness"): void { addNode({ ...baseNode("Adjustment"), kind: "adjustment", adjust: kind === "brightness" ? { brightness: 110 } : { [kind]: kind === "contrast" || kind === "saturation" ? 120 : kind === "exposure" ? 0.5 : kind === "grayscale" ? 100 : 20 } }); }
export function addPaintLayer(fill?: string): string { const P = getDoc().photo; const { id: bid } = newBitmap(P.width, P.height, fill); const n: PaintLayer = { ...baseNode("Paint"), kind: "paint", bitmapId: bid, filters: { ...DEFAULT_FILTERS } }; addNode(n); return n.id; }
export function addGroup(): void { const ids = getUi().selLayers; const gid = uid(); edit((d) => ({ ...d, photo: { ...d.photo, root: ids.length ? L.groupNodes(d.photo.root, ids, gid) : L.addNode(d.photo.root, group(gid, "Group", [])) } })); setUi({ selLayers: [gid] }); }
export function ungroupLayer(id: string): void { edit((d) => ({ ...d, photo: { ...d.photo, root: L.ungroup(d.photo.root, id) } })); setUi({ selLayers: [] }); }
export function duplicateLayer(id: string): void { edit((d) => ({ ...d, photo: { ...d.photo, root: L.duplicate(d.photo.root, id, uid) } })); }
export const reorderLayer = (id: string, delta: number): void => edit((d) => ({ ...d, photo: { ...d.photo, root: L.reorder(d.photo.root, id, delta) } }));
export const moveLayerTo = (id: string, parent: string, index?: number): void => edit((d) => ({ ...d, photo: { ...d.photo, root: L.moveTo(d.photo.root, id, parent, index) } }));
export const selectLayer = (id: string | null, additive = false): void => setUi((u) => ({ selLayers: id ? (additive ? (u.selLayers.includes(id) ? u.selLayers.filter((x) => x !== id) : [...u.selLayers, id]) : [id]) : [], maskEdit: false, selClips: [] }));
export const setCanvasSize = (w: number, h: number): void => edit((d) => ({ ...d, photo: { ...d.photo, width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) } }));
export const setVideoSize = (w: number, h: number, fps?: number): void => { edit((d) => ({ ...d, video: { ...d.video, width: even(w), height: even(h), fps: fps ?? d.video.fps } })); player.refresh(); };

export function createMask(layerId: string, how: "reveal" | "hide" | "selection"): void {
  const d = getDoc(), f = L.find(d.photo.root, layerId); if (!f || f.node.mask) return; const P = d.photo, sel = getUi().selection;
  const { id, canvas } = newBitmap(P.width, P.height); const x = canvas.getContext("2d")!; x.fillStyle = "#fff";
  if (how === "reveal") x.fillRect(0, 0, P.width, P.height); else if (how === "selection") { if (!sel) return say("Make a selection first"); selPath(x, sel); x.fill(); }
  patchNode(layerId, { mask: { bitmapId: id, enabled: true, inverted: false, density: 1 } }); setUi({ maskEdit: true }); bumpRev();
}
export const patchMask = (layerId: string, p: Partial<NonNullable<LayerNode["mask"]>>): void => patchNode(layerId, (n) => (n.mask ? { mask: { ...n.mask, ...p } } : {}));
export const deleteMask = (layerId: string): void => { patchNode(layerId, { mask: undefined }); setUi({ maskEdit: false }); };

export function selPath(x: CanvasRenderingContext2D, s: NonNullable<ReturnType<typeof getUi>["selection"]>): void {
  x.beginPath();
  if (s.kind === "mask") { const r = s.rects ?? []; for (let i = 0; i < r.length; i += 4) x.rect(r[i]!, r[i + 1]!, r[i + 2]!, r[i + 3]!); return; }
  if (s.kind === "rect") x.rect(s.x, s.y, s.w, s.h); else x.ellipse(s.x + s.w / 2, s.y + s.h / 2, s.w / 2, s.h / 2, 0, 0, Math.PI * 2);
}
export const selectAll = (): void => setUi({ selection: { kind: "rect", x: 0, y: 0, w: getDoc().photo.width, h: getDoc().photo.height } });
export const deselect = (): void => setUi({ selection: null });
export function selectionMask(): Uint8Array | null {
  const sel = getUi().selection, P = getDoc().photo; if (!sel) return null;
  return sel.kind === "mask" && sel.mask ? sel.mask : SEL.shapeMask(sel.kind === "mask" ? "rect" : sel.kind, sel.x, sel.y, sel.w, sel.h, P.width, P.height);
}
export function setSelectionMask(m: Uint8Array | null): void {
  const P = getDoc().photo, d = m && SEL.describe(m, P.width, P.height);
  setUi({ selection: d ? { kind: "mask", x: d.x, y: d.y, w: d.bw, h: d.bh, mask: m!, rects: SEL.maskToRects(m!, P.width, P.height) } : null });
}
export function invertSelection(): void { const P = getDoc().photo, m = selectionMask(); if (!m) return selectAll(); const inv = SEL.invert(m); if (!SEL.describe(inv, P.width, P.height)) { deselect(); return; } setSelectionMask(inv); }
export function wandSelect(x: number, y: number, mode: SEL.CombineMode): void {
  const u = getUi(), P = getDoc().photo, c = document.createElement("canvas"); c.width = P.width; c.height = P.height; const cx = c.getContext("2d", { willReadFrequently: true })!;
  const only = !u.wand.sampleAll && u.selLayers[0] ? P.root.children.find((n) => n.id === u.selLayers[0]) : undefined;
  renderPhoto(cx, only ? { ...P, root: { ...P.root, children: [{ ...only, visible: true }] } } : P, player.resolver, null);
  const img = cx.getImageData(0, 0, P.width, P.height), m = SEL.magicWand(img.data, P.width, P.height, x, y, u.wand.tolerance, u.wand.contiguous);
  const merged = SEL.combine(mode === "replace" ? null : selectionMask(), m, mode);
  if (!SEL.describe(merged, P.width, P.height)) { deselect(); say("Nothing selected"); return; }
  setSelectionMask(merged);
}

function paintTarget(): { layerId: string; kind: "mask" | "paint"; bitmapId: string } {
  const u = getUi(), d = getDoc(), f = u.selLayers[0] ? L.find(d.photo.root, u.selLayers[0]) : null;
  if (f && u.maskEdit && f.node.mask) return { layerId: f.node.id, kind: "mask", bitmapId: f.node.mask.bitmapId };
  if (f && f.node.kind === "paint" && !f.node.locked) return { layerId: f.node.id, kind: "paint", bitmapId: f.node.bitmapId };
  const id = addPaintLayer(); const n = L.find(getDoc().photo.root, id)!.node as PaintLayer; return { layerId: id, kind: "paint", bitmapId: n.bitmapId };
}
function forkBitmap(t: ReturnType<typeof paintTarget>): { id: string; canvas: HTMLCanvasElement } {
  const c = cloneBitmap(t.bitmapId);
  gesture.update((d) => ({ ...d, photo: { ...d.photo, root: L.patchNode(d.photo.root, t.layerId, t.kind === "mask" ? { mask: { ...(L.find(d.photo.root, t.layerId)!.node.mask!), bitmapId: c.id } } : { bitmapId: c.id } as Partial<LayerNode>) } })); return c;
}

export interface Stroke { move(x: number, y: number): void; end(): void }
export function beginStroke(x0: number, y0: number, erase: boolean): Stroke | null {
  const u = getUi(); const t = paintTarget(); gesture.begin(); const { canvas } = forkBitmap(t);
  const base = document.createElement("canvas"); base.width = canvas.width; base.height = canvas.height; base.getContext("2d")!.drawImage(canvas, 0, 0);
  const layer = document.createElement("canvas"); layer.width = canvas.width; layer.height = canvas.height; const lx = layer.getContext("2d")!, cx = canvas.getContext("2d", { willReadFrequently: true })!;
  const color = t.kind === "mask" ? "#ffffff" : u.brush.color; let last = { x: x0, y: y0 }, carry = 0; const sel = u.selection;
  const compose = (): void => { cx.save(); cx.clearRect(0, 0, canvas.width, canvas.height); cx.drawImage(base, 0, 0);
    if (sel) { selPath(cx, sel); cx.clip(); } cx.globalAlpha = u.brush.opacity; cx.globalCompositeOperation = erase ? "destination-out" : "source-over"; cx.drawImage(layer, 0, 0); cx.restore(); bumpRev(); };
  stamp(lx, x0, y0, { size: u.brush.size, hardness: u.brush.hardness, color }); compose();
  return {
    move(x, y) { const r = stampPoints(last, { x, y }, u.brush.size, carry); carry = r.carry; for (const p of r.pts) stamp(lx, p.x, p.y, { size: u.brush.size, hardness: u.brush.hardness, color }); last = { x, y }; compose(); },
    end() { gesture.end(); },
  };
}
export function fillAt(x: number, y: number): void {
  const u = getUi(), P = getDoc().photo; const t = paintTarget(); gesture.begin(); const { canvas } = forkBitmap(t); const cx = canvas.getContext("2d", { willReadFrequently: true })!;
  const color = t.kind === "mask" ? "#ffffff" : u.brush.color;
  if (u.selection) { cx.save(); selPath(cx, u.selection); cx.clip(); cx.globalAlpha = u.brush.opacity; cx.fillStyle = color; cx.fillRect(0, 0, P.width, P.height); cx.restore(); }
  else { const img = cx.getImageData(0, 0, canvas.width, canvas.height); const empty = !img.data.some((v, i) => i % 4 === 3 && v > 0); if (empty) { cx.fillStyle = color; cx.fillRect(0, 0, P.width, P.height); } else { floodFill(img.data, img.width, img.height, x, y, hexToRgba(color, Math.round(255 * u.brush.opacity)), 24); cx.putImageData(img, 0, 0); } }
  gesture.end(); bumpRev();
}
export function eyedrop(x: number, y: number): void {
  const P = getDoc().photo, c = document.createElement("canvas"); c.width = P.width; c.height = P.height; const cx = c.getContext("2d", { willReadFrequently: true })!; renderPhoto(cx, P, player.resolver, "#ffffff");
  const p = cx.getImageData(Math.max(0, Math.min(P.width - 1, Math.floor(x))), Math.max(0, Math.min(P.height - 1, Math.floor(y))), 1, 1).data; setUi((u) => ({ brush: { ...u.brush, color: rgbaToHex(p[0]!, p[1]!, p[2]!) } }));
}
export function deleteSelectionPixels(): void {
  const u = getUi(), d = getDoc(); const sel = u.selection; if (!sel) return; const id = u.selLayers[0], f = id ? L.find(d.photo.root, id) : null; if (!f) return say("Select a layer first");
  gesture.begin();
  if (f.node.kind === "paint" && !u.maskEdit) { const { canvas } = forkBitmap({ layerId: id!, kind: "paint", bitmapId: f.node.bitmapId }); const x = canvas.getContext("2d")!; x.save(); selPath(x, sel); x.clip(); x.clearRect(0, 0, canvas.width, canvas.height); x.restore(); }
  else {
    if (!f.node.mask) { const m = newBitmap(d.photo.width, d.photo.height, "#fff"); gesture.update((x) => ({ ...x, photo: { ...x.photo, root: L.patchNode(x.photo.root, id!, { mask: { bitmapId: m.id, enabled: true, inverted: false, density: 1 } }) } })); }
    const cur = L.find(getDoc().photo.root, id!)!.node.mask!; const { canvas } = forkBitmap({ layerId: id!, kind: "mask", bitmapId: cur.bitmapId }); const x = canvas.getContext("2d")!; x.save(); selPath(x, sel); x.clip(); x.clearRect(0, 0, canvas.width, canvas.height); x.restore();
  }
  gesture.end(); bumpRev();
}
let clip: HTMLCanvasElement | null = null;
export function copySelection(): void {
  const s = getUi().selection, P = getDoc().photo; if (!s) return say("Make a selection first");
  const full = document.createElement("canvas"); full.width = P.width; full.height = P.height; const fx = full.getContext("2d")!; renderPhoto(fx, P, player.resolver);
  const out = document.createElement("canvas"); out.width = Math.max(1, Math.round(s.w)); out.height = Math.max(1, Math.round(s.h)); const ox = out.getContext("2d")!; ox.save(); ox.translate(-s.x, -s.y); selPath(ox, s); ox.clip(); ox.drawImage(full, 0, 0); ox.restore(); clip = out;
  out.toBlob((b) => { if (b && navigator.clipboard && "write" in navigator.clipboard) void navigator.clipboard.write([new ClipboardItem({ "image/png": b })]).catch(() => undefined); }); say("Copied selection");
}
export function cutSelection(): void { copySelection(); if (clip) deleteSelectionPixels(); }
export function paste(): void {
  if (!clip) return say("Nothing copied yet"); const P = getDoc().photo, s = getUi().selection; const id = addPaintLayer(); const t = L.find(getDoc().photo.root, id)!.node as PaintLayer;
  const { canvas } = cloneBitmap(t.bitmapId); const ox = s ? s.x : (P.width - clip.width) / 2, oy = s ? s.y : (P.height - clip.height) / 2; canvas.getContext("2d")!.drawImage(clip, ox, oy);
  edit((d) => ({ ...d, photo: { ...d.photo, root: L.patchNode(d.photo.root, id, { bitmapId: bitmapKey(canvas) } as Partial<LayerNode>) } })); bumpRev();
}
const bitmapKey = (c: HTMLCanvasElement): string => { for (const [k, v] of bitmaps) if (v === c) return k; return ""; };

export function applyCrop(r: { x: number; y: number; w: number; h: number }): void {
  const d = getDoc(), P = d.photo, x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y)), w = Math.min(P.width - x, Math.round(r.w)), h = Math.min(P.height - y, Math.round(r.h)); if (w < 2 || h < 2) return;
  const dx = x + w / 2 - P.width / 2, dy = y + h / 2 - P.height / 2; const recut = (id: string): string => { const src = bitmaps.get(id); const n = newBitmap(w, h); if (src) n.canvas.getContext("2d")!.drawImage(src, x, y, w, h, 0, 0, w, h); return n.id; };
  const walk = (g: import("../doc/schema").GroupNode, top: boolean): import("../doc/schema").GroupNode => ({ ...g, children: g.children.map((n) => { let m: LayerNode = n; if (n.mask) m = { ...m, mask: { ...n.mask, bitmapId: recut(n.mask.bitmapId) } };
    if (n.kind === "paint") m = { ...(m as PaintLayer), bitmapId: recut(n.bitmapId) }; if (top) m = { ...m, x: m.x - dx, y: m.y - dy }; return m.kind === "group" ? walk(m, false) : m; }) });
  edit((s) => ({ ...s, photo: { width: w, height: h, root: walk(s.photo.root, true) } })); setUi({ selection: null, crop: null, tool: "move", fit: true }); bumpRev();
}

export function renameMedia(id: string, name: string): void { const n = name.trim(); if (n) edit((d) => (d.media[id] ? { ...d, media: { ...d.media, [id]: { ...d.media[id]!, name: n } } } : d)); }
export const selectClips = (ids: string[], additive = false): void => setUi((u) => ({ selClips: additive ? [...new Set([...u.selClips, ...ids])] : ids, selLayers: [], selTransition: null }));
export const selectAllClips = (): void => selectClips(Object.keys(getDoc().video.clips));

export function alignSelection(edge: AlignEdge): void {
  const u = getUi(), d = getDoc(); gesture.begin();
  if (u.mode === "photo") { for (const id of u.selLayers) { const f = L.find(getDoc().photo.root, id); const b = f && nodeBox(f.node, getDoc()); if (!f || !b || f.node.locked) continue; const m = alignDelta(rectOf(b), edge, d.photo.width, d.photo.height); if (m.dx || m.dy) patchNode(id, { x: f.node.x + m.dx, y: f.node.y + m.dy }); } }
  else for (const id of u.selClips) { const c = getDoc().video.clips[id]; const b = c && clipBox(getDoc(), c, transport.t); if (!c || !b) continue; const m = alignDelta(rectOf(b), edge, d.video.width, d.video.height); const lt = localTime(id);
    if (m.dx) setAnimated(id, "x", valueAt(c, "x", lt) + m.dx / d.video.width); if (m.dy) setAnimated(id, "y", valueAt(getDoc().video.clips[id]!, "y", lt) + m.dy / d.video.height); }
  gesture.end();
}

export { ANIM_PRESETS };
export function applyAnimation(id: string, preset: AnimPreset): void {
  const c = getDoc().video.clips[id]; if (!c) return;
  edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: applyPreset(c.keyframes, preset, c, clipDuration(c), uid) }) })); player.refresh();
}
export function clearAnimation(id: string): void { edit((d) => ({ ...d, video: V.patchClip(d.video, id, { keyframes: {} }) })); player.refresh(); }

export { docDuration, emptyTrack, kindOf, runtime };
export type { MediaRef };

export const beginTextEdit = (): void => gesture.begin();
export const endTextEdit = (): void => gesture.end();
