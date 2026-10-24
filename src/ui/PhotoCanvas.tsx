import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { addImageLayer, addShapeLayer, addTextLayer, alignSelection, applyCrop, beginStroke, copySelection, cutSelection, deleteSelectionPixels, deselect, eyedrop, fillAt, paste, patchNode, selectLayer } from "../app/actions";
import { player } from "../app/engine";
import { mediaRev, subscribeMedia } from "../app/media";
import { nodeBox, pick, type PBox } from "../app/photoGeo";
import { fitAspect, rectOf, snapMove, targetsFor, type Rect } from "../app/snap";
import { gesture, getDoc, getUi, setUi, useDoc, useUi, type Rect4 } from "../app/store";
import { find } from "../doc/layerOps";
import type { LayerNode } from "../doc/schema";
import { renderPhoto } from "../render/compositor";
import { Btn, Color, IconButton, NumberBox, Seg } from "./controls";
import { Icon } from "./Icon";
import { openContextMenu } from "../editor/ContextMenu";
import * as PA from "../app/actions";
import { Guides, Handles, useSpaceHeld, useViewport, type HandleMode } from "./Viewport";

const NICE = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
type Pt = { x: number; y: number };
type CropH = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "move";
const RATIOS: { id: string; label: string; r: number | null }[] = [{ id: "free", label: "Free", r: null }, { id: "1", label: "1:1", r: 1 }, { id: "4:3", label: "4:3", r: 4 / 3 }, { id: "3:2", label: "3:2", r: 3 / 2 }, { id: "16:9", label: "16:9", r: 16 / 9 }];

