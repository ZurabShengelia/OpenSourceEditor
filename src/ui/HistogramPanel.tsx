import { useEffect, useRef } from "react";
import { player } from "../app/engine";
import { useDoc } from "../app/store";
import { computeHistogram } from "../editor/histogram";
import { renderPhoto } from "../render/compositor";

export function HistogramPanel() {
  const photo = useDoc((d) => d.photo); const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const id = window.setTimeout(() => {
      const off = document.createElement("canvas"); off.width = photo.width; off.height = photo.height; const ox = off.getContext("2d"); const cv = ref.current, ctx = cv?.getContext("2d"); if (!ox || !cv || !ctx) return;
      renderPhoto(ox, photo, player.resolver, null); const k = Math.min(1, 256 / Math.max(photo.width, photo.height)); const sm = document.createElement("canvas"); sm.width = Math.max(1, Math.round(photo.width * k)); sm.height = Math.max(1, Math.round(photo.height * k)); const sx = sm.getContext("2d", { willReadFrequently: true })!; sx.drawImage(off, 0, 0, sm.width, sm.height);
      const h = computeHistogram(sx.getImageData(0, 0, sm.width, sm.height).data); ctx.clearRect(0, 0, 256, 64); ctx.globalCompositeOperation = "lighter";
      for (const [arr, col] of [[h.r, "#a03a3a"], [h.g, "#3a9a4a"], [h.b, "#3a64b4"]] as const) { ctx.fillStyle = col; for (let i = 0; i < 256; i++) { const bh = Math.min(64, ((arr[i] ?? 0) / h.max) * 64); ctx.fillRect(i, 64 - bh, 1, bh); } }
      ctx.globalCompositeOperation = "source-over";
    }, 200); return () => window.clearTimeout(id);
  }, [photo]);
  return <canvas ref={ref} width={256} height={64} aria-label="Histogram of the flattened image (red, green, blue)" className="block h-16 w-full border border-line bg-bg" />;
}
