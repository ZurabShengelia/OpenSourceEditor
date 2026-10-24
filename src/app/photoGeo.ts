import type { GroupNode, LayerNode, PhotoDoc, ProjectV2 } from "../doc/schema";
import { textSize } from "./geometry";

export function nodeSize(n: LayerNode, doc: ProjectV2): { w: number; h: number } | null {
  const P = doc.photo;
  switch (n.kind) {
    case "image": { const m = doc.media[n.mediaId]; return m?.width && m.height ? { w: m.width, h: m.height } : null; }
    case "paint": return { w: P.width, h: P.height };
    case "text": return textSize(n.props);
    case "shape": return { w: n.w + n.strokeWidth, h: n.kind === "shape" && n.shape === "line" ? Math.max(10, n.strokeWidth * 2) : n.h + n.strokeWidth };
    case "group": return n.children.some((c) => c.kind !== "adjustment") ? { w: P.width, h: P.height } : null;
    default: return null;
  }
}
export interface PBox { cx: number; cy: number; w: number; h: number; rot: number }
export function nodeBox(n: LayerNode, doc: ProjectV2): PBox | null {
  const s = nodeSize(n, doc); if (!s) return null; const P = doc.photo;
  return { cx: P.width / 2 + n.x, cy: P.height / 2 + n.y, w: s.w * n.scale, h: s.h * n.scale, rot: n.rotation };
}
export function hit(b: PBox, px: number, py: number): boolean {
  const a = (-b.rot * Math.PI) / 180, dx = px - b.cx, dy = py - b.cy, x = dx * Math.cos(a) - dy * Math.sin(a), y = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(x) <= b.w / 2 && Math.abs(y) <= b.h / 2;
}
export function pick(doc: ProjectV2, px: number, py: number): LayerNode | null {
  const test = (g: GroupNode): LayerNode | null => {
    for (let i = g.children.length - 1; i >= 0; i--) { const n = g.children[i]!; if (!n.visible || n.locked) continue;
      if (n.kind === "group") { if (test(n)) return n; continue; } const b = nodeBox(n, doc); if (b && hit(b, px, py)) return n; }
    return null;
  };
  return test(doc.photo.root);
}
export const canvasPoint = (P: PhotoDoc, clientX: number, clientY: number, rect: DOMRect): { x: number; y: number } => ({ x: ((clientX - rect.left) / rect.width) * P.width, y: ((clientY - rect.top) / rect.height) * P.height });