function OptSlider({ label, value, min, max, onChange, unit }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; unit?: string }) {
  return <><span className="lab">{label}</span><input type="range" className="range" aria-label={label} min={min} max={max} value={value} style={{ "--lo": "0%", "--hi": `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} onPointerDown={() => gesture.begin()} onPointerUp={() => gesture.end()} onChange={(e) => onChange(Number(e.target.value))} /><NumberBox label={`${label} value`} value={value} min={min} max={max} onChange={onChange} unit={unit ?? ""} /></>;
}
function OptionsBar() {
  const tool = useUi((u) => u.tool), b = useUi((u) => u.brush), sel = useUi((u) => u.selection), kind = useUi((u) => u.shapeKind), crop = useUi((u) => u.crop), ratio = useUi((u) => u.cropRatio), P = useDoc((d) => d.photo), hasSel = useUi((u) => u.selLayers.length > 0);
  const setB = (p: Partial<typeof b>): void => setUi({ brush: { ...b, ...p } });
  const align = (<><span className="vsep" />{([["alignL", "left", "Align left"], ["alignHC", "hcenter", "Center horizontally"], ["alignR", "right", "Align right"], ["alignT", "top", "Align top"], ["alignVM", "vmiddle", "Center vertically"], ["alignB", "bottom", "Align bottom"]] as const).map(([i, e, l]) => <IconButton key={e} icon={i} label={l} size="sm" disabled={!hasSel} onClick={() => alignSelection(e)} />)}</>);
  const wand = useUi((u) => u.wand), setW = (p: Partial<typeof wand>): void => setUi({ wand: { ...wand, ...p } });
  const selActs = sel && (<><span className="vsep" /><span className="mono">Selection {Math.round(sel.w)}×{Math.round(sel.h)}</span><Btn sm onClick={PA.invertSelection} tipLabel="Select everything except the current selection" keys="Ctrl+Shift+I">Invert</Btn><Btn sm onClick={copySelection}>Copy</Btn><Btn sm onClick={cutSelection}>Cut</Btn><Btn sm onClick={paste}>Paste</Btn><Btn sm onClick={() => deleteSelectionPixels()}>Erase</Btn><Btn sm className="ghost" onClick={deselect}>Deselect</Btn></>);
  const name: Record<string, string> = { move: "Move", marquee: "Rectangle selection", ellipse: "Ellipse selection", crop: "Crop", brush: "Brush", eraser: "Eraser", fill: "Fill", eyedropper: "Eyedropper", wand: "Magic Wand", shape: "Shape", text: "Text", hand: "Hand", zoom: "Zoom" };
  return (
    <div className="opts" role="toolbar" aria-label="Tool options"><span className="name">{name[tool]}</span>
      {tool === "move" && <><span className="lab">Click a layer to select, drag to move. Alt turns snapping off.</span>{align}</>}
      {tool === "wand" && <><OptSlider label="Tolerance" value={wand.tolerance} min={0} max={128} onChange={(v) => setW({ tolerance: v })} /><Seg label="Region" value={wand.contiguous ? "c" : "a"} onChange={(v) => setW({ contiguous: v === "c" })} options={[{ id: "c", label: "Connected" }, { id: "a", label: "Whole image" }]} /><Seg label="Sample" value={wand.sampleAll ? "all" : "layer"} onChange={(v) => setW({ sampleAll: v === "all" })} options={[{ id: "all", label: "Visible image" }, { id: "layer", label: "Selected layer" }]} />{sel ? selActs : <span className="lab">Click a color to select it. Shift adds, Alt subtracts.</span>}</>}
      {(tool === "marquee" || tool === "ellipse") && (sel ? selActs : <span className="lab">Drag on the canvas to select an area.</span>)}
      {(tool === "brush" || tool === "eraser") && <><OptSlider label="Size" value={b.size} min={1} max={400} unit="px" onChange={(v) => setB({ size: v })} /><OptSlider label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => setB({ opacity: v / 100 })} />{tool === "brush" && <OptSlider label="Hardness" value={Math.round(b.hardness * 100)} min={0} max={100} unit="%" onChange={(v) => setB({ hardness: v / 100 })} />}{tool === "brush" && <Color label="Brush color" value={b.color} onChange={(v) => setB({ color: v })} />}{selActs}</>}
      {tool === "fill" && <><OptSlider label="Opacity" value={Math.round(b.opacity * 100)} min={1} max={100} unit="%" onChange={(v) => setB({ opacity: v / 100 })} /><Color label="Fill color" value={b.color} onChange={(v) => setB({ color: v })} /><span className="lab">Fills the selection, or the area under the click on a paint layer.</span></>}
      {tool === "eyedropper" && <><Color label="Picked color" value={b.color} onChange={(v) => setB({ color: v })} /><span className="mono">{b.color}</span><span className="lab">Click or drag to sample the flattened image.</span></>}
      {tool === "shape" && <><Seg label="Shape" value={kind} onChange={(v) => setUi({ shapeKind: v })} options={[{ id: "rect", label: "Rectangle" }, { id: "ellipse", label: "Ellipse" }, { id: "line", label: "Line" }]} /><Color label="Shape fill" value={b.color} onChange={(v) => setB({ color: v })} /><span className="lab">Drag on the canvas to draw.</span></>}
      {tool === "text" && <span className="lab">Click the canvas to place text, then edit it in the inspector.</span>}
      {(tool === "hand" || tool === "zoom") && <span className="lab">{tool === "hand" ? "Drag to pan. Hold Space with any tool for the same." : "Click to zoom in, Alt or Shift-click to zoom out."}</span>}
      {tool === "crop" && crop && <>
        <Seg label="Aspect ratio" value={RATIOS.find((r) => r.r === ratio)?.id ?? "free"} onChange={(id) => { const r = RATIOS.find((x) => x.id === id)!.r; setUi({ cropRatio: r, ...(r ? { crop: fitAspect(P.width, P.height, r) } : {}) }); }} options={RATIOS.map((r) => ({ id: r.id, label: r.label }))} />
        <span className="lab">W</span><NumberBox label="Crop width" value={Math.round(crop.w)} min={2} max={P.width} onChange={(w) => setUi({ crop: { ...crop, w: Math.min(w, P.width - crop.x), ...(ratio ? { h: w / ratio } : {}) } })} /><span className="lab">H</span><NumberBox label="Crop height" value={Math.round(crop.h)} min={2} max={P.height} onChange={(h) => setUi({ crop: { ...crop, h: Math.min(h, P.height - crop.y) } })} />
        <span className="sp" style={{ flex: 1 }} /><Btn sm primary onClick={() => applyCrop(crop)} tipLabel="Apply crop" keys="Enter">Apply</Btn><Btn sm onClick={() => setUi({ crop: null, tool: "move" })} tipLabel="Cancel crop" keys="Esc">Cancel</Btn></>}
    </div>
  );
}

function SelOverlay({ sel, w, h }: { sel: NonNullable<ReturnType<typeof getUi>["selection"]>; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, m = sel.mask; if (!c || !m) return; const x = c.getContext("2d")!, img = x.createImageData(w, h), d = img.data;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const p = yy * w + xx; if (!m[p]) continue; const i = p * 4;
      const edge = xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1 || !m[p - 1]! || !m[p + 1]! || !m[p - w]! || !m[p + w]!;
      if (edge) { const on = ((xx + yy) >> 2) & 1; d[i] = d[i + 1] = d[i + 2] = on ? 255 : 0; d[i + 3] = 235; } else { d[i] = 69; d[i + 1] = 214; d[i + 2] = 160; d[i + 3] = 38; }
    }
    x.putImageData(img, 0, 0);
  }, [sel, w, h]);
  return <canvas ref={ref} width={w} height={h} aria-hidden="true" style={{ position: "absolute", inset: 0, width: w, height: h, pointerEvents: "none" }} />;
}

export function PhotoCanvas({ onImport }: { onImport: () => void }) {
  const P = useDoc((d) => d.photo), doc = useDoc((d) => d), zoom = useUi((u) => u.photoZoom), fit = useUi((u) => u.fit), pan = useUi((u) => u.pan), tool = useUi((u) => u.tool), sel = useUi((u) => u.selection), selLayers = useUi((u) => u.selLayers), rulers = useUi((u) => u.rulers), maskEdit = useUi((u) => u.maskEdit), snapOn = useUi((u) => u.snapping), crop = useUi((u) => u.crop), brush = useUi((u) => u.brush);
  const rev = useSyncExternalStore(subscribeMedia, mediaRev); const vp = useViewport(P.width, P.height, { zoom, fit, pan }, (p) => setUi({ ...(p.zoom !== undefined && { photoZoom: p.zoom }), ...(p.fit !== undefined && { fit: p.fit }), ...(p.pan && { pan: p.pan }) }), 64);
  const cv = useRef<HTMLCanvasElement>(null); const space = useSpaceHeld(); const size = vp.size; const [draft, setDraft] = useState<(Rect4 & { kind: string }) | null>(null); const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] }); const [hover, setHover] = useState<Pt | null>(null);
  const raf = useRef(0); useEffect(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(() => { const c = cv.current; if (!c) return; if (c.width !== P.width || c.height !== P.height) { c.width = P.width; c.height = P.height; } renderPhoto(c.getContext("2d")!, P, player.resolver, null); }); }, [P, doc.media, rev]);
  useEffect(() => { if (tool === "crop") { if (!getUi().crop) setUi({ crop: { x: 0, y: 0, w: P.width, h: P.height } }); } else if (getUi().crop) setUi({ crop: null }); }, [tool, P.width, P.height]);
  useEffect(() => { if (!crop) return; const k = (e: KeyboardEvent): void => { if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return; const c = getUi().crop; if (e.key === "Enter" && c) { e.preventDefault(); applyCrop(c); } else if (e.key === "Escape") setUi({ crop: null, tool: "move" }); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [!!crop]);

  const pt = (e: { clientX: number; clientY: number }): Pt => { const r = cv.current!.getBoundingClientRect(), z = getUi().photoZoom; return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }; };
  const track = (e: React.PointerEvent, onMove: (p: Pt, ev: PointerEvent) => void, onUp: (p: Pt) => void): void => {
    let last = pt(e); const mv = (ev: PointerEvent): void => { last = pt(ev); onMove(last, ev); }; const up = (): void => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); onUp(last); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  };
  const dragLayers = (e: React.PointerEvent, p0: Pt): void => {
    const d = getDoc(), ids = getUi().selLayers; const orig = new Map(ids.map((id) => [id, find(d.photo.root, id)!.node])); let began = false;
    const boxes = [...orig.values()].map((n) => nodeBox(n, d)).filter((b): b is PBox => !!b); const rs = boxes.map(rectOf);
    const r0: Rect | null = rs.length ? { l: Math.min(...rs.map((r) => r.l)), t: Math.min(...rs.map((r) => r.t)), r: Math.max(...rs.map((r) => r.r)), b: Math.max(...rs.map((r) => r.b)) } : null;
    const others = d.photo.root.children.filter((n) => !orig.has(n.id) && n.visible && n.kind !== "adjustment").map((n) => nodeBox(n, d)).filter((b): b is PBox => !!b).map(rectOf); const tg = targetsFor(d.photo.width, d.photo.height, others);
    track(e, (p, ev) => { if (!began) { if (Math.hypot(p.x - p0.x, p.y - p0.y) * getUi().photoZoom < 3) return; began = true; gesture.begin(); }
      let dx = p.x - p0.x, dy = p.y - p0.y; if (r0 && getUi().snapping && !ev.altKey) { const s = snapMove(r0, dx, dy, tg, 8 / getUi().photoZoom); dx = s.dx; dy = s.dy; setGuides({ x: s.gx, y: s.gy }); } else setGuides({ x: [], y: [] });
      for (const [id, n] of orig) patchNode(id, { x: n.x + dx, y: n.y + dy }); }, () => { if (began) gesture.end(); setGuides({ x: [], y: [] }); });
  };
  const onDown = (e: React.PointerEvent): void => {
    const u = getUi(), p = pt(e), t = space ? "hand" : u.tool;
    if (e.button === 1 || t === "hand") { vp.panDrag(e); return; } if (e.button !== 0) return;
    if (t === "zoom") { const r = vp.host.current!.getBoundingClientRect(); vp.zoomTo(u.photoZoom * (e.altKey || e.shiftKey ? 1 / 1.5 : 1.5), e.clientX - r.left, e.clientY - r.top); return; }
    if (t === "move") { const n = pick(getDoc(), p.x, p.y); if (!n) { selectLayer(null); return; } if (!getUi().selLayers.includes(n.id) || e.shiftKey) selectLayer(n.id, e.shiftKey); if (!e.shiftKey) dragLayers(e, p); return; }
    if (t === "marquee" || t === "ellipse") { setUi({ selection: null }); track(e, (q) => setUi({ selection: { kind: t === "marquee" ? "rect" : "ellipse", x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y) } }), (q) => { if (Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2) setUi({ selection: null }); }); return; }
    if (t === "wand") { PA.wandSelect(p.x, p.y, e.shiftKey ? "add" : e.altKey ? "subtract" : "replace"); return; }
    if (t === "brush" || t === "eraser") { const s = beginStroke(p.x, p.y, t === "eraser"); if (!s) return; track(e, (q) => s.move(q.x, q.y), () => s.end()); return; }
    if (t === "fill") { fillAt(p.x, p.y); return; }
    if (t === "eyedropper") { eyedrop(p.x, p.y); track(e, (q) => eyedrop(q.x, q.y), () => undefined); return; }
    if (t === "text") { addTextLayer(p.x - P.width / 2, p.y - P.height / 2); setUi({ tool: "move" }); return; }
    if (t === "shape") track(e, (q) => setDraft({ x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(q.x - p.x), h: Math.abs(q.y - p.y), kind: getUi().shapeKind }), (q) => { setDraft(null); const w = Math.abs(q.x - p.x), h = Math.abs(q.y - p.y); if (w < 3 && h < 3) return; const k = getUi().shapeKind; addShapeLayer(k, (p.x + q.x) / 2 - P.width / 2, (p.y + q.y) / 2 - P.height / 2, Math.max(2, w), k === "line" ? 2 : Math.max(2, h)); setUi({ tool: "move" }); });
  };

  const node: LayerNode | undefined = selLayers.length === 1 ? find(P.root, selLayers[0]!)?.node : undefined; const box: PBox | null = node && !node.locked ? nodeBox(node, doc) : null;
  const handle = (e: React.PointerEvent, mode: HandleMode): void => {
    if (!node || !box || e.button !== 0) return; e.stopPropagation(); if (mode === "move") { dragLayers(e, pt(e)); return; }
    const n0 = node, b = box, d0 = Math.hypot(pt(e).x - b.cx, pt(e).y - b.cy) || 1; gesture.begin();
    track(e, (q, ev) => { if (mode === "scale") patchNode(n0.id, { scale: Math.max(0.01, (n0.scale * Math.hypot(q.x - b.cx, q.y - b.cy)) / d0) }); else { let a = (Math.atan2(q.y - b.cy, q.x - b.cx) * 180) / Math.PI + 90; if (ev.shiftKey) a = Math.round(a / 15) * 15; patchNode(n0.id, { rotation: a }); } }, () => gesture.end());
  };
  const cropDrag = (e: React.PointerEvent, h: CropH): void => {
    const c0 = getUi().crop; if (!c0 || e.button !== 0) return; e.stopPropagation(); const p0 = pt(e), ratio = getUi().cropRatio, W = P.width, H = P.height;
    track(e, (q) => {
      const dx = q.x - p0.x, dy = q.y - p0.y; let l = c0.x, t = c0.y, r = c0.x + c0.w, b = c0.y + c0.h;
      if (h === "move") { const nx = Math.min(W - c0.w, Math.max(0, c0.x + dx)), ny = Math.min(H - c0.h, Math.max(0, c0.y + dy)); setUi({ crop: { ...c0, x: nx, y: ny } }); return; }
      if (h.includes("w")) l = c0.x + dx; if (h.includes("e")) r = c0.x + c0.w + dx; if (h.includes("n")) t = c0.y + dy; if (h.includes("s")) b = c0.y + c0.h + dy;
      l = Math.max(0, Math.min(l, r - 4)); r = Math.min(W, Math.max(r, l + 4)); t = Math.max(0, Math.min(t, b - 4)); b = Math.min(H, Math.max(b, t + 4));
      if (ratio) { if (h === "n" || h === "s") { const w = (b - t) * ratio, cx = c0.x + c0.w / 2; l = cx - w / 2; r = cx + w / 2; } else { const hh = (r - l) / ratio; if (h.includes("n")) t = b - hh; else if (h.includes("s")) b = t + hh; else { const cy = c0.y + c0.h / 2; t = cy - hh / 2; b = cy + hh / 2; } } l = Math.max(0, l); t = Math.max(0, t); r = Math.min(W, r); b = Math.min(H, b); }
      setUi({ crop: { x: l, y: t, w: r - l, h: b - t } });
    }, () => undefined);
  };
  const hs = 9 / zoom, sw = 1 / zoom;
  const selShape = (s: { kind: string; x: number; y: number; w: number; h: number }, key: string, dash = true) => { const common = { fill: "rgba(69,214,160,.1)", stroke: "#fff", strokeWidth: sw, strokeDasharray: dash ? `${5 / zoom} ${4 / zoom}` : undefined }; return s.kind === "ellipse" ? <ellipse key={key} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} {...common} /> : <rect key={key} x={s.x} y={s.y} width={s.w} height={s.h} {...common} />; };
  const cursor = space || tool === "hand" ? "grab" : tool === "move" ? "default" : tool === "zoom" ? "zoom-in" : tool === "text" ? "text" : tool === "brush" || tool === "eraser" ? "none" : "crosshair";
  const step = NICE.find((n) => n * zoom >= 60) ?? 5000, tx0 = Math.floor(-pan.x / zoom / step) * step, ty0 = Math.floor(-pan.y / zoom / step) * step;
  const xs: number[] = []; for (let v = tx0; v * zoom + pan.x < size.w && xs.length < 100; v += step) xs.push(v); const ys: number[] = []; for (let v = ty0; v * zoom + pan.y < size.h && ys.length < 100; v += step) ys.push(v);
  const empty = P.root.children.length === 0; const ch: [CropH, number, number][] = crop ? [["nw", crop.x, crop.y], ["n", crop.x + crop.w / 2, crop.y], ["ne", crop.x + crop.w, crop.y], ["e", crop.x + crop.w, crop.y + crop.h / 2], ["se", crop.x + crop.w, crop.y + crop.h], ["s", crop.x + crop.w / 2, crop.y + crop.h], ["sw", crop.x, crop.y + crop.h], ["w", crop.x, crop.y + crop.h / 2]] : [];
  const showBrush = hover && (tool === "brush" || tool === "eraser") && !space;
  return (
    <section aria-label="Photo editor" className="stage">
      <OptionsBar />
      <div ref={vp.host} className="viewport" style={{ cursor }} onPointerDown={onDown} role="application" aria-label="Photo canvas"
        onPointerMove={(e) => { if (tool === "brush" || tool === "eraser") setHover(pt(e)); }} onPointerLeave={() => setHover(null)} onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-loupe-media")) e.preventDefault(); }}
        onContextMenu={(e) => { const p = pt(e); const n = pick(getDoc(), p.x, p.y); if (n && !getUi().selLayers.includes(n.id)) PA.selectLayer(n.id); const target = n ?? undefined;
          openContextMenu(e, target ? [{ label: "Duplicate", onSelect: () => PA.duplicateLayer(target.id) }, { label: "Group selected", onSelect: PA.addGroup }, { sep: true }, { label: "Bring forward", onSelect: () => PA.reorderLayer(target.id, 1) }, { label: "Send backward", onSelect: () => PA.reorderLayer(target.id, -1) }, { label: target.locked ? "Unlock" : "Lock", onSelect: () => PA.patchNode(target.id, { locked: !target.locked }) }, { label: target.visible ? "Hide" : "Show", onSelect: () => PA.patchNode(target.id, { visible: !target.visible }) }, { sep: true }, { label: "Delete", shortcut: "Del", danger: true, onSelect: PA.deleteSelection }]
            : [{ label: "Fit to window", onSelect: () => vp.fit() }, { label: "Select all layers", onSelect: PA.selectAll }]); }}
        onDoubleClick={() => { if (node?.kind === "text") { setUi({ inspectorTab: "Text" }); setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[aria-label='Text content']")?.focus(), 30); } }}
        onDrop={(e) => { const id = e.dataTransfer.getData("application/x-loupe-media"); if (id && getDoc().media[id]?.kind === "image") { e.preventDefault(); addImageLayer(id); } }}>
        <div className="vp-content" style={{ width: P.width, height: P.height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="checker" style={{ backgroundSize: `${16 / zoom}px ${16 / zoom}px` }} />
          <canvas ref={cv} aria-label="Image canvas" style={{ width: P.width, height: P.height, imageRendering: zoom > 3 ? "pixelated" : "auto" }} />
          {sel?.kind === "mask" && <SelOverlay sel={sel} w={P.width} h={P.height} />}
          <div className="frame" />
          <svg width={P.width} height={P.height}>
            {maskEdit && <rect x={0} y={0} width={P.width} height={P.height} fill="none" stroke="var(--accent)" strokeWidth={2 / zoom} strokeDasharray={`${8 / zoom} ${5 / zoom}`} />}
            {box && tool === "move" && <Handles box={box} zoom={zoom} onDown={handle} />}
            {sel && sel.kind !== "mask" && selShape(sel, "sel")}{sel && sel.kind === "mask" && <rect x={sel.x} y={sel.y} width={sel.w} height={sel.h} fill="none" stroke="rgba(255,255,255,.5)" strokeWidth={sw} strokeDasharray={`${4 / zoom} ${4 / zoom}`} />}{draft && selShape({ ...draft, kind: draft.kind === "ellipse" ? "ellipse" : "rect" }, "draft", false)}
            {crop && <g><path fillRule="evenodd" fill="rgba(0,0,0,.6)" d={`M0 0H${P.width}V${P.height}H0Z M${crop.x} ${crop.y}h${crop.w}v${crop.h}h${-crop.w}Z`} />
              <g className="hit"><rect x={crop.x} y={crop.y} width={crop.w} height={crop.h} fill="transparent" stroke="#fff" strokeWidth={sw} style={{ cursor: "move" }} onPointerDown={(e) => cropDrag(e, "move")} />
                <path d={`M${crop.x + crop.w / 3} ${crop.y}v${crop.h}M${crop.x + (crop.w * 2) / 3} ${crop.y}v${crop.h}M${crop.x} ${crop.y + crop.h / 3}h${crop.w}M${crop.x} ${crop.y + (crop.h * 2) / 3}h${crop.w}`} stroke="rgba(255,255,255,.35)" strokeWidth={sw} fill="none" style={{ pointerEvents: "none" }} />
                {ch.map(([k, x, y]) => <rect key={k} x={x - hs / 2} y={y - hs / 2} width={hs} height={hs} fill="#e7e9ea" stroke="var(--accent)" strokeWidth={sw} style={{ cursor: `${k === "nw" || k === "se" ? "nwse" : k === "ne" || k === "sw" ? "nesw" : k === "n" || k === "s" ? "ns" : "ew"}-resize` }} onPointerDown={(e) => cropDrag(e, k)} />)}</g></g>}
            <Guides x={guides.x} y={guides.y} w={P.width} h={P.height} zoom={zoom} />
            {showBrush && <circle cx={hover.x} cy={hover.y} r={brush.size / 2} fill="none" stroke="#fff" strokeWidth={sw} style={{ mixBlendMode: "difference" }} />}
          </svg>
        </div>
        {rulers && <div className="rulers" aria-hidden="true"><svg className="rh" width="100%" height="18">{xs.map((v) => <g key={v}><line x1={v * zoom + pan.x} x2={v * zoom + pan.x} y1={9} y2={18} stroke="#4b535b" /><text x={v * zoom + pan.x + 3} y={11} fontSize={9} fill="#7d858d" fontFamily="monospace">{v}</text></g>)}</svg>
          <svg className="rv" width="18" height="100%">{ys.map((v) => <g key={v}><line y1={v * zoom + pan.y} y2={v * zoom + pan.y} x1={9} x2={18} stroke="#4b535b" /><text transform={`translate(10 ${v * zoom + pan.y + 3}) rotate(90)`} fontSize={9} fill="#7d858d" fontFamily="monospace">{v}</text></g>)}</svg><span className="corner" /></div>}
        {maskEdit && node && <div className="maskbadge" onPointerDown={(e) => e.stopPropagation()}><Icon name="mask" size={13} />Editing mask of “{node.name}”<IconButton icon="x" label="Stop editing mask" size="xs" onClick={() => setUi({ maskEdit: false, tool: "move" })} /></div>}
        {empty && <div className="empty-stage"><div className="empty-card"><Icon name="image" size={22} /><b>Open an image to start</b><span>Import a photo, or paint on a new layer.<br />Drop files here or drag from the media panel.</span><Btn primary onClick={onImport}><Icon name="import" size={14} />Import image</Btn></div></div>}
      </div>
      <div className="viewbar">
        <IconButton icon="minus" label="Zoom out" size="sm" onClick={() => vp.zoomBy(1 / 1.25)} /><span className="pct">{Math.round(zoom * 100)}%</span><IconButton icon="plus" label="Zoom in" size="sm" onClick={() => vp.zoomBy(1.25)} />
        <Btn sm className="ghost" onClick={vp.fit} tipLabel="Fit canvas to window" label="Fit">Fit</Btn><Btn sm className="ghost" onClick={vp.actual} tipLabel="Actual size">100%</Btn>
        <span className="sp" /><IconButton icon="rulers" label="Rulers" pressed={rulers} onClick={() => setUi({ rulers: !rulers })} /><IconButton icon="magnet" label="Snap to guides" pressed={snapOn} onClick={() => setUi({ snapping: !snapOn })} />
      </div>
    </section>
  );
}
