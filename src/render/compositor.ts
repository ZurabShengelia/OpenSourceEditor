import { compoundView, evaluateFrame, type DrawItem } from "../doc/compose";
import type { AdjustKind, AdjustmentLayer, GroupNode, LayerNode, PhotoDoc, TextProps, VideoDoc } from "../doc/schema";
import { textMetrics } from "../doc/text";
import { filterCss, hasPixelEffects, type Filters } from "../editor/effects";
import { acquireScratch, applyPixelEffects, releaseScratch } from "./pixelEffects";

export type Source = CanvasImageSource & { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number };
export interface Resolver {
  media(id: string, sourceTime: number, clipId?: string): Source | null;
  mask(id: string): Source | null;
}
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const dims = (s: Source): [number, number] => [s.videoWidth || s.naturalWidth || (s.width as number) || 1, s.videoHeight || s.naturalHeight || (s.height as number) || 1];
const mk = (w: number, h: number): OffscreenCanvas | HTMLCanvasElement => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));
const ctx2 = (c: OffscreenCanvas | HTMLCanvasElement): Ctx => c.getContext("2d") as Ctx;

export function lineWidth(ctx: Pick<Ctx, "measureText">, line: string, tracking: number): number {
  if (!tracking) return ctx.measureText(line).width;
  const chars = Array.from(line); return chars.reduce((w, c) => w + ctx.measureText(c).width, 0) + tracking * Math.max(0, chars.length - 1);
}
export function drawText(ctx: Ctx, p: TextProps): void {
  const m = textMetrics(p);
  ctx.font = `${p.italic ? "italic " : ""}${p.weight} ${p.size}px ${p.font}`; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  const lines = p.text.split("\n"), lh = p.size * m.lineHeight, y0 = -((lines.length - 1) * lh) / 2;
  const widths = lines.map((l) => lineWidth(ctx, l, m.tracking)), block = Math.max(1, ...widths);
  const put = (ln: string, x: number, y: number, stroke: boolean): void => {
    if (!m.tracking) { if (stroke) ctx.strokeText(ln, x, y); else ctx.fillText(ln, x, y); return; }
    let cx = x; for (const ch of Array.from(ln)) { if (stroke) ctx.strokeText(ch, cx, y); else ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + m.tracking; }
  };
  lines.forEach((ln, i) => {
    const y = y0 + i * lh, w = widths[i] ?? 0, x = p.align === "left" ? -block / 2 : p.align === "right" ? block / 2 - w : -w / 2;
    if (p.shadow > 0 || m.shadowX !== 0 || m.shadowY !== 0) { ctx.save(); ctx.shadowColor = m.shadowColor; ctx.shadowBlur = p.shadow; ctx.shadowOffsetX = m.shadowX; ctx.shadowOffsetY = m.shadowY; ctx.fillStyle = p.color; put(ln, x, y, false); ctx.restore(); }
    if (p.outline > 0) { ctx.lineJoin = "round"; ctx.lineWidth = p.outline * 2; ctx.strokeStyle = p.outlineColor; put(ln, x, y, true); }
    ctx.fillStyle = p.color; put(ln, x, y, false);
  });
}

interface Memo { key: string; src: object; sig: string }
const fxCache = new Map<string, { src: object; sig: string; canvas: OffscreenCanvas | HTMLCanvasElement }>(); const FX_CACHE_MAX = 2;
export const fxCacheStats = { hits: 0, misses: 0, enabled: true };
export function clearEffectCache(): void { for (const e of fxCache.values()) releaseScratch(e.canvas); fxCache.clear(); }
const isStill = (s: unknown): s is object => (typeof ImageBitmap !== "undefined" && s instanceof ImageBitmap) || (typeof HTMLImageElement !== "undefined" && s instanceof HTMLImageElement);

