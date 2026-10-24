import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { addClipFromMedia, breakApartCompound, createCompoundClip, addMarkerAt, canDetachAudio, copyClips, cutClips, hasClipClipboard, moveMarkerTo, pasteClips, removeMarker, renameMarker, renameTrack, resizeTrack, selectAllClips, toggleClipFlag, toggleCollapse, canLinkAudio, detachAudio, linkAudio, addTextClip, addTrack, addTransition, deleteSelection, duplicateClips, moveClip, moveKeyframeTo, patchTrack, removeTrack, selectClips, splitAtPlayhead, trimClip } from "../app/actions";
import { player } from "../app/engine";
import { mediaRev, runtime, subscribeMedia } from "../app/media";
import { gesture, getDoc, getUi, setUi, transport, useDoc, usePlayhead, useUi } from "../app/store";
import { clipDuration, clipEnd, docDuration } from "../doc/compose";
import type { AnimProp, TClip, Track, TransitionKind } from "../doc/schema";
import { canCompound, rowHeight, snap } from "../doc/videoOps";
import { openContextMenu } from "../editor/ContextMenu";
import { Menu } from "../editor/Menu";
import { Btn, IconButton } from "./controls";
import { Icon, kindIcon } from "./Icon";
import { Waveform } from "./Waveform";

