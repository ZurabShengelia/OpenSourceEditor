import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MuxChunk } from "../../src/app/mux/webm";

export const tmp = (): string => mkdtempSync(join(tmpdir(), "loupe-"));
export const ff = (...a: string[]): void => { execFileSync("ffmpeg", ["-v", "error", "-y", ...a], { stdio: ["ignore", "pipe", "pipe"] }); };
export const probe = (path: string, args: string[] = []): any => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", ...args, path]).toString());
export const decodeErrors = (path: string): string => { try { execFileSync("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); return ""; } catch (e) { return String((e as { stderr?: Buffer }).stderr ?? e); } };
export const countFrames = (path: string): number => Number(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", path]).toString().trim());

export function ivfChunks(path: string, codec: "vp8" | "vp9", fps: number): MuxChunk[] {
  const b = readFileSync(path); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const out: MuxChunk[] = []; let p = 32, i = 0;
  while (p + 12 <= b.length) { const size = dv.getUint32(p, true); const data = new Uint8Array(b.subarray(p + 12, p + 12 + size)); const f = data[0]!; const key = codec === "vp8" ? (f & 1) === 0 : (f & 0x0c) === 0; out.push({ timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), key, data }); p += 12 + size; i++; }
  return out;
}
export function h264Chunks(path: string, fps: number): { chunks: MuxChunk[]; avcC: Uint8Array } {
  const b = readFileSync(path); const nals: { type: number; data: Uint8Array }[] = []; const starts: number[] = [];
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 0 && b[i + 1] === 0 && (b[i + 2] === 1 || (b[i + 2] === 0 && b[i + 3] === 1))) { starts.push(i); i += b[i + 2] === 1 ? 2 : 3; }
  for (let k = 0; k < starts.length; k++) { const s = starts[k]!; const hdr = b[s + 2] === 1 ? 3 : 4; const e = k + 1 < starts.length ? starts[k + 1]! : b.length; const data = new Uint8Array(b.subarray(s + hdr, e)); nals.push({ type: data[0]! & 31, data }); }
  const sps = nals.find((n) => n.type === 7)!.data, pps = nals.find((n) => n.type === 8)!.data;
  const avcC = Uint8Array.from([1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 255, ...sps, 1, pps.length >> 8, pps.length & 255, ...pps]);
  const chunks: MuxChunk[] = []; let cur: { type: number; data: Uint8Array }[] = []; const flush = (): void => { if (!cur.length) return; const body = cur.filter((n) => ![7, 8, 9].includes(n.type)); const parts = body.flatMap((n) => [Uint8Array.from([n.data.length >>> 24, (n.data.length >> 16) & 255, (n.data.length >> 8) & 255, n.data.length & 255]), n.data]); const len = parts.reduce((s, p) => s + p.length, 0); const data = new Uint8Array(len); let o = 0; for (const p of parts) { data.set(p, o); o += p.length; } const i = chunks.length; chunks.push({ timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), key: body.some((n) => n.type === 5), data }); cur = []; };
  for (const n of nals) { if (n.type === 9) flush(); cur.push(n); } flush(); return { chunks, avcC };
}
export function adtsChunks(path: string): { chunks: MuxChunk[]; asc: Uint8Array; sampleRate: number; channels: number } {
  const b = readFileSync(path); const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]; const chunks: MuxChunk[] = []; let p = 0, n = 0; let asc = new Uint8Array(2), sr = 48000, ch = 2;
  while (p + 7 < b.length && b[p] === 0xff) { const prot = b[p + 1]! & 1; const hdr = prot ? 7 : 9; const len = ((b[p + 3]! & 3) << 11) | (b[p + 4]! << 3) | (b[p + 5]! >> 5); const obj = (b[p + 2]! >> 6) + 1, fi = (b[p + 2]! >> 2) & 15, cc = ((b[p + 2]! & 1) << 2) | (b[p + 3]! >> 6);
    if (n === 0) { asc = Uint8Array.from([(obj << 3) | (fi >> 1), ((fi & 1) << 7) | (cc << 3)]); sr = rates[fi]!; ch = cc; } chunks.push({ timestamp: Math.round((n * 1024 * 1e6) / sr), duration: Math.round((1024 * 1e6) / sr), key: true, data: new Uint8Array(b.subarray(p + hdr, p + len)) }); p += len; n++; }
  return { chunks, asc, sampleRate: sr, channels: ch };
}
export function oggOpusChunks(path: string): { chunks: MuxChunk[]; preSkip: number } {
  const b = readFileSync(path); const pk: Uint8Array[] = []; let p = 0, carry: number[] = []; let preSkip = 312;
  while (p + 27 <= b.length && b[p] === 0x4f) { const nseg = b[p + 26]!; let q = p + 27 + nseg; for (let s = 0; s < nseg; s++) { const l = b[p + 27 + s]!; for (let k = 0; k < l; k++) carry.push(b[q + k]!); q += l; if (l < 255) { pk.push(Uint8Array.from(carry)); carry = []; } } p = q; }
  const head = pk[0]!; preSkip = head[10]! | (head[11]! << 8); const audio = pk.slice(2);
  return { chunks: audio.map((data, i) => ({ timestamp: i * 20000, duration: 20000, key: true, data })), preSkip };
}

export interface Pkt { pts: number; key: boolean; size: number }
export function ffPackets(path: string): Pkt[] {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags,size", "-of", "json", path], { maxBuffer: 1 << 28 }).toString());
  return j.packets.map((p: { pts_time: string; flags: string; size: string }) => ({ pts: Number(p.pts_time), key: p.flags.includes("K"), size: Number(p.size) }));
}
export const bufRead = (b: Uint8Array) => async (o: number, l: number): Promise<Uint8Array> => b.slice(o, Math.min(b.length, o + l));
