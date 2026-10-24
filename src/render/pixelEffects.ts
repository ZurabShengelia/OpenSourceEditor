import type { Filters } from "../editor/effects";
type Cv = OffscreenCanvas | HTMLCanvasElement;
type Cx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n);
const mk = (w: number, h: number): Cv => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
const cx = (c: Cv): Cx => c.getContext("2d", { willReadFrequently: true }) as Cx;

export function toneLut(sh: number, hl: number, bl: number, wh: number): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const y = x + 0.3 * (sh / 100) * (1 - x) ** 2 * x * 2 + 0.3 * (hl / 100) * x ** 2 * (1 - x) * 2 + 0.2 * (bl / 100) * (1 - x) ** 6 + 0.2 * (wh / 100) * x ** 6;
    lut[i] = clamp(Math.round(y * 255));
  }
  return lut;
}
export const hash = (x: number, y: number): number => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

const freePool: Cv[] = [];
export function acquireScratch(w: number, h: number): Cv {
  const i = freePool.findIndex((c) => c.width === w && c.height === h); if (i >= 0) { const c = freePool.splice(i, 1)[0]!; cx(c).clearRect(0, 0, w, h); return c; }
  if (freePool.length > 6) freePool.shift(); const c = mk(w, h); cx(c); return c;
}
export const releaseScratch = (c: Cv): void => { if (freePool.length < 8) { const x = cx(c); x.setTransform(1, 0, 0, 1, 0, 0); x.filter = "none"; x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; freePool.push(c); } };

