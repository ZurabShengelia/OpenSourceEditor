export interface Histogram { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array; max: number }
const bump = (a: Uint32Array, i: number): void => { a[i] = (a[i] ?? 0) + 1; };
export function computeHistogram(d: Uint8ClampedArray): Histogram {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), luma = new Uint32Array(256);
  for (let i = 0; i + 3 < d.length; i += 4) {
    if ((d[i + 3] ?? 0) === 0) continue;
    const R = d[i] ?? 0, G = d[i + 1] ?? 0, B = d[i + 2] ?? 0;
    bump(r, R); bump(g, G); bump(b, B); bump(luma, Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B));
  }
  let max = 1; for (let i = 1; i < 255; i++) max = Math.max(max, r[i] ?? 0, g[i] ?? 0, b[i] ?? 0);
  return { r, g, b, luma, max };
}