const HEADER = 184, RULER = 26, LINK_H = 24;
const attached = (c: TClip, media: Record<string, { kind: string; hasAudio?: boolean }>): boolean => c.type === "media" && !c.detached && !!c.mediaId && media[c.mediaId]?.kind === "video" && (media[c.mediaId]?.hasAudio === true || !!runtime.get(c.mediaId)?.peaks);
const STEPS = [0.04, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 300]; const SUB: Record<number, number> = { 0.04: 4, 0.1: 5, 0.25: 5, 0.5: 5, 1: 5, 2: 4, 5: 5, 10: 5, 30: 6, 60: 6, 300: 5 };
const tc = (s: number): string => { const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? "0" : ""}${Number.isInteger(r) ? r : r.toFixed(2)}`; };
const PROPS: AnimProp[] = ["x", "y", "scale", "rotation", "opacity", "volume"];
const KIND_COLOR: Record<Track["kind"], string> = { video: "var(--k-video)", audio: "var(--k-audio)", text: "var(--k-text)" };

function Ruler({ z, width, step }: { z: number; width: number; step: number }) {
  const n = SUB[step] ?? 5, major: string[] = [], minor: string[] = []; const labels: [number, string][] = [];
  for (let s = 0, i = 0; s * z <= width && i < 2000; i++, s = i * step) { const x = Math.round(s * z) + 0.5; major.push(`M${x} 12V26`); labels.push([x, tc(s)]); for (let k = 1; k < n; k++) { const mx = Math.round((s + (step * k) / n) * z) + 0.5; minor.push(`M${mx} ${k * 2 === n ? 18 : 21}V26`); } }
  return <svg width={width} height={RULER} aria-hidden="true"><path d={minor.join("")} stroke="#4a525a" strokeWidth="1" /><path d={major.join("")} stroke="#7d858d" strokeWidth="1" />{labels.map(([x, t]) => <text key={x} x={x + 4} y={10} fontSize="10" fill="#9aa1a8" fontFamily="var(--font-mono)">{t}</text>)}</svg>;
}

export function Timeline({ onImport }: { onImport: () => void }) {
  const video = useDoc((d) => d.video), media = useDoc((d) => d.media), z = useUi((u) => u.zoomPx), sel = useUi((u) => u.selClips), selTr = useUi((u) => u.selTransition), snapOn = useUi((u) => u.snapping), selTrack = useUi((u) => u.selTrack); useSyncExternalStore(subscribeMedia, mediaRev);
  const t = usePlayhead(); const scroller = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null); const [snapAt, setSnapAt] = useState<number | null>(null); const [hot, setHot] = useState<string | null>(null); const [drag, setDrag] = useState<string | null>(null); const [mq, setMq] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const dur = docDuration(video), contentW = Math.max(dur + 12, 30) * z; const tracks = [...video.tracks.filter((k) => k.kind !== "audio").reverse(), ...video.tracks.filter((k) => k.kind === "audio")];
  const step = STEPS.find((s) => s * z >= 90) ?? 300; const empty = Object.keys(video.clips).length === 0;
  const linkedOf = (tk: Track): TClip[] => (tk.kind === "video" && !tk.collapsed ? Object.values(video.clips).filter((c) => c.trackId === tk.id && attached(c, media)) : []);
  const laneH = (tk: Track): number => rowHeight(tk) + (linkedOf(tk).length ? LINK_H : 0);
  const tops: Record<string, number> = {}; { let y = 0; for (const k of tracks) { tops[k.id] = y; y += laneH(k); } }
  const lastVisual = tracks.filter((k) => k.kind !== "audio").length - 1;

  useEffect(() => { const el = scroller.current; if (!el) return; const f = (e: WheelEvent): void => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const rect = el.getBoundingClientRect(), tAt = (e.clientX - rect.left + el.scrollLeft - HEADER) / getUi().zoomPx; const nz = Math.min(600, Math.max(8, getUi().zoomPx * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); setUi({ zoomPx: nz }); el.scrollLeft = tAt * nz + HEADER - (e.clientX - rect.left); };
    el.addEventListener("wheel", f, { passive: false }); return () => el.removeEventListener("wheel", f); }, []);
  useEffect(() => { const el = scroller.current; if (!el || !transport.playing) return; const x = HEADER + t * z; if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HEADER) el.scrollLeft = Math.max(0, x - HEADER - 60); }, [t, z]);
  const fit = (): void => { const w = (scroller.current?.clientWidth ?? 800) - HEADER - 40; setUi({ zoomPx: Math.min(300, Math.max(8, w / Math.max(dur, 1))) }); if (scroller.current) scroller.current.scrollLeft = 0; };
  const timeAt = (clientX: number): number => { const el = scroller.current!, r = el.getBoundingClientRect(); return (clientX - r.left + el.scrollLeft - HEADER) / getUi().zoomPx; };
  const seekFrom = (e: { clientX: number }): void => { const fps = getDoc().video.fps; player.seek(Math.max(0, Math.round(timeAt(e.clientX) * fps) / fps)); };
  const scrub = (e: React.PointerEvent): void => { e.preventDefault(); seekFrom(e); const mv = (ev: PointerEvent): void => seekFrom(ev); const up = (): void => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); };
  const dropOn = (e: DragEvent, trackId: string): void => { setHot(null); const id = e.dataTransfer.getData("application/x-loupe-media"); if (!id) return; e.preventDefault(); addClipFromMedia(id, trackId, Math.max(0, timeAt(e.clientX))); };

  const select = (e: React.PointerEvent, c: TClip): boolean => {
    const s0 = getUi().selClips; const mod = e.ctrlKey || e.metaKey;
    if (e.shiftKey && s0.length) { const a = getDoc().video.clips[s0[s0.length - 1]!]; if (a && a.trackId === c.trackId) { const lo = Math.min(a.start, c.start), hi = Math.max(a.start, c.start); selectClips(Object.values(getDoc().video.clips).filter((k) => k.trackId === c.trackId && k.start >= lo - 1e-6 && k.start <= hi + 1e-6).map((k) => k.id)); return true; } }
    if (e.shiftKey || mod) { selectClips(s0.includes(c.id) ? s0.filter((x) => x !== c.id) : [...s0, c.id]); return true; }
    if (!s0.includes(c.id)) selectClips([c.id]); return false;
  };
  const startDrag = (e: React.PointerEvent, c: TClip, mode: "move" | "l" | "r"): void => {
    if (e.button !== 0) return; e.stopPropagation(); if (select(e, c)) return; if (getDoc().video.tracks.find((k) => k.id === c.trackId)?.locked) return;
    const ids = mode === "move" ? (getUi().selClips.includes(c.id) ? getUi().selClips : [c.id]) : [c.id]; const orig = new Map(ids.map((id) => [id, getDoc().video.clips[id]!.start])); const x0 = e.clientX, y0 = e.clientY; const origEnd = clipEnd(getDoc().video.clips[c.id]!); let began = false;
    const mv = (ev: PointerEvent): void => {
      if (!began) { if (Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return; began = true; gesture.begin(); setDrag(c.id); }
      const doc = getDoc(); let dt = (ev.clientX - x0) / z; const rad = 8 / z, ph = transport.t, on = getUi().snapping && !ev.altKey; const cur = doc.video.clips[c.id]!; let hit: number | null = null;
      if (mode === "move") {
        const s = orig.get(c.id)! + dt, d0 = clipDuration(cur); if (on) { const a = snap(doc.video, s, ph, rad, c.id), b = snap(doc.video, s + d0, ph, rad, c.id); if (a.hit !== null && (b.hit === null || Math.abs(a.t - s) <= Math.abs(b.t - s - d0))) { dt = a.t - orig.get(c.id)!; hit = a.hit; } else if (b.hit !== null) { dt = b.t - d0 - orig.get(c.id)!; hit = b.hit; } }
        const under = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.track)?.getAttribute("data-track") ?? undefined; setHot(ids.length === 1 && under && under !== doc.video.clips[c.id]!.trackId ? under : null);
        for (const id of ids) moveClip(id, orig.get(id)! + dt, ids.length === 1 && under && under !== doc.video.clips[id]!.trackId ? under : undefined);
      } else { let edge = (mode === "l" ? orig.get(c.id)! : origEnd) + dt; if (on) { const r = snap(doc.video, edge, ph, rad, c.id); if (r.hit !== null) { edge = r.t; hit = r.hit; } } trimClip(c.id, mode, edge); }
      setSnapAt(hit);
    };
    const up = (): void => { if (began) gesture.end(); setSnapAt(null); setHot(null); setDrag(null); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const kfDrag = (e: React.PointerEvent, c: TClip, prop: AnimProp, id: string): void => {
    e.stopPropagation(); const x0 = e.clientX; const k0 = (c.keyframes[prop] ?? []).find((k) => k.id === id)?.t ?? 0; gesture.begin();
    const mv = (ev: PointerEvent): void => moveKeyframeTo(c.id, prop, id, k0 + (ev.clientX - x0) / z); const up = (): void => { gesture.end(); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const marquee = (e: React.PointerEvent): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return; const box = inner.current!.getBoundingClientRect(); const add = e.shiftKey || e.ctrlKey || e.metaKey; const base = add ? getUi().selClips : []; const p = (ev: { clientX: number; clientY: number }): { x: number; y: number } => ({ x: ev.clientX - box.left - HEADER, y: ev.clientY - box.top - RULER });
    const a = p(e); let moved = false;
    const mv = (ev: PointerEvent): void => { const b = p(ev); if (!moved && Math.hypot(b.x - a.x, b.y - a.y) < 4) return; moved = true; const r = { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }; setMq(r);
      const hits = Object.values(getDoc().video.clips).filter((c) => { const top = tops[c.trackId]; if (top === undefined) return false; return c.start * z < r.x1 && clipEnd(c) * z > r.x0 && top < r.y1 && top + rowHeight(getDoc().video.tracks.find((k) => k.id === c.trackId)!) > r.y0; }).map((c) => c.id); selectClips([...new Set([...base, ...hits])]); };
    const up = (): void => { if (!moved && !add) { selectClips([]); setUi({ selTransition: null }); } setMq(null); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const paste = (trackId?: string, at?: number): void => pasteClips(at ?? transport.t, trackId);
  const timelineItems = (at: number, trackId?: string): import("../editor/Menu").MenuItem[] => [
    { label: "Add marker here", shortcut: "M", onSelect: () => addMarkerAt(at) }, { label: "Paste", shortcut: "Ctrl+V", disabled: !hasClipClipboard(), onSelect: () => paste(trackId, at) }, { label: "Select all", shortcut: "Ctrl+A", onSelect: selectAllClips }, { sep: true },
    { label: "Add video track", onSelect: () => addTrack("video") }, { label: "Add audio track", onSelect: () => addTrack("audio") }, { label: "Add text track", onSelect: () => addTrack("text") }];
  const clipMenu = (e: React.MouseEvent, c: TClip): void => { if (!getUi().selClips.includes(c.id)) selectClips([c.id]);
    const ids = getUi().selClips; const all = ids.map((i) => getDoc().video.clips[i]).filter((x): x is TClip => !!x); const every = (f: (x: TClip) => boolean): boolean => all.length > 0 && all.every(f); const kind = getDoc().video.tracks.find((k) => k.id === c.trackId)?.kind;
    openContextMenu(e, [
      { label: "Cut", shortcut: "Ctrl+X", onSelect: () => cutClips(ids) }, { label: "Copy", shortcut: "Ctrl+C", onSelect: () => copyClips(ids) }, { label: "Paste", shortcut: "Ctrl+V", disabled: !hasClipClipboard(), onSelect: () => paste(c.trackId, transport.t) },
      { label: "Duplicate", shortcut: "Ctrl+D", onSelect: () => duplicateClips(ids) }, { label: "Split at playhead", shortcut: "S", onSelect: splitAtPlayhead }, { sep: true },
      ...(canDetachAudio(c.id) ? [{ label: "Detach audio", onSelect: () => detachAudio() }] : []), ...(canLinkAudio(c.id) ? [{ label: "Link audio & video", onSelect: () => linkAudio() }] : []),
      ...(kind !== "text" ? [{ label: every((x) => !!x.muted) ? "Unmute" : "Mute", shortcut: "Shift+M", onSelect: () => toggleClipFlag("muted", ids) }] : []),
      ...(getDoc().video && canCompound(getDoc().video, ids) ? [{ label: all.length > 1 ? "Create compound clip" : "Wrap in compound clip", onSelect: () => createCompoundClip(ids) }] : []), ...(c.type === "compound" ? [{ label: "Break apart compound", onSelect: () => breakApartCompound(c.id) }] : []),
      { label: every((x) => !!x.disabled) ? "Enable" : "Disable", shortcut: "Shift+E", onSelect: () => toggleClipFlag("disabled", ids) }, { label: every((x) => !!x.locked) ? "Unlock" : "Lock", shortcut: "Shift+L", onSelect: () => toggleClipFlag("locked", ids) }, { sep: true },
      ...(kind === "video" ? [{ heading: "Transition after this clip" } as import("../editor/Menu").MenuItem, ...(["fade", "dissolve", "slide", "wipe"] as TransitionKind[]).map((k) => ({ label: k[0]!.toUpperCase() + k.slice(1), onSelect: () => addTransition(c.id, k) })), { sep: true } as import("../editor/Menu").MenuItem] : []),
      { label: "Delete", shortcut: "Del", danger: true, onSelect: deleteSelection }]); };
  const headMenu = (e: React.MouseEvent, tk: Track): void => openContextMenu(e, [{ label: "Rename…", onSelect: () => void renameTrack(tk.id) }, { sep: true }, { label: tk.muted ? "Unmute" : "Mute", onSelect: () => patchTrack(tk.id, { muted: !tk.muted }) }, { label: tk.solo ? "Unsolo" : "Solo", onSelect: () => patchTrack(tk.id, { solo: !tk.solo }) }, { label: tk.locked ? "Unlock" : "Lock", onSelect: () => patchTrack(tk.id, { locked: !tk.locked }) }, ...(tk.kind !== "audio" ? [{ label: tk.visible ? "Hide" : "Show", onSelect: () => patchTrack(tk.id, { visible: !tk.visible }) }] : []), { sep: true },
    { label: tk.collapsed ? "Expand" : "Collapse", onSelect: () => toggleCollapse(tk.id) }, { label: "Taller", onSelect: () => resizeTrack(tk.id, 1) }, { label: "Shorter", onSelect: () => resizeTrack(tk.id, -1) }, { label: "Reset height", onSelect: () => resizeTrack(tk.id, 0) }, { sep: true },
    { label: "Add video track", onSelect: () => addTrack("video") }, { label: "Add audio track", onSelect: () => addTrack("audio") }, { label: "Add text track", onSelect: () => addTrack("text") }, { sep: true }, { label: "Delete track", danger: true, onSelect: () => removeTrack(tk.id) }]);
  const markerMenu = (e: React.MouseEvent, id: string, mt: number): void => openContextMenu(e, [{ label: "Go to marker", onSelect: () => player.seek(mt) }, { label: "Rename…", onSelect: () => void renameMarker(id) }, { sep: true }, { label: "Delete marker", danger: true, onSelect: () => removeMarker(id) }]);
  const markerDrag = (e: React.PointerEvent, id: string, mt: number): void => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault(); const x0 = e.clientX; let began = false;
    const mv = (ev: PointerEvent): void => { if (!began) { if (Math.abs(ev.clientX - x0) < 3) return; began = true; gesture.begin(); } moveMarkerTo(id, mt + (ev.clientX - x0) / getUi().zoomPx); };
    const up = (): void => { if (began) gesture.end(); else player.seek(mt); window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };

  return (
    <section aria-label="Timeline" className="tl">
      <div className="tl-bar">
        <Btn sm className="ghost" onClick={splitAtPlayhead} tipLabel="Split at playhead" keys="S"><Icon name="split" size={14} />Split</Btn>
        <IconButton icon="cut" label="Cut" keys="Ctrl+X" disabled={!sel.length} onClick={() => cutClips(sel)} /><IconButton icon="copy" label="Copy" keys="Ctrl+C" disabled={!sel.length} onClick={() => copyClips(sel)} /><IconButton icon="paste" label="Paste at playhead" keys="Ctrl+V" onClick={() => paste()} /><IconButton icon="layers" label="Duplicate" keys="Ctrl+D" disabled={!sel.length} onClick={() => duplicateClips(sel)} /><IconButton icon="trash" label="Delete" keys="Del" disabled={!sel.length && !selTr} onClick={deleteSelection} />
        <span className="vsep" /><IconButton icon="flag" label="Add marker at playhead" keys="M" onClick={() => addMarkerAt()} /><Btn sm className="ghost" onClick={addTextClip} tipLabel="Add text at playhead"><Icon name="text" size={14} />Text</Btn>
        <Menu id="addtrack" ghost label="Add track" icon="plus" items={[{ label: "Video track", onSelect: () => addTrack("video") }, { label: "Audio track", onSelect: () => addTrack("audio") }, { label: "Text track", onSelect: () => addTrack("text") }]} />
        <span className="vsep" /><IconButton icon="magnet" label="Snapping" keys="Alt: off" pressed={snapOn} onClick={() => setUi({ snapping: !snapOn })} />
        <span className="sp" />
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => setUi({ zoomPx: Math.max(8, z / 1.4) })} />
        <input aria-label="Timeline zoom" type="range" min={8} max={400} value={z} className="range" style={{ "--lo": "0%", "--hi": `${((z - 8) / 392) * 100}%` } as React.CSSProperties} onChange={(e) => setUi({ zoomPx: Number(e.target.value) })} />
        <IconButton icon="plus" label="Zoom in" size="sm" onClick={() => setUi({ zoomPx: Math.min(600, z * 1.4) })} /><Btn sm className="ghost" onClick={fit} tipLabel="Fit timeline to window">Fit</Btn>
      </div>
      <div ref={scroller} className="tl-scroll" tabIndex={0} aria-label="Timeline tracks">
        <div ref={inner} className="tl-inner" style={{ width: HEADER + contentW }}>
          <div className="tl-ruler">
            <div className="tl-corner" style={{ width: HEADER }}>{video.fps} fps · {tc(dur)}</div>
            <div className="tl-ticks" onPointerDown={scrub} onContextMenu={(e) => openContextMenu(e, timelineItems(Math.max(0, timeAt(e.clientX))))} role="slider" aria-label="Playhead position" aria-valuenow={Math.round(t * 100) / 100} aria-valuemin={0} aria-valuemax={Math.round(dur)}><Ruler z={z} width={contentW} step={step} />{(video.markers ?? []).map((m) => <button key={m.id} className="marker" style={{ left: m.t * z }} aria-label={`Marker ${m.name} at ${tc(m.t)}`} title={`${m.name} (${tc(m.t)})`} onPointerDown={(e) => markerDrag(e, m.id, m.t)} onDoubleClick={() => void renameMarker(m.id)} onContextMenu={(e) => markerMenu(e, m.id, m.t)} />)}</div>
          </div>
          {empty && <div className="tl-empty">Drag media here from the Media panel,<br />or double-click an item to add it at the end.<br /><button className="btn sm" style={{ marginTop: 10, pointerEvents: "auto" }} onClick={onImport}>Import media</button></div>}
          {tracks.map((tk, ti) => (
            <div key={tk.id} className={`tl-row ${ti === lastVisual ? "sect" : ""}`} style={{ height: laneH(tk) }}>
              <div style={{ width: HEADER }} className={`tl-head ${selTrack === tk.id ? "cur" : ""}`} onPointerDown={() => setUi({ selTrack: tk.id })} onContextMenu={(e) => headMenu(e, tk)}>
                <span className="kindbar" style={{ background: KIND_COLOR[tk.kind] }} /><button className="ibtn chev" aria-label={tk.collapsed ? `Expand ${tk.name}` : `Collapse ${tk.name}`} aria-expanded={!tk.collapsed} data-tip={tk.collapsed ? "Expand track" : "Collapse track"} onClick={() => toggleCollapse(tk.id)}><Icon name={tk.collapsed ? "chevR" : "chevD"} size={12} /></button>
                <span className="ico" style={{ color: KIND_COLOR[tk.kind] }}><Icon name={tk.kind === "text" ? "text" : kindIcon(tk.kind)} size={13} /></span>
                <input aria-label={`Track name ${tk.name}`} className="tname" value={tk.name} maxLength={12} onChange={(e) => patchTrack(tk.id, { name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
                {tk.kind !== "audio" && <button className="ibtn" aria-label={tk.visible ? `Hide ${tk.name}` : `Show ${tk.name}`} aria-pressed={!tk.visible} data-tip={tk.visible ? "Hide track" : "Show track"} onClick={() => patchTrack(tk.id, { visible: !tk.visible })}><Icon name={tk.visible ? "eye" : "eyeOff"} size={14} /></button>}
                <button className="ibtn letter" aria-label={`Mute ${tk.name}`} aria-pressed={tk.muted} data-tip="Mute track" onClick={() => patchTrack(tk.id, { muted: !tk.muted })}>M</button>
                <button className="ibtn letter" aria-label={`Solo ${tk.name}`} aria-pressed={tk.solo} data-tip="Solo track" onClick={() => patchTrack(tk.id, { solo: !tk.solo })}>S</button>
                <button className="ibtn" aria-label={tk.locked ? `Unlock ${tk.name}` : `Lock ${tk.name}`} aria-pressed={tk.locked} data-tip={tk.locked ? "Unlock track" : "Lock track"} onClick={() => patchTrack(tk.id, { locked: !tk.locked })}><Icon name={tk.locked ? "lock" : "unlock"} size={14} /></button>
              </div>
              <div data-track={tk.id} className={`tl-lane ${tk.locked ? "locked" : ""} ${hot === tk.id ? "hot" : ""}`} style={{ "--major": `${step * z}px` } as React.CSSProperties} onPointerDown={marquee} onContextMenu={(e) => { if (e.target === e.currentTarget) openContextMenu(e, timelineItems(Math.max(0, timeAt(e.clientX)), tk.id)); }} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-loupe-media")) { e.preventDefault(); setHot(tk.id); } }} onDragLeave={() => setHot(null)} onDrop={(e) => dropOn(e, tk.id)}>
                {Object.values(video.clips).filter((c) => c.trackId === tk.id).map((c) => {
                  const w = clipDuration(c) * z, on = sel.includes(c.id), m = c.mediaId ? media[c.mediaId] : undefined, peaks = c.mediaId ? runtime.get(c.mediaId)?.peaks : null; const h = rowHeight(tk) - 7; const name = c.type === "text" ? c.text?.text ?? "Text" : c.type === "compound" ? video.compounds?.[c.compoundId ?? ""]?.name ?? "Compound" : m?.name ?? "Clip";
                  const kfs = PROPS.flatMap((p) => (c.keyframes[p] ?? []).map((k) => ({ p, k }))); const wh = tk.kind === "audio" ? h - 4 : Math.min(18, h - 6);
                  return (
                    <div key={c.id} role="button" tabIndex={0} aria-label={`${name}, ${clipDuration(c).toFixed(2)} seconds`} aria-pressed={on} onPointerDown={(e) => startDrag(e, c, "move")} onContextMenu={(e) => clipMenu(e, c)} onKeyDown={(e) => { if (e.key === "Enter") selectClips([c.id]); }}
                      className={`clip ${tk.kind} ${c.type === "compound" ? "compound" : ""} ${tk.locked || c.locked ? "locked" : ""} ${c.disabled ? "disabled" : ""} ${drag === c.id ? "dragging" : ""}`}
                      style={{ left: c.start * z, width: Math.max(4, w), height: h, backgroundImage: m?.thumb && tk.kind === "video" ? `linear-gradient(rgba(16,18,20,.5),rgba(16,18,20,.5)),url(${m.thumb})` : undefined, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}>
                      {peaks && h >= 26 && (tk.kind === "audio" || w > 40) && <div className="wave" style={{ height: wh }}><Waveform peaks={peaks} srcStart={c.srcStart} srcEnd={c.srcEnd} width={w} height={wh} color={tk.kind === "audio" ? "rgba(178,232,196,.75)" : "rgba(255,255,255,.4)"} /></div>}
                      <div className="cl"><span>{name}</span>{c.locked && <span className="flag" title="Locked"><Icon name="lock" size={10} /></span>}{(c.muted || c.detached) && <span className="flag" title={c.muted ? "Muted" : "Audio detached"}><Icon name="volOff" size={11} /></span>}{c.disabled && <span className="sp">off</span>}{c.speed !== 1 && <span className="sp">{c.speed}×</span>}</div>
                      {c.fadeIn > 0 && <div className="fade" style={{ left: 0, width: c.fadeIn * z, background: "linear-gradient(to right, rgba(0,0,0,.55), transparent)" }} />}
                      {c.fadeOut > 0 && <div className="fade" style={{ right: 0, width: c.fadeOut * z, background: "linear-gradient(to left, rgba(0,0,0,.55), transparent)" }} />}
                      {kfs.map(({ p, k }) => <span key={`${p}${k.id}`} role="button" className="kf" aria-label={`Keyframe ${p} at ${k.t.toFixed(2)}s`} title={`${p} @ ${k.t.toFixed(2)}s`} onPointerDown={on ? (e) => kfDrag(e, c, p, k.id) : undefined} style={{ left: k.t * z }} />)}
                      <span aria-hidden className="grip l" onPointerDown={(e) => startDrag(e, c, "l")} /><span aria-hidden className="grip r" onPointerDown={(e) => startDrag(e, c, "r")} />
                    </div>
                  );
                })}
                {linkedOf(tk).map((c) => { const pk = c.mediaId ? runtime.get(c.mediaId)?.peaks : null; const lw = clipDuration(c) * z; const on = sel.includes(c.id);
                  return <div key={`link-${c.id}`} role="button" tabIndex={-1} className={`linkstrip ${on ? "on" : ""} ${c.muted || c.disabled ? "off" : ""}`} aria-label={`Linked audio of ${media[c.mediaId ?? ""]?.name ?? "clip"}`} title="Linked audio: moves, trims and splits with its video clip. Right-click to detach it."
                    style={{ left: c.start * z, width: Math.max(4, lw), top: rowHeight(tk) - 3, height: LINK_H - 3 }} onPointerDown={(e) => { if (e.button === 0) { e.stopPropagation(); selectClips(e.ctrlKey || e.metaKey ? [...new Set([...sel, c.id])] : [c.id]); } }} onContextMenu={(e) => clipMenu(e, c)}>
                    {pk && lw > 30 && <Waveform peaks={pk} srcStart={c.srcStart} srcEnd={c.srcEnd} width={lw} height={LINK_H - 7} color="rgba(178,232,196,.6)" />}<span className="lk"><Icon name="audio" size={10} />{tk.name}</span></div>; })}
                {video.transitions.filter((x) => x.trackId === tk.id).map((x) => { const a = video.clips[x.fromClipId], b = video.clips[x.toClipId]; if (!a || !b) return null; const mid = (clipEnd(a) + b.start) / 2;
                  return <button key={x.id} className="trans" aria-label={`${x.kind} transition, ${x.duration.toFixed(2)} seconds`} aria-pressed={selTr === x.id} onClick={() => setUi({ selTransition: x.id, selClips: [] })} style={{ left: (mid - x.duration / 2) * z, width: Math.max(22, x.duration * z) }}>{x.kind}</button>; })}
              </div>
            </div>
          ))}
          {(video.markers ?? []).map((m) => <div key={m.id} aria-hidden className="markerline" style={{ left: HEADER + m.t * z, top: RULER }} />)}
          {mq && <div className="marquee" style={{ left: HEADER + mq.x0, top: RULER + mq.y0, width: mq.x1 - mq.x0, height: mq.y1 - mq.y0 }} />}
          <div aria-hidden className="playhead" style={{ left: HEADER + t * z }}><span className="head" /></div>
          {snapAt !== null && <div aria-hidden className="snapline" style={{ left: HEADER + snapAt * z }} />}
        </div>
      </div>
    </section>
  );
}
