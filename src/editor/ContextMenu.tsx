import { useEffect, useRef, useState } from "react";
import { MenuItems, menuKeys, type MenuItem } from "./Menu";

interface Open { x: number; y: number; items: MenuItem[] }
let show: ((o: Open | null) => void) | null = null;
export function openContextMenu(e: { preventDefault(): void; stopPropagation(): void; clientX: number; clientY: number }, items: MenuItem[]): void {
  e.preventDefault(); e.stopPropagation(); show?.({ x: e.clientX, y: e.clientY, items });
}

export function ContextMenuHost() {
  const [o, setO] = useState<Open | null>(null); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    show = setO; const close = (): void => setO(null); const key = (e: KeyboardEvent): void => { if (e.key === "Escape") close(); };
    window.addEventListener("pointerdown", close); window.addEventListener("keydown", key); window.addEventListener("blur", close); window.addEventListener("resize", close);
    return () => { show = null; window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", key); window.removeEventListener("blur", close); window.removeEventListener("resize", close); };
  }, []);
  useEffect(() => { if (o) ref.current?.focus(); }, [o]);
  if (!o) return null;
  const h = o.items.reduce((n, it) => n + ("sep" in it ? 9 : "heading" in it ? 24 : 26), 8);
  const x = Math.max(4, Math.min(o.x, window.innerWidth - 220)), y = Math.max(4, Math.min(o.y, window.innerHeight - h - 8));
  return <div ref={ref} tabIndex={-1} role="menu" className="menu fixed" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} onKeyDown={(e) => menuKeys(e, ref.current)}><MenuItems items={o.items} close={() => setO(null)} /></div>;
}