function withEffects(ctx: Ctx, f: Filters, alpha: number, w: number, h: number, draw: (c: Ctx) => void, memo?: Memo | null): void {
  if (!hasPixelEffects(f)) { ctx.save(); ctx.globalAlpha *= alpha; ctx.filter = filterCss(f); draw(ctx); ctx.restore(); return; }
  if (memo && fxCacheStats.enabled) {
    const hit = fxCache.get(memo.key);
    if (hit && hit.src === memo.src && hit.sig === memo.sig && hit.canvas.width === w && hit.canvas.height === h) { fxCacheStats.hits++; ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(hit.canvas as CanvasImageSource, 0, 0); ctx.restore(); return; }
    fxCacheStats.misses++; if (hit) { releaseScratch(hit.canvas); fxCache.delete(memo.key); }
    const t = acquireScratch(w, h), tx = ctx2(t); tx.filter = filterCss(f); draw(tx); tx.filter = "none"; applyPixelEffects(t, f);
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(t as CanvasImageSource, 0, 0); ctx.restore();
    fxCache.set(memo.key, { src: memo.src, sig: memo.sig, canvas: t }); while (fxCache.size > FX_CACHE_MAX) { const k = fxCache.keys().next().value as string; releaseScratch(fxCache.get(k)!.canvas); fxCache.delete(k); }
    return;
  }
  const t = acquireScratch(w, h), tx = ctx2(t); tx.filter = filterCss(f); draw(tx); tx.filter = "none"; applyPixelEffects(t, f);
  ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(t as CanvasImageSource, 0, 0); ctx.restore(); releaseScratch(t);
}

const layerCache = new Map<string, OffscreenCanvas | HTMLCanvasElement>(); const layersUsed = new Set<string>();
function layerFor(key: string, w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  layersUsed.add(key); let cv = layerCache.get(key); if (!cv || cv.width !== w || cv.height !== h) { cv = mk(w, h); layerCache.set(key, cv); } return cv;
}
function dropUnusedLayers(): void { for (const k of layerCache.keys()) if (!layersUsed.has(k)) layerCache.delete(k); layersUsed.clear(); }
export function isPassThrough(it: DrawItem): boolean {
  return !it.reveal && it.x === 0 && it.y === 0 && it.rotation === 0 && it.scale === 1 && it.opacity === 1 && it.crop.l === 0 && it.crop.t === 0 && it.crop.r === 0 && it.crop.b === 0 && filterCss(it.filters) === "none" && !hasPixelEffects(it.filters);
}
export function renderVideo(ctx: Ctx, v: VideoDoc, t: number, r: Resolver, w = v.width, h = v.height, scale = 1, nested: { prefix: string; depth: number; direct?: boolean } | null = null): void {
  ctx.save(); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  if (nested) { if (!nested.direct) ctx.clearRect(0, 0, w, h); } else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h); }
  for (const it of evaluateFrame(v, t)) {
    if (it.compoundId && isPassThrough(it)) {
      const comp = v.compounds?.[it.compoundId]; const depth = (nested?.depth ?? 0) + 1;
      if (comp && depth <= 8) renderVideo(ctx, compoundView(v, comp), it.sourceTime, r, w, h, scale, { prefix: `${nested?.prefix ?? ""}${it.clipId}/`, depth, direct: true });
      continue;
    }
    ctx.save();
    if (it.reveal) { ctx.beginPath(); ctx.rect(it.reveal.l * w, it.reveal.t * h, (it.reveal.r - it.reveal.l) * w, (it.reveal.b - it.reveal.t) * h); ctx.clip(); }
    let memo: Memo | null = null;
    if (it.mediaId && it.type !== "text" && !it.compoundId && hasPixelEffects(it.filters)) { const s0 = r.media(it.mediaId, it.sourceTime, nested ? `${nested.prefix}${it.clipId}` : it.clipId); if (s0 && isStill(s0)) memo = { key: `${nested?.prefix ?? ""}${it.clipId}`, src: s0, sig: JSON.stringify([it.x, it.y, it.rotation, it.scale, it.crop, it.filters, w, h]) }; }
    withEffects(ctx, it.filters, it.opacity, w, h, (c) => {
      c.translate(w / 2 + it.x * w, h / 2 + it.y * h); c.rotate((it.rotation * Math.PI) / 180); c.scale(it.scale, it.scale);
      if (it.type === "text") { const tc = v.clips[it.clipId]; if (tc?.text) drawText(c, tc.text); }
      else if (it.compoundId) {
        const comp = v.compounds?.[it.compoundId]; const depth = (nested?.depth ?? 0) + 1;
        if (comp && depth <= 8) { const cw = Math.max(1, Math.ceil(w * scale)), ch = Math.max(1, Math.ceil(h * scale)); const pre0 = `${nested?.prefix ?? ""}${it.clipId}`; const layer = layerFor(pre0, cw, ch); const lx = ctx2(layer); const pre = `${nested?.prefix ?? ""}${it.clipId}/`;
          renderVideo(lx, compoundView(v, comp), it.sourceTime, r, w, h, scale, { prefix: pre, depth });
          const cl = it.crop.l * w, ct = it.crop.t * h, cw2 = w * (1 - it.crop.l - it.crop.r), ch2 = h * (1 - it.crop.t - it.crop.b);
          if (cw2 > 0 && ch2 > 0) c.drawImage(layer, cl * scale, ct * scale, cw2 * scale, ch2 * scale, -w / 2 + cl, -h / 2 + ct, cw2, ch2); }
      }
      else if (it.mediaId) {
        const s = r.media(it.mediaId, it.sourceTime, nested ? `${nested.prefix}${it.clipId}` : it.clipId);
        if (s) {
          const [sw, sh] = dims(s), fit = Math.min(w / sw, h / sh), cl = it.crop.l * sw, ct = it.crop.t * sh, cw = sw * (1 - it.crop.l - it.crop.r), ch = sh * (1 - it.crop.t - it.crop.b);
          if (cw > 0 && ch > 0) c.drawImage(s, cl, ct, cw, ch, (-sw / 2 + cl) * fit, (-sh / 2 + ct) * fit, cw * fit, ch * fit);
        }
      }
    }, memo);
    ctx.restore();
  }
  ctx.restore();
  if (!nested) dropUnusedLayers();
}

