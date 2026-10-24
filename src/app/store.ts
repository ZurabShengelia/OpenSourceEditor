import { useSyncExternalStore } from "react";
import { beginGesture, canRedo, canUndo, commit, createHistory, endGesture, redo as hRedo, undo as hUndo, updateGesture, type History } from "../doc/history";
import { newProject } from "../doc/migrate";
import type { ProjectV2 } from "../doc/schema";
import { bitmaps, bumpRev, uid } from "./media";

let hist: History<ProjectV2> = createHistory(newProject(uid(), "Untitled"), 150);
let savedDoc: ProjectV2 = hist.present; let version = 0; const dsubs = new Set<() => void>();
const emit = (): void => { version++; dsubs.forEach((f) => f()); };
export const getDoc = (): ProjectV2 => hist.present;
export const subscribeDoc = (f: () => void): (() => void) => { dsubs.add(f); return () => dsubs.delete(f); };
export function useDoc<T>(select: (d: ProjectV2) => T): T { return useSyncExternalStore(subscribeDoc, () => select(hist.present)); }
export const useCanUndo = (): boolean => useSyncExternalStore(subscribeDoc, () => canUndo(hist));
export const useCanRedo = (): boolean => useSyncExternalStore(subscribeDoc, () => canRedo(hist));
export const useSaved = (): boolean => useSyncExternalStore(subscribeDoc, () => hist.present === savedDoc);

export function edit(fn: (d: ProjectV2) => ProjectV2): void { const n = fn(hist.present); if (n !== hist.present) { hist = hist.open ? updateGesture(hist, n) : commit(hist, n); emit(); gcBitmaps(); } }
export const gesture = {
  begin(): void { hist = beginGesture(hist); },
  update(fn: (d: ProjectV2) => ProjectV2): void { const n = fn(hist.present); if (n !== hist.present) { hist = updateGesture(hist, n); emit(); } },
  end(): void { hist = endGesture(hist); emit(); gcBitmaps(); },
};
export function undo(): void { hist = hUndo(hist); emit(); }
export function redo(): void { hist = hRedo(hist); emit(); }
export function loadDoc(p: ProjectV2, saved = true): void { hist = createHistory(p, 150); if (saved) savedDoc = p; emit(); resetUi(); }
export function markSaved(p: ProjectV2): void { savedDoc = p; emit(); }
export function touchMeta(fn: (d: ProjectV2) => ProjectV2): void { hist = { ...hist, present: fn(hist.present) }; emit(); }
export const docVersion = (): number => version;

function referencedBitmaps(p: ProjectV2, out: Set<string>): void {
  const walk = (g: { children: { kind: string }[] }): void => { for (const n of g.children as import("../doc/schema").LayerNode[]) { if (n.kind === "paint") out.add(n.bitmapId); if (n.mask) out.add(n.mask.bitmapId); if (n.kind === "group") walk(n); } };
  walk(p.photo.root);
}
function gcBitmaps(): void {
  if (bitmaps.size < 24) return; const keep = new Set<string>(); for (const p of [...hist.past, hist.present, ...hist.future]) referencedBitmaps(p, keep);
  for (const id of [...bitmaps.keys()]) if (!keep.has(id)) bitmaps.delete(id); bumpRev();
}

export type Mode = "video" | "photo";
export type PhotoTool = "move" | "marquee" | "ellipse" | "crop" | "brush" | "eraser" | "fill" | "eyedropper" | "wand" | "shape" | "text" | "hand" | "zoom";
export interface Sel { kind: "rect" | "ellipse" | "mask"; x: number; y: number; w: number; h: number; mask?: Uint8Array; rects?: number[] }
export interface Rect4 { x: number; y: number; w: number; h: number }
export interface View { zoom: number; fit: boolean; pan: { x: number; y: number } }
export interface UI {
  mode: Mode; tool: PhotoTool; selClips: string[]; selLayers: string[]; selTrack: string | null; selTransition: string | null; maskEdit: boolean;
  zoomPx: number; photoZoom: number; fit: boolean; pan: { x: number; y: number }; rulers: boolean; vZoom: number; vFit: boolean; vPan: { x: number; y: number }; safeAreas: boolean;
  brush: { size: number; opacity: number; hardness: number; color: string }; wand: { tolerance: number; contiguous: boolean; sampleAll: boolean }; shapeKind: "rect" | "ellipse" | "line"; selection: Sel | null; crop: Rect4 | null; cropRatio: number | null;
  binSearch: string; binFilter: "all" | "video" | "audio" | "image"; binSel: string | null; snapping: boolean; inspectorTab: string; status: string; binOpen: boolean; inspOpen: boolean;
}
const pref = (k: string, d: boolean): boolean => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch { return d; } };
export const setPref = (k: string, v: boolean): void => { try { localStorage.setItem(k, v ? "1" : "0"); } catch { } };
const initialUi = (): UI => ({ mode: "video", tool: "move", selClips: [], selLayers: [], selTrack: null, selTransition: null, maskEdit: false, zoomPx: 80, photoZoom: 1, fit: true, pan: { x: 0, y: 0 }, rulers: true, vZoom: 1, vFit: true, vPan: { x: 0, y: 0 }, safeAreas: false,
  brush: { size: 24, opacity: 1, hardness: 0.7, color: "#e7eeee" }, wand: { tolerance: 32, contiguous: true, sampleAll: true }, shapeKind: "rect", selection: null, crop: null, cropRatio: null, binSearch: "", binFilter: "all", binSel: null, snapping: true, inspectorTab: "", status: "",
  binOpen: pref("loupe.binOpen", true), inspOpen: pref("loupe.inspOpen", true) });
let ui: UI = initialUi(); const usubs = new Set<() => void>();
export const getUi = (): UI => ui;
export function setUi(p: Partial<UI> | ((u: UI) => Partial<UI>)): void { ui = { ...ui, ...(typeof p === "function" ? p(ui) : p) }; usubs.forEach((f) => f()); }
export function useUi<T>(select: (u: UI) => T): T { return useSyncExternalStore((f) => { usubs.add(f); return () => usubs.delete(f); }, () => select(ui)); }
function resetUi(): void { const keep = { mode: ui.mode, rulers: ui.rulers, brush: ui.brush, wand: ui.wand, snapping: ui.snapping, safeAreas: ui.safeAreas, binOpen: ui.binOpen, inspOpen: ui.inspOpen }; ui = { ...initialUi(), ...keep }; usubs.forEach((f) => f()); }

let playhead = 0, playing = false; const tsubs = new Set<() => void>();
export const transport = {
  get t(): number { return playhead; }, get playing(): boolean { return playing; },
  set(t: number, p = playing): void { playhead = Math.max(0, t); playing = p; tsubs.forEach((f) => f()); },
  subscribe(f: () => void): () => void { tsubs.add(f); return () => tsubs.delete(f); },
};
export const usePlayhead = (): number => useSyncExternalStore(transport.subscribe, () => playhead);
export const usePlaying = (): boolean => useSyncExternalStore(transport.subscribe, () => playing);
