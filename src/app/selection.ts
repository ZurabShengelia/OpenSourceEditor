
export interface MaskSel { mask: Uint8Array; w: number; h: number; x: number; y: number; bw: number; bh: number; count: number }
export type CombineMode = "replace" | "add" | "subtract" | "intersect";

export function magicWand(d: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol: number, contiguous: boolean): Uint8Array {
  const mask = new Uint8Array(w * h); sx = Math.floor(sx); sy = Math.floor(sy); if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const i0 = (sy * w + sx) * 4, r = d[i0]!, g = d[i0 + 1]!, b = d[i0 + 2]!, a = d[i0 + 3]!;
  const near = (i: number): boolean => Math.abs(d[i]! - r) <= tol && Math.abs(d[i + 1]! - g) <= tol && Math.abs(d[i + 2]! - b) <= tol && Math.abs(d[i + 3]! - a) <= tol;
  if (!contiguous) { for (let p = 0; p < w * h; p++) if (near(p * 4)) mask[p] = 1; return mask; }
  const ok = (x: number, y: number): boolean => !mask[y * w + x] && near((y * w + x) * 4), stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!; let x = x0; while (x >= 0 && ok(x, y)) x--; x++;
    let up = false, dn = false;
    while (x < w && ok(x, y)) {
      mask[y * w + x] = 1;
      if (y > 0) { const o = ok(x, y - 1); if (o && !up) stack.push(x, y - 1); up = o; }
      if (y < h - 1) { const o = ok(x, y + 1); if (o && !dn) stack.push(x, y + 1); dn = o; }
      x++;
    }
  }
  return mask;
}

export function combine(a: Uint8Array | null, b: Uint8Array, mode: CombineMode): Uint8Array {
  if (!a || mode === "replace") return b;
  const o = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) o[i] = mode === "add" ? (a[i]! | b[i]!) : mode === "subtract" ? (a[i]! & (b[i]! ^ 1)) : (a[i]! & b[i]!);
  return o;
}
export function invert(m: Uint8Array): Uint8Array { const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i]! ^ 1; return o; }

export function describe(mask: Uint8Array, w: number, h: number): MaskSel | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return n ? { mask, w, h, x: x0, y: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1, count: n } : null;
}

export function maskToRects(mask: Uint8Array, w: number, h: number): number[] {
  const out: number[] = []; let prev = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    const cur = new Map<number, number>(); let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) { x++; continue; }
      const s = x; while (x < w && mask[y * w + x]) x++;
      const key = s * 65536 + (x - s), open = prev.get(key);
      if (open !== undefined) { out[open + 3]! += 1; cur.set(key, open); } else { cur.set(key, out.length); out.push(s, y, x - s, 1); }
    }
    prev = cur;
  }
  return out;
}

export function shapeMask(kind: "rect" | "ellipse", rx: number, ry: number, rw: number, rh: number, w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h), cx = rx + rw / 2, cy = ry + rh / 2, a = rw / 2, b = rh / 2;
  const y0 = Math.max(0, Math.floor(ry)), y1 = Math.min(h - 1, Math.ceil(ry + rh)), x0 = Math.max(0, Math.floor(rx)), x1 = Math.min(w - 1, Math.ceil(rx + rw));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5; if (px < rx || px > rx + rw || py < ry || py > ry + rh) continue;
    if (kind === "rect" || (a > 0 && b > 0 && ((px - cx) / a) ** 2 + ((py - cy) / b) ** 2 <= 1)) m[y * w + x] = 1;
  }
  return m;
}
