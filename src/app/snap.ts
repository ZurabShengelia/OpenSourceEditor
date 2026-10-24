export interface Rect { l: number; t: number; r: number; b: number }
export interface RBox { cx: number; cy: number; w: number; h: number; rot: number }
export interface Targets { x: number[]; y: number[] }
export interface SnapResult { dx: number; dy: number; gx: number[]; gy: number[] }
export type AlignEdge = "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom";

export function rectOf(b: RBox): Rect {
  const a = (b.rot * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), hw = (b.w * c + b.h * s) / 2, hh = (b.w * s + b.h * c) / 2;
  return { l: b.cx - hw, r: b.cx + hw, t: b.cy - hh, b: b.cy + hh };
}
export function targetsFor(W: number, H: number, others: readonly Rect[], extra: Partial<Targets> = {}): Targets {
  const x = [0, W / 2, W, ...(extra.x ?? [])], y = [0, H / 2, H, ...(extra.y ?? [])];
  for (const o of others) { x.push(o.l, (o.l + o.r) / 2, o.r); y.push(o.t, (o.t + o.b) / 2, o.b); }
  return { x, y };
}
function axis(cands: number[], delta: number, targets: number[], radius: number): { d: number; guides: number[] } {
  let best: number | null = null;
  for (const c of cands) for (const t of targets) { const diff = t - (c + delta); if (Math.abs(diff) <= radius && (best === null || Math.abs(diff) < Math.abs(best))) best = diff; }
  if (best === null) return { d: delta, guides: [] };
  const d = delta + best, guides: number[] = [];
  for (const c of cands) for (const t of targets) if (Math.abs(c + d - t) < 0.5 && !guides.some((g) => Math.abs(g - t) < 0.5)) guides.push(t);
  return { d, guides };
}
export function snapMove(r: Rect, dx: number, dy: number, t: Targets, radius: number): SnapResult {
  const X = axis([r.l, (r.l + r.r) / 2, r.r], dx, t.x, radius), Y = axis([r.t, (r.t + r.b) / 2, r.b], dy, t.y, radius);
  return { dx: X.d, dy: Y.d, gx: X.guides, gy: Y.guides };
}
export function alignDelta(r: Rect, edge: AlignEdge, W: number, H: number): { dx: number; dy: number } {
  switch (edge) {
    case "left": return { dx: -r.l, dy: 0 }; case "right": return { dx: W - r.r, dy: 0 }; case "hcenter": return { dx: W / 2 - (r.l + r.r) / 2, dy: 0 };
    case "top": return { dx: 0, dy: -r.t }; case "bottom": return { dx: 0, dy: H - r.b }; default: return { dx: 0, dy: H / 2 - (r.t + r.b) / 2 };
  }
}
export function fitAspect(W: number, H: number, ratio: number): { x: number; y: number; w: number; h: number } {
  let w = W, h = W / ratio; if (h > H) { h = H; w = H * ratio; } return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
export const safeLines = (W: number, H: number, frac: number): Targets => ({ x: [W * (1 - frac) / 2, W * (1 + frac) / 2], y: [H * (1 - frac) / 2, H * (1 + frac) / 2] });
export const ACTION_SAFE = 0.93, TITLE_SAFE = 0.9;
