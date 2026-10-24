import { player } from "./engine";
import { docDuration } from "../doc/compose";
import * as A from "./actions";
import { DEFAULT_FILTERS, type Filters } from "../editor/effects";
import { decodeFlags, openTrack, blobReader } from "./frameDecoder";
import { runtime } from "./media";
import { renderStats } from "./renderStats";
import { faults, resources } from "./resources";
import { offlineStats } from "./offlineExport";
import { getDoc, setUi, transport } from "./store";

declare const __LOUPE_TEST__: boolean | undefined;
export function installTestHook(): void {
  if (typeof __LOUPE_TEST__ === "undefined" || !__LOUPE_TEST__) return;
  (window as unknown as { __loupe: unknown }).__loupe = {
    timeDraw(scale: number, n = 20): number { const prev = player.quality; player.quality = scale; player.draw(); const ds: number[] = []; for (let i = 0; i < n; i++) { const t0 = performance.now(); player.draw(); ds.push(performance.now() - t0); } player.quality = prev; ds.sort((a, b) => a - b); return ds[Math.floor(ds.length / 2)]!; },
    timeDrawNoViews(scale: number, n = 20): number { const pl = player as unknown as { views: Set<() => void> }; const keep = new Set(pl.views); pl.views.clear(); try { return (this as { timeDraw(s: number, n: number): number }).timeDraw(scale, n); } finally { keep.forEach((f) => pl.views.add(f)); } },
    setDirectDecoding: (on: boolean): void => { decodeFlags.direct = on; },
    offlineStats: () => ({ ...offlineStats }),
    buildSequence(n: number, transition = 0.4): number { const mid = Object.keys(getDoc().media)[0]; if (!mid) return 0; const ids: string[] = []; for (let i = 0; i < n; i++) { const id = A.addClipFromMedia(mid); if (id) ids.push(id); } const kinds = ["fade", "dissolve", "slide", "wipe"] as const; for (let i = 0; i < ids.length - 1; i++) A.addTransition(ids[i]!, kinds[i % 4]!, transition); return docDuration(getDoc().video); },
    setFiltersAll(p: Partial<Filters>): void { for (const c of Object.values(getDoc().video.clips)) A.patchClip(c.id, { filters: { ...c.filters, ...p } }); },
    resetFiltersAll(): void { for (const c of Object.values(getDoc().video.clips)) A.patchClip(c.id, { filters: { ...DEFAULT_FILTERS } }); },
    stackLayers(n: number): void { const mid = Object.keys(getDoc().media)[0]; if (!mid) return; for (let i = 0; i < n; i++) { A.addTrack("video"); const tr = getDoc().video.tracks.filter((t) => t.kind === "video").at(-1)!; const id = A.addClipFromMedia(mid, tr.id, 0); if (id) { A.setAnimated(id, "scale", 0.55); A.setAnimated(id, "opacity", 0.8); A.setAnimated(id, "x", (i % 2 ? 1 : -1) * 0.18); A.setAnimated(id, "y", (i % 2 ? -1 : 1) * 0.14); } } },
    async decodeBench(): Promise<{ frames: number; ms: number; msPerFrame: number } | null> {
      const rt = [...runtime.values()].find((r) => r.kind === "video"); if (!rt) return null; const tr = await openTrack(rt.blob); if (!tr) return null; const read = blobReader(rt.blob);
      const G = globalThis as unknown as { VideoDecoder: new (i: { output: (f: { close(): void }) => void; error: (e: Error) => void }) => { configure(c: unknown): void; decode(c: unknown): void; flush(): Promise<void>; close(): void; decodeQueueSize: number }; EncodedVideoChunk: new (i: unknown) => unknown };
      let n = 0; const d = new G.VideoDecoder({ output: (f) => { n++; f.close(); }, error: () => undefined }); d.configure({ codec: tr.codec, codedWidth: tr.width, codedHeight: tr.height, ...(tr.description ? { description: tr.description } : {}) });
      const t0 = performance.now(); for (let i = 0; i < tr.samples.length; i++) { const s = tr.samples[i]!; d.decode(new G.EncodedVideoChunk({ type: s.key ? "key" : "delta", timestamp: i, data: await read(s.offset, s.size) })); while (d.decodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1)); }
      await d.flush(); const ms = performance.now() - t0; d.close(); return { frames: n, ms, msPerFrame: ms / Math.max(1, n) }; },
    clips: () => Object.values(getDoc().video.clips).map((c) => ({ id: c.id, start: c.start, x: c.transform.x, y: c.transform.y, scale: c.transform.scale, rotation: c.transform.rotation, opacity: c.transform.opacity, volume: c.volume, balance: c.balance, fadeIn: c.fadeIn, fadeOut: c.fadeOut, muted: !!c.muted, speed: c.speed, crop: c.crop, filters: c.filters, keyframes: Object.fromEntries(Object.entries(c.keyframes).map(([k, v]) => [k, (v as unknown[]).length])) })),
    layers: () => { const out: { id: string; kind: string; x: number; y: number; scale: number; rotation: number; opacity: number; visible: boolean; locked: boolean }[] = []; const walk = (n: { children?: unknown[] }): void => { for (const c of (n.children ?? []) as { id: string; kind: string; x: number; y: number; scale: number; rotation: number; opacity: number; visible: boolean; locked: boolean; children?: unknown[] }[]) { out.push({ id: c.id, kind: c.kind, x: c.x, y: c.y, scale: c.scale, rotation: c.rotation, opacity: c.opacity, visible: c.visible, locked: c.locked }); walk(c); } }; walk(getDoc().photo.root as never); return out; },
    setInspectorTab: (t: string): void => { setUi({ inspectorTab: t }); },
    renderStats: () => ({ ...renderStats }),
    resources: () => ({ ...resources }),
    setFault(f: { preflight?: string; encodeAtFrame?: number; mux?: string; noWorker?: boolean; noFxCache?: boolean }): void { for (const k of Object.keys(faults)) delete (faults as Record<string, unknown>)[k]; Object.assign(faults, f); },
    previewFrame(t: number): { w: number; h: number; rgba: string } { const prev = player.quality; player.quality = 1; transport.set(t, false); player.refresh(); const c = player.frame; const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data; let s = ""; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000)); player.quality = prev; return { w: c.width, h: c.height, rgba: btoa(s) }; },
    duration: (): number => docDuration(getDoc().video),
    docSize: () => ({ w: getDoc().video.width, h: getDoc().video.height }), setTime: (t: number) => { transport.set(t, false); player.refresh(); },
  };
}
