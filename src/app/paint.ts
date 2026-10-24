export type RGBA = [number, number, number, number];
export function hexToRgba(hex: string, a = 255): RGBA { const h = hex.replace("#", ""); const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0"); return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16), a]; }
export const rgbaToHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function floodFill(d: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, fill: RGBA, tol: number, inside?: (x: number, y: number) => boolean): number {
  sx = Math.floor(sx); sy = Math.floor(sy); if (sx < 0 || sy < 0 || sx >= w || sy >= h) return 0;
  const i0 = (sy * w + sx) * 4, t: RGBA = [d[i0]!, d[i0 + 1]!, d[i0 + 2]!, d[i0 + 3]!];
  const match = (i: number): boolean => Math.abs(d[i]! - t[0]) <= tol && Math.abs(d[i + 1]! - t[1]) <= tol && Math.abs(d[i + 2]! - t[2]) <= tol && Math.abs(d[i + 3]! - t[3]) <= tol;
  const seen = new Uint8Array(w * h), stack: number[] = [sx, sy]; let n = 0;
  const ok = (x: number, y: number): boolean => !seen[y * w + x] && match((y * w + x) * 4) && (!inside || inside(x, y));
  if (!ok(sx, sy)) return 0;
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!; let x = x0; while (x >= 0 && ok(x, y)) x--; x++;
    let up = false, dn = false;
    while (x < w && ok(x, y)) {
      const p = y * w + x; seen[p] = 1; const i = p * 4; d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3]; n++;
      if (y > 0) { const o = ok(x, y - 1); if (o && !up) stack.push(x, y - 1); up = o; }
      if (y < h - 1) { const o = ok(x, y + 1); if (o && !dn) stack.push(x, y + 1); dn = o; }
      x++;
    }
  }
  return n;
}

export interface BrushOpts { size: number; hardness: number; color: string }
export function stampPoints(a: { x: number; y: number }, b: { x: number; y: number }, size: number, carry = 0): { pts: { x: number; y: number }[]; carry: number } {
  const step = Math.max(1, size * 0.25), dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy), pts: { x: number; y: number }[] = [];
  let d = step - carry; while (d <= len) { pts.push({ x: a.x + (dx * d) / len, y: a.y + (dy * d) / len }); d += step; }
  return { pts, carry: len - (d - step) };
}
export function stamp(ctx: CanvasRenderingContext2D, x: number, y: number, o: BrushOpts): void {
  const r = o.size / 2;
  if (o.hardness >= 0.99) { ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); return; }
  const g = ctx.createRadialGradient(x, y, r * o.hardness, x, y, r), [R, G, B] = hexToRgba(o.color);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`); g.addColorStop(1, `rgba(${R},${G},${B},0)`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, o.size, o.size);
}
