import { useCallback, useState, type KeyboardEvent, type PointerEvent } from "react";

export function useSize(key: string, init: number, min: number, max: number): [number, (v: number | ((p: number) => number)) => void] {
  const [size, set] = useState(() => { try { const v = Number(localStorage.getItem(key)); return v >= min && v <= max ? v : init; } catch { return init; } });
  const setSize = useCallback((v: number | ((p: number) => number)) => set((p) => {
    const n = Math.round(Math.min(max, Math.max(min, typeof v === "function" ? v(p) : v)));
    try { localStorage.setItem(key, String(n)); } catch { }
    return n;
  }), [key, min, max]);
  return [size, setSize];
}

export function Splitter({ dir, onDrag, onReset, label }: { dir: "v" | "h"; onDrag: (delta: number) => void; onReset?: () => void; label: string }) {
  const [active, setActive] = useState(false);
  const down = (e: PointerEvent<HTMLDivElement>): void => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId); setActive(true); let last = dir === "v" ? e.clientX : e.clientY;
    const move = (ev: globalThis.PointerEvent): void => { const p = dir === "v" ? ev.clientX : ev.clientY; onDrag(p - last); last = p; };
    const up = (): void => { setActive(false); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
  };
  const key = (e: KeyboardEvent): void => {
    const k = dir === "v" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"]; const i = k.indexOf(e.key);
    if (i >= 0) { e.preventDefault(); e.stopPropagation(); onDrag((i === 0 ? -1 : 1) * (e.shiftKey ? 4 : 16)); }
  };
  return <div role="separator" aria-orientation={dir === "v" ? "vertical" : "horizontal"} aria-label={label} tabIndex={0} onPointerDown={down} onKeyDown={key} onDoubleClick={onReset} className={`split ${dir} ${active ? "on" : ""}`} />;
}
