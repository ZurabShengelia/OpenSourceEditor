import type { Read } from "../../src/app/demux/demux";

const cat = (...p: Uint8Array[]): Uint8Array => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let q = 0; for (const x of p) { o.set(x, q); q += x.length; } return o; };
const idb = (v: number): Uint8Array => { const b: number[] = []; let x = v; while (x > 0) { b.unshift(x & 255); x = Math.floor(x / 256); } return Uint8Array.from(b); };
const size8 = (n: number): Uint8Array => { const o = new Uint8Array(8); o[0] = 1; let x = n; for (let i = 7; i >= 1; i--) { o[i] = x % 256; x = Math.floor(x / 256); } return o; };
const UNKNOWN8 = Uint8Array.from([1, 255, 255, 255, 255, 255, 255, 255]);
const el = (id: number, ...p: Uint8Array[]): Uint8Array => { const b = cat(...p); return cat(idb(id), size8(b.length), b); };
const u = (v: number): Uint8Array => Uint8Array.from([v]);
const str = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

export interface VirtualWebm { size: number; read: Read; clusterBytes: number; samples: number; frameMs: number }
export function virtualWebm(o: { clusters: number; blocksPerCluster: number; blockBytes: number; unknownSizeClusters?: boolean }): VirtualWebm {
  const frameMs = 33;
  const ebml = el(0x1a45dfa3, el(0x4282, str("webm")));
  const info = el(0x1549a966, el(0x2ad7b1, Uint8Array.from([0x0f, 0x42, 0x40])));
  const tracks = el(0x1654ae6b, el(0xae, el(0xd7, u(1)), el(0x83, u(1)), el(0x86, str("V_VP9")), el(0xe0, el(0xb0, Uint8Array.from([0x05, 0x00])), el(0xba, Uint8Array.from([0x02, 0xd0])))));
  const prefix = cat(ebml, idb(0x18538067), UNKNOWN8, info, tracks);
  const blocks: Uint8Array[] = []; for (let b = 0; b < o.blocksPerCluster; b++) blocks.push(el(0xa3, Uint8Array.from([0x81, (b * frameMs) >> 8, (b * frameMs) & 255, b === 0 ? 0x80 : 0]), new Uint8Array(o.blockBytes)));
  const tcField = cat(idb(0xe7), Uint8Array.from([0x84, 0, 0, 0, 0])); const body = cat(tcField, ...blocks);
  const template = o.unknownSizeClusters ? cat(idb(0x1f43b675), UNKNOWN8, body) : cat(idb(0x1f43b675), size8(body.length), body); const tcOffset = template.length - body.length + 2;
  const C = template.length; const size = prefix.length + C * o.clusters;
  const read: Read = async (off, len) => {
    const out = new Uint8Array(Math.max(0, Math.min(len, size - off))); let w = 0;
    while (w < out.length) { const pos = off + w;
      if (pos < prefix.length) { const n = Math.min(out.length - w, prefix.length - pos); out.set(prefix.subarray(pos, pos + n), w); w += n; continue; }
      const k = Math.floor((pos - prefix.length) / C), inC = (pos - prefix.length) % C; const n = Math.min(out.length - w, C - inC); out.set(template.subarray(inC, inC + n), w);
      const tc = k * o.blocksPerCluster * frameMs; for (let i = 0; i < 4; i++) { const at = tcOffset + i; if (at >= inC && at < inC + n) out[w + (at - inC)] = (tc >>> (8 * (3 - i))) & 255; } w += n; }
    return out;
  };
  return { size, read, clusterBytes: C, samples: o.clusters * o.blocksPerCluster, frameMs };
}
