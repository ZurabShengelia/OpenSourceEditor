import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { rotatePoint } from "../app/geometry";
import type { RBox } from "../app/snap";
import type { View } from "../app/store";

const MIN = 0.02, MAX = 32;
export function useViewport(cw: number, ch: number, view: View, setView: (p: Partial<View>) => void, pad = 56) {
  const host = useRef<HTMLDivElement>(null); const [size, setSize] = useState({ w: 800, h: 500 }); const cur = useRef(view); cur.current = view;
  useLayoutEffect(() => { const el = host.current; if (!el) return; const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el); setSize({ w: el.clientWidth, h: el.clientHeight }); return () => ro.disconnect(); }, []);
  useEffect(() => { if (!view.fit) return; const z = Math.max(MIN, Math.min((size.w - pad) / cw, (size.h - pad) / ch)); setView({ zoom: z, pan: { x: (size.w - cw * z) / 2, y: (size.h - ch * z) / 2 } }); }, [view.fit, size.w, size.h, cw, ch]);
  const zoomTo = (nz: number, px = size.w / 2, py = size.h / 2): void => { const v = cur.current, z = Math.min(MAX, Math.max(MIN, nz)); setView({ fit: false, zoom: z, pan: { x: px - ((px - v.pan.x) / v.zoom) * z, y: py - ((py - v.pan.y) / v.zoom) * z } }); };
  useEffect(() => { const el = host.current; if (!el) return; const f = (e: WheelEvent): void => { e.preventDefault(); const v = cur.current, r = el.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomTo(v.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX - r.left, e.clientY - r.top); else setView({ fit: false, pan: { x: v.pan.x - e.deltaX, y: v.pan.y - e.deltaY } }); };
    el.addEventListener("wheel", f, { passive: false }); return () => el.removeEventListener("wheel", f); }, [size.w, size.h]);
  const panDrag = (e: React.PointerEvent): void => { const o = { ...cur.current.pan }, x0 = e.clientX, y0 = e.clientY; const mv = (ev: PointerEvent): void => setView({ fit: false, pan: { x: o.x + ev.clientX - x0, y: o.y + ev.clientY - y0 } }); const up = (): void => { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); }; window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); };
  return { host, size, zoomTo, panDrag, zoomBy: (k: number) => zoomTo(cur.current.zoom * k), actual: () => zoomTo(1), fit: () => setView({ fit: true }) };
}
export function useSpaceHeld(): boolean {
  const [s, set] = useState(false);
  useEffect(() => { const typing = (t: EventTarget | null): boolean => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
    const dn = (e: KeyboardEvent): void => { if (e.code === "Space" && !typing(e.target)) set(true); }; const up = (e: KeyboardEvent): void => { if (e.code === "Space") set(false); }; const bl = (): void => set(false);
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up); window.addEventListener("blur", bl); return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); window.removeEventListener("blur", bl); }; }, []);
  return s;
}

export type HandleMode = "move" | "scale" | "rotate";
export function Handles({ box, zoom, onDown }: { box: RBox; zoom: number; onDown: (e: React.PointerEvent, m: HandleMode) => void }) {
  const hs = 8 / zoom, sw = 1 / zoom; const pts = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => { const [rx, ry] = rotatePoint((sx * box.w) / 2, (sy * box.h) / 2, box.rot); return [box.cx + rx, box.cy + ry] as const; });
  const [tx, ty] = rotatePoint(0, -box.h / 2, box.rot), [kx, ky] = rotatePoint(0, -box.h / 2 - 22 / zoom, box.rot);
  return (
    <g className="hit">
      <polygon points={pts.map((p) => p.join(",")).join(" ")} fill="transparent" stroke="var(--accent)" strokeWidth={sw} style={{ cursor: "move" }} onPointerDown={(e) => onDown(e, "move")} />
      <line x1={box.cx + tx} y1={box.cy + ty} x2={box.cx + kx} y2={box.cy + ky} stroke="var(--accent)" strokeWidth={sw} />
      <circle cx={box.cx + kx} cy={box.cy + ky} r={hs * 0.65} fill="#e7e9ea" stroke="var(--accent)" strokeWidth={sw} style={{ cursor: "grab" }} onPointerDown={(e) => onDown(e, "rotate")}><title>Rotate (Shift: 15° steps)</title></circle>
      {pts.map((c, i) => <rect key={i} x={c[0] - hs / 2} y={c[1] - hs / 2} width={hs} height={hs} fill="#e7e9ea" stroke="var(--accent)" strokeWidth={sw} style={{ cursor: i % 2 ? "nesw-resize" : "nwse-resize" }} onPointerDown={(e) => onDown(e, "scale")}><title>Scale</title></rect>)}
    </g>
  );
}
export function Guides({ x, y, w, h, zoom }: { x: number[]; y: number[]; w: number; h: number; zoom: number }) {
  return <g>{x.map((v) => <line key={`x${v}`} x1={v} x2={v} y1={-4000} y2={h + 4000} stroke="#e26d9a" strokeWidth={1 / zoom} />)}{y.map((v) => <line key={`y${v}`} y1={v} y2={v} x1={-4000} x2={w + 4000} stroke="#e26d9a" strokeWidth={1 / zoom} />)}</g>;
}
