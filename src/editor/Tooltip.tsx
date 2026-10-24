import { useEffect, useState } from "react";

interface Tip { x: number; y: number; label: string; key?: string; side: "bottom" | "right" | "top" }
export function TooltipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer = 0, cur: Element | null = null, last = 0;
    const hide = (): void => { window.clearTimeout(timer); cur = null; setTip(null); };
    const over = (e: PointerEvent): void => {
      const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null; if (el === cur) return; hide(); if (!el) return; cur = el;
      timer = window.setTimeout(() => { const r = el.getBoundingClientRect(), label = el.getAttribute("data-tip") ?? ""; if (!label) return; const key = el.getAttribute("data-key") ?? undefined;
        const inRail = !!el.closest(".toolrail"), nearBottom = r.bottom > window.innerHeight - 60; last = performance.now();
        setTip(inRail ? { x: r.right + 8, y: r.top + r.height / 2, label, side: "right", ...(key ? { key } : {}) } : nearBottom ? { x: r.left + r.width / 2, y: r.top - 8, label, side: "top", ...(key ? { key } : {}) } : { x: r.left + r.width / 2, y: r.bottom + 8, label, side: "bottom", ...(key ? { key } : {}) }); }, performance.now() - last < 500 ? 0 : 420);
    };
    document.addEventListener("pointerover", over); document.addEventListener("pointerdown", hide, true); document.addEventListener("keydown", hide, true); window.addEventListener("blur", hide); window.addEventListener("wheel", hide, { passive: true });
    return () => { hide(); document.removeEventListener("pointerover", over); document.removeEventListener("pointerdown", hide, true); document.removeEventListener("keydown", hide, true); window.removeEventListener("blur", hide); window.removeEventListener("wheel", hide); };
  }, []);
  if (!tip) return null;
  const x = tip.side === "right" ? tip.x : Math.min(window.innerWidth - 90, Math.max(90, tip.x));
  const transform = tip.side === "right" ? "translateY(-50%)" : tip.side === "top" ? "translate(-50%, -100%)" : "translateX(-50%)";
  return <div className="tip" role="tooltip" style={{ left: x, top: tip.y, transform }}><span>{tip.label}</span>{tip.key && <span className="kbd">{tip.key}</span>}</div>;
}
