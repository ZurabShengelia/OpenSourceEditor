import { valueAt } from "../doc/keyframes";
import type { MediaRef, ProjectV2, TClip } from "../doc/schema";
import { clipDuration } from "../doc/compose";
import { textMetrics } from "../doc/text";
import { lineWidth } from "../render/compositor";

export interface Box { cx: number; cy: number; w: number; h: number; rot: number }
let measure: CanvasRenderingContext2D | null = null;
export function textSize(p: NonNullable<TClip["text"]>): { w: number; h: number } {
  measure ??= document.createElement("canvas").getContext("2d");
  const m = textMetrics(p), lines = p.text.split("\n"); if (measure) measure.font = `${p.italic ? "italic " : ""}${p.weight} ${p.size}px ${p.font}`;
  const width = (l: string): number => (measure ? lineWidth(measure, l, m.tracking) : l.length * p.size * 0.6);
  return { w: Math.max(8, ...lines.map(width)) + p.outline * 2, h: lines.length * p.size * m.lineHeight };
}
export function clipBox(doc: ProjectV2, c: TClip, t: number): Box | null {
  const W = doc.video.width, H = doc.video.height, lt = Math.min(Math.max(t - c.start, 0), clipDuration(c));
  const x = valueAt(c, "x", lt), y = valueAt(c, "y", lt), s = valueAt(c, "scale", lt), rot = valueAt(c, "rotation", lt);
  let w: number, h: number, ox = 0, oy = 0;
  if (c.type === "text" && c.text) { ({ w, h } = textSize(c.text)); }
  else { const m: Pick<MediaRef, "width" | "height"> | undefined = c.type === "compound" ? { width: W, height: H } : c.mediaId ? doc.media[c.mediaId] : undefined; if (!m?.width || !m.height) return null;
    const fit = Math.min(W / m.width, H / m.height), fw = m.width * fit, fh = m.height * fit; w = fw * (1 - c.crop.l - c.crop.r); h = fh * (1 - c.crop.t - c.crop.b); ox = ((c.crop.l - c.crop.r) / 2) * fw; oy = ((c.crop.t - c.crop.b) / 2) * fh; }
  const a = (rot * Math.PI) / 180, rx = (ox * Math.cos(a) - oy * Math.sin(a)) * s, ry = (ox * Math.sin(a) + oy * Math.cos(a)) * s;
  return { cx: W / 2 + x * W + rx, cy: H / 2 + y * H + ry, w: w * s, h: h * s, rot };
}
export const rotatePoint = (px: number, py: number, deg: number): [number, number] => { const a = (deg * Math.PI) / 180; return [px * Math.cos(a) - py * Math.sin(a), px * Math.sin(a) + py * Math.cos(a)]; };