let grainMap: Float64Array | null = null, grainKey = "";
function grainField(w: number, h: number): Float64Array | null {
  if (w * h > 2_400_000) return null; const key = `${w}x${h}`;
  if (key !== grainKey || !grainMap) { const m = new Float64Array(w * h); for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) m[i] = (hash(x, y) - 0.5) * 70; grainMap = m; grainKey = key; }
  return grainMap;
}
export function processPixels(d: Uint8ClampedArray, w: number, h: number, f: Filters): void {
  const lut = f.highlights || f.shadows || f.whites || f.blacks ? toneLut(f.shadows, f.highlights, f.blacks, f.whites) : null;
  const gr = 1 + f.temperature / 400, gg = 1 - f.tint / 400, gb = 1 - f.temperature / 400, vin = f.vignette / 100, film = f.film / 100, vint = f.vintage / 100;
  const tr = new Float64Array(256), tg = new Float64Array(256), tb = new Float64Array(256); for (let v = 0; v < 256; v++) { const t = lut ? lut[v]! : v; tr[v] = t * gr; tg[v] = t * gg; tb[v] = t * gb; }
  const simple = !vint && !vin && !film; const cxm = w / 2, cym = h / 2, maxd = Math.hypot(cxm, cym);
  let dx2: Float64Array | null = null; if (vin) { dx2 = new Float64Array(w); for (let x = 0; x < w; x++) dx2[x] = (x - cxm) * (x - cxm); }
  const grain = film ? grainField(w, h) : null;
  if (simple) { for (let i = 0, n = w * h * 4; i < n; i += 4) { if (d[i + 3] === 0) continue; d[i] = tr[d[i]!]!; d[i + 1] = tg[d[i + 1]!]!; d[i + 2] = tb[d[i + 2]!]!; } return; }
  for (let py = 0, i = 0; py < h; py++) { const dy2 = (py - cym) * (py - cym); for (let px = 0; px < w; px++, i += 4) {
    if (d[i + 3] === 0) continue;
    let r = tr[d[i]!]!, g = tg[d[i + 1]!]!, b = tb[d[i + 2]!]!;
    if (vint) { const nr = 0.393 * r + 0.769 * g + 0.189 * b, ng = 0.349 * r + 0.686 * g + 0.168 * b, nb = 0.272 * r + 0.534 * g + 0.131 * b; r += (nr - r) * vint * 0.8 + 18 * vint; g += (ng - g) * vint * 0.8 + 12 * vint; b += (nb - b) * vint * 0.8 + 6 * vint; }
    if (vin) { const k = 1 - vin * Math.max(0, Math.sqrt(dx2![px]! + dy2) / maxd - 0.35) * 1.8; const m = k < 0 ? 0 : k; r *= m; g *= m; b *= m; }
    if (film) { const nz = (grain ? grain[py * w + px]! : (hash(px, py) - 0.5) * 70) * film; r += nz; g += nz; b += nz; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  } }
}

export function applyPixelEffects(c: Cv, f: Filters): void {
  const w = c.width, h = c.height; if (!w || !h) return; const x = cx(c);
  if (f.glow > 0) {
    const t = acquireScratch(w, h), tx = cx(t); tx.filter = `blur(${Math.max(2, Math.round(Math.max(w, h) / 60))}px) brightness(1.3)`; tx.drawImage(c as CanvasImageSource, 0, 0);
    x.save(); x.globalCompositeOperation = "screen"; x.globalAlpha = Math.min(1, f.glow / 100); x.drawImage(t as CanvasImageSource, 0, 0); x.restore(); releaseScratch(t);
  }
  const needs = f.sharpen || f.temperature || f.tint || f.highlights || f.shadows || f.whites || f.blacks || f.vignette || f.film || f.vintage || f.distortion || f.chromatic;
  if (!needs) return;
  let img = x.getImageData(0, 0, w, h);
  if (f.distortion) img = distort(img, f.distortion / 100);
  if (f.chromatic) img = chroma(img, (f.chromatic / 100) * Math.max(1, w / 120));
  if (f.sharpen) img = sharpen(img, f.sharpen / 100);
  if (f.highlights || f.shadows || f.whites || f.blacks || f.temperature || f.tint || f.vignette || f.film || f.vintage) processPixels(img.data, w, h, f);
  x.putImageData(img, 0, 0);
}
function sharpen(img: ImageData, amount: number): ImageData {
  const { width: w, height: h } = img, d = img.data, a = amount * 1.5; if (w < 3 || h < 3) return img;
  const stride = w * 4; let up = d.slice(0, stride), cur = d.slice(stride, 2 * stride), nxt = new Uint8ClampedArray(stride);
  for (let y = 1; y < h - 1; y++) {
    nxt.set(d.subarray((y + 1) * stride, (y + 2) * stride)); const row = y * stride;
    for (let x = 1; x < w - 1; x++) {
      const i = x * 4, o = row + i;
      let v = cur[i]!; d[o] = v + (v - (cur[i - 4]! + cur[i + 4]! + up[i]! + nxt[i]!) / 4) * a;
      v = cur[i + 1]!; d[o + 1] = v + (v - (cur[i - 3]! + cur[i + 5]! + up[i + 1]! + nxt[i + 1]!) / 4) * a;
      v = cur[i + 2]!; d[o + 2] = v + (v - (cur[i - 2]! + cur[i + 6]! + up[i + 2]! + nxt[i + 2]!) / 4) * a;
    }
    const t = up; up = cur; cur = nxt; nxt = t;
  }
  return img;
}
function chroma(img: ImageData, px: number): ImageData {
  const { width: w, height: h } = img, d = img.data, k = Math.round(px), row = new Uint8ClampedArray(w * 4);
  for (let y = 0; y < h; y++) {
    const o = y * w * 4; row.set(d.subarray(o, o + w * 4));
    for (let x = 0; x < w; x++) { const i = o + x * 4; d[i] = row[Math.min(w - 1, x + k) * 4]!; d[i + 2] = row[Math.max(0, x - k) * 4 + 2]!; }
  }
  return img;
}
let distortBuf = new Uint8ClampedArray(0);
const DIST_CACHE_MAX_PIXELS = 2_400_000; let distMap: Int32Array | null = null, distKey = "";
const distSrc = (x: number, y: number, w: number, h: number, k: number): number => {
  const nx = (x / w) * 2 - 1, ny = (y / h) * 2 - 1, r2 = nx * nx + ny * ny, f = 1 + k * r2 * 0.6;
  const sx = Math.round(((nx * f + 1) / 2) * w), sy = Math.round(((ny * f + 1) / 2) * h); return sx < 0 || sy < 0 || sx >= w || sy >= h ? -1 : sy * w + sx;
};
function distort(src: ImageData, k: number): ImageData {
  const { width: w, height: h } = src, s = src.data, n = w * h; if (distortBuf.length !== n * 4) distortBuf = new Uint8ClampedArray(n * 4);
  const o = distortBuf, out = new ImageData(o, w, h);
  if (n <= DIST_CACHE_MAX_PIXELS && s.byteOffset % 4 === 0) {
    const key = `${w}x${h}|${k}`; if (key !== distKey || !distMap || distMap.length !== n) { distMap = new Int32Array(n); for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) distMap[i] = distSrc(x, y, w, h, k); distKey = key; }
    const s32 = new Uint32Array(s.buffer, s.byteOffset, n), o32 = new Uint32Array(o.buffer, o.byteOffset, n), m = distMap;
    for (let i = 0; i < n; i++) { const j = m[i]!; o32[i] = j < 0 ? 0 : s32[j]!; }
    return out;
  }
  o.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const j = distSrc(x, y, w, h, k); if (j < 0) continue; const i = (y * w + x) * 4, q = j * 4; o[i] = s[q]!; o[i + 1] = s[q + 1]!; o[i + 2] = s[q + 2]!; o[i + 3] = s[q + 3]!; }
  return out;
}

export const sharpenForTest = sharpen; export const chromaForTest = chroma; export const distortForTest = distort;
