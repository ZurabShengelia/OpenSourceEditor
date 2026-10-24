import { useEffect, useRef } from "react";
import type { Peaks } from "../editor/waveform";
import { PEAK_RATE } from "../editor/waveform";

export function Waveform({ peaks, srcStart, srcEnd, width, height, color = "rgba(255,255,255,.55)" }: { peaks: Peaks; srcStart: number; srcEnd: number; width: number; height: number; color?: string }) {
  const ref = useRef<HTMLCanvasElement>(null); const w = Math.max(1, Math.min(4000, Math.round(width)));
  useEffect(() => {
    const c = ref.current; if (!c) return; const x = c.getContext("2d"); if (!x) return; x.clearRect(0, 0, c.width, c.height); x.fillStyle = color;
    for (let px = 0; px < w; px++) { const a = Math.floor((srcStart + ((srcEnd - srcStart) * px) / w) * PEAK_RATE), b = Math.max(a + 1, Math.floor((srcStart + ((srcEnd - srcStart) * (px + 1)) / w) * PEAK_RATE)); let m = 0; for (let i = a; i < b && i < peaks.data.length; i++) m = Math.max(m, peaks.data[i] ?? 0); const hh = Math.max(1, m * height); x.fillRect(px, (height - hh) / 2, 1, hh); }
  }, [peaks, srcStart, srcEnd, w, height, color]);
  return <canvas ref={ref} width={w} height={height} style={{ width: "100%", height }} aria-hidden="true" />;
}