const adj = (a: AdjustmentLayer["adjust"], k: AdjustKind, d: number): number => a[k] ?? d;
export function adjustmentCss(a: AdjustmentLayer["adjust"]): string {
  const ev = adj(a, "exposure", 0);
  return [`brightness(${(adj(a, "brightness", 100) / 100) * 2 ** ev * 100}%)`, `contrast(${adj(a, "contrast", 100)}%)`, `saturate(${adj(a, "saturation", 100)}%)`, `hue-rotate(${adj(a, "hue", 0)}deg)`, `grayscale(${adj(a, "grayscale", 0)}%)`].join(" ");
}
export const colorGains = (temp: number, tint: number): [number, number, number] => [1 + temp / 400, 1 - tint / 400, 1 - temp / 400];
function applyGains(c: OffscreenCanvas | HTMLCanvasElement, temp: number, tint: number): void {
  if (!temp && !tint) return; const x = ctx2(c), d = x.getImageData(0, 0, c.width, c.height), [gr, gg, gb] = colorGains(temp, tint), p = d.data;
  for (let i = 0; i < p.length; i += 4) { p[i] = Math.min(255, p[i]! * gr); p[i + 1] = Math.min(255, p[i + 1]! * gg); p[i + 2] = Math.min(255, p[i + 2]! * gb); }
  x.putImageData(d, 0, 0);
}

