import { useEffect, useRef, useState } from "react";
import { alignSelection, importFiles, setAnimated } from "../app/actions";
import { player } from "../app/engine";
import { clipBox, type Box } from "../app/geometry";
import { hit } from "../app/photoGeo";
import { ACTION_SAFE, rectOf, safeLines, snapMove, targetsFor, TITLE_SAFE, type Rect } from "../app/snap";
import { gesture, getDoc, getUi, setUi, transport, useDoc, usePlayhead, usePlaying, useUi } from "../app/store";
import { docDuration, evaluateFrame } from "../doc/compose";
import { valueAt } from "../doc/keyframes";
import { Btn, IconButton, fmt, Seg } from "./controls";
import { Icon } from "./Icon";
import { Guides, Handles, useSpaceHeld, useViewport, type HandleMode } from "./Viewport";

export function Preview({ onImport }: { onImport: () => void }) {
  const video = useDoc((d) => d.video), sel = useUi((u) => u.selClips), t = usePlayhead(), playing = usePlaying(), snapOn = useUi((u) => u.snapping), safe = useUi((u) => u.safeAreas);
  const vZoom = useUi((u) => u.vZoom), vFit = useUi((u) => u.vFit), vPan = useUi((u) => u.vPan); const view = { zoom: vZoom, fit: vFit, pan: vPan };
  const vp = useViewport(video.width, video.height, view, (p) => setUi({ ...(p.zoom !== undefined && { vZoom: p.zoom }), ...(p.fit !== undefined && { vFit: p.fit }), ...(p.pan && { vPan: p.pan }) }), 84);
  const cv = useRef<HTMLCanvasElement>(null); const [half, setHalf] = useState(false); const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] }); const space = useSpaceHeld();
  useEffect(() => { const c = cv.current; if (!c) return; const x = c.getContext("2d")!; const paint = (): void => { if (c.width !== player.frame.width || c.height !== player.frame.height) { c.width = player.frame.width; c.height = player.frame.height; } x.drawImage(player.frame, 0, 0); }; paint(); return player.onFrame(paint); }, []);
  useEffect(() => { player.refresh(); }, [video]);
  useEffect(() => { player.quality = half ? 0.5 : 1; player.refresh(); }, [half]);

  const clip = sel.length === 1 ? video.clips[sel[0]!] : undefined; const box: Box | null = clip ? clipBox(getDoc(), clip, t) : null;
  const toCanvas = (e: { clientX: number; clientY: number }): { x: number; y: number } => { const r = cv.current!.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * video.width, y: ((e.clientY - r.top) / r.height) * video.height }; };
  const down = (e: React.PointerEvent, mode: HandleMode): void => {
    if (!clip || e.button !== 0) return; e.stopPropagation(); const doc = getDoc(), id = clip.id, lt = Math.min(Math.max(transport.t - clip.start, 0), (clip.srcEnd - clip.srcStart) / clip.speed);
    const start = toCanvas(e), x0 = valueAt(clip, "x", lt), y0 = valueAt(clip, "y", lt), s0 = valueAt(clip, "scale", lt), b = clipBox(doc, clip, transport.t); if (!b) return; const d0 = Math.hypot(start.x - b.cx, start.y - b.cy) || 1;
    const W = doc.video.width, H = doc.video.height, r0 = rectOf(b); const others: Rect[] = evaluateFrame(doc.video, transport.t).filter((i) => i.clipId !== id).map((i) => { const c = doc.video.clips[i.clipId], bb = c && clipBox(doc, c, transport.t); return bb ? rectOf(bb) : null; }).filter((x): x is Rect => !!x);
    const tg = targetsFor(W, H, others, getUi().safeAreas ? { x: [...safeLines(W, H, ACTION_SAFE).x, ...safeLines(W, H, TITLE_SAFE).x], y: [...safeLines(W, H, ACTION_SAFE).y, ...safeLines(W, H, TITLE_SAFE).y] } : {});
    gesture.begin(); const move = (ev: PointerEvent): void => { const p = toCanvas(ev);
      if (mode === "move") { let dx = p.x - start.x, dy = p.y - start.y; if (getUi().snapping && !ev.altKey) { const s = snapMove(r0, dx, dy, tg, 8 / getUi().vZoom); dx = s.dx; dy = s.dy; setGuides({ x: s.gx, y: s.gy }); } else setGuides({ x: [], y: [] }); setAnimated(id, "x", x0 + dx / W); setAnimated(id, "y", y0 + dy / H); }
      else if (mode === "scale") setAnimated(id, "scale", Math.max(0.05, (s0 * Math.hypot(p.x - b.cx, p.y - b.cy)) / d0));
      else { let a = (Math.atan2(p.y - b.cy, p.x - b.cx) * 180) / Math.PI + 90; if (ev.shiftKey) a = Math.round(a / 15) * 15; setAnimated(id, "rotation", a); } };
    const up = (): void => { gesture.end(); setGuides({ x: [], y: [] }); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const pick = (e: React.PointerEvent): void => {
    if (e.button === 1 || space) { vp.panDrag(e); return; } if (e.button !== 0) return;
    const p = toCanvas(e), doc = getDoc(), items = evaluateFrame(doc.video, transport.t).reverse();
    for (const it of items) { const c = doc.video.clips[it.clipId]; const b = c && clipBox(doc, c, transport.t); if (c && b && hit(b, p.x, p.y)) { setUi({ selClips: [c.id], selLayers: [], selTransition: null }); down(e, "move"); return; } }
    setUi({ selClips: [] });
  };
  const end = docDuration(video), empty = Object.keys(video.clips).length === 0, W = video.width, H = video.height;
  const a = safeLines(W, H, ACTION_SAFE), ti = safeLines(W, H, TITLE_SAFE), z = vZoom;
  return (
    <section aria-label="Preview" className="stage">
      <div ref={vp.host} className="viewport" style={{ cursor: space ? "grab" : "default" }} onPointerDown={pick}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files as ArrayLike<File>)); } }}>
        <div className="vp-content" style={{ width: W, height: H, transform: `translate(${vPan.x}px, ${vPan.y}px) scale(${vZoom})` }}>
          <canvas ref={cv} aria-label="Video preview" style={{ width: W, height: H, background: "#000" }} />
          <div className="frame" />
          <svg width={W} height={H}>
            {safe && <g fill="none" stroke="rgba(255,255,255,.4)" strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`}>
              <rect x={a.x[0]} y={a.y[0]} width={a.x[1]! - a.x[0]!} height={a.y[1]! - a.y[0]!} /><rect x={ti.x[0]} y={ti.y[0]} width={ti.x[1]! - ti.x[0]!} height={ti.y[1]! - ti.y[0]!} />
              <path d={`M${W / 2 - 10 / z} ${H / 2}h${20 / z}M${W / 2} ${H / 2 - 10 / z}v${20 / z}`} strokeDasharray="none" /></g>}
            {box && <Handles box={box} zoom={z} onDown={down} />}
            <Guides x={guides.x} y={guides.y} w={W} h={H} zoom={z} />
          </svg>
        </div>
        {empty && <div className="empty-stage"><div className="empty-card"><Icon name="video" size={22} /><b>Start with your footage</b><span>Import video, audio or images, then place them on the timeline.<br />You can also drop files anywhere here.</span><Btn primary onClick={onImport}><Icon name="import" size={14} />Import media</Btn></div></div>}
      </div>
      <div className="transport">
        <IconButton icon="skipStart" label="Go to start" keys="Home" onClick={() => player.seek(0)} /><IconButton icon="stepBack" label="Previous frame" onClick={() => player.seek(transport.t - 1 / video.fps)} />
        <button className="ibtn play" aria-label={playing ? "Pause" : "Play"} data-tip={playing ? "Pause" : "Play"} data-key="Space" onClick={() => player.toggle()}><Icon name={playing ? "pause" : "play"} size={16} /></button>
        <IconButton icon="stepFwd" label="Next frame" onClick={() => player.seek(transport.t + 1 / video.fps)} /><IconButton icon="skipEnd" label="Go to end" keys="End" onClick={() => player.seek(end)} />
        <span className="tc" aria-live="off">{fmt(t, video.fps)}<span className="of"> / {fmt(end, video.fps)}</span></span>
        <span className="sp" />
        <IconButton icon="safe" label="Safe areas" pressed={safe} onClick={() => setUi({ safeAreas: !safe })} /><IconButton icon="magnet" label="Snap to guides" pressed={snapOn} onClick={() => setUi({ snapping: !snapOn })} />
        <span className="vsep hide-narrow" />
        <IconButton icon="alignHC" className="hide-narrow" label="Center horizontally" size="sm" disabled={sel.length === 0} onClick={() => alignSelection("hcenter")} /><IconButton icon="alignVM" className="hide-narrow" label="Center vertically" size="sm" disabled={sel.length === 0} onClick={() => alignSelection("vmiddle")} />
        <span className="vsep hide-narrow" />
        <span className="hide-narrow"><Seg label="Preview quality" value={half ? "half" : "full"} onChange={(v) => setHalf(v === "half")} options={[{ id: "full", label: "Full", tip: "Full resolution preview" }, { id: "half", label: "Half", tip: "Half resolution preview (faster)" }]} /></span>
        <span className="vsep" />
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => vp.zoomBy(1 / 1.25)} /><span className="mono" style={{ width: 40, textAlign: "center", color: "var(--text-2)" }}>{Math.round(vZoom * 100)}%</span><IconButton icon="plus" label="Zoom in" size="sm" onClick={() => vp.zoomBy(1.25)} />
        <Btn sm className="ghost" onClick={vp.fit}>Fit</Btn><Btn sm className="ghost" onClick={vp.actual}>100%</Btn>
      </div>
    </section>
  );
}