function drawLeaf(ctx: Ctx, n: Exclude<LayerNode, GroupNode | AdjustmentLayer>, r: Resolver, w: number, h: number): void {
  const body = (c: Ctx): void => {
    c.translate(w / 2 + n.x, h / 2 + n.y); c.rotate((n.rotation * Math.PI) / 180); c.scale(n.scale, n.scale);
    if (n.kind === "paint") { const s = r.mask(n.bitmapId); if (s) { const [sw, sh] = dims(s); c.drawImage(s, -sw / 2, -sh / 2, sw, sh); } }
    else if (n.kind === "image") { const s = r.media(n.mediaId, 0); if (s) { const [sw, sh] = dims(s); c.drawImage(s, -sw / 2, -sh / 2, sw, sh); } }
    else if (n.kind === "text") drawText(c, n.props);
    else { c.fillStyle = n.fill; c.strokeStyle = n.stroke; c.lineWidth = n.strokeWidth;
      if (n.shape === "rect") { c.fillRect(-n.w / 2, -n.h / 2, n.w, n.h); if (n.strokeWidth) c.strokeRect(-n.w / 2, -n.h / 2, n.w, n.h); }
      else if (n.shape === "ellipse") { c.beginPath(); c.ellipse(0, 0, n.w / 2, n.h / 2, 0, 0, Math.PI * 2); c.fill(); if (n.strokeWidth) c.stroke(); }
      else { c.beginPath(); c.moveTo(-n.w / 2, 0); c.lineTo(n.w / 2, 0); c.stroke(); } }
  };
  if (n.kind === "shape") { ctx.save(); body(ctx); ctx.restore(); } else withEffects(ctx, n.filters, 1, w, h, body);
}
function applyMask(layer: OffscreenCanvas | HTMLCanvasElement, n: LayerNode, r: Resolver): void {
  const m = n.mask; if (!m || !m.enabled) return; const x = ctx2(layer), bm = r.mask(m.bitmapId); if (!bm) return;
  const mc = mk(layer.width, layer.height), mx = ctx2(mc);
  if (m.inverted) { mx.fillStyle = "#fff"; mx.fillRect(0, 0, layer.width, layer.height); mx.globalCompositeOperation = "destination-out"; }
  mx.drawImage(bm, 0, 0, layer.width, layer.height);
  x.globalCompositeOperation = "destination-in"; x.globalAlpha = 1;
  if (m.density < 1) {
    const blend = mk(layer.width, layer.height), bx = ctx2(blend); bx.fillStyle = "#fff"; bx.globalAlpha = 1 - m.density; bx.fillRect(0, 0, layer.width, layer.height); bx.globalAlpha = m.density; bx.drawImage(mc, 0, 0); x.drawImage(blend, 0, 0);
  } else x.drawImage(mc, 0, 0);
  x.globalCompositeOperation = "source-over";
}

function renderGroup(target: Ctx, g: GroupNode, r: Resolver, w: number, h: number): void {
  for (const n of g.children) {
    if (!n.visible) continue;
    const layer = mk(w, h), lx = ctx2(layer);
    if (n.kind === "adjustment") {
      lx.filter = adjustmentCss(n.adjust); lx.drawImage((target as { canvas: CanvasImageSource }).canvas, 0, 0); lx.filter = "none";
      applyGains(layer, adj(n.adjust, "temperature", 0), adj(n.adjust, "tint", 0));
      applyMask(layer, n, r);
      target.save(); target.globalAlpha = n.opacity; target.globalCompositeOperation = "source-over";
      if (n.opacity >= 1 && !n.mask) { target.clearRect(0, 0, w, h); }
      target.drawImage(layer, 0, 0); target.restore(); continue;
    }
    if (n.kind === "group") renderGroup(lx, n, r, w, h); else drawLeaf(lx, n, r, w, h);
    applyMask(layer, n, r);
    target.save(); target.globalAlpha = n.opacity; target.globalCompositeOperation = n.blend;
    if (n.kind === "group") { target.translate(w / 2 + n.x, h / 2 + n.y); target.rotate((n.rotation * Math.PI) / 180); target.scale(n.scale, n.scale); target.translate(-w / 2, -h / 2); }
    target.drawImage(layer, 0, 0); target.restore();
  }
}
export function renderPhoto(ctx: Ctx, p: PhotoDoc, r: Resolver, background: string | null = null): void {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, p.width, p.height);
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, p.width, p.height); }
  renderGroup(ctx, p.root, r, p.width, p.height); ctx.restore();
}
