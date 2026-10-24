export type Read = (offset: number, length: number) => Promise<Uint8Array>;
export interface Sample { pts: number; key: boolean; offset: number; size: number }
export interface VideoTrack { codec: string; description?: Uint8Array; width: number; height: number; rotation: 0 | 90 | 180 | 270; samples: Sample[] }

const u32 = (b: Uint8Array, o: number): number => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
const u16 = (b: Uint8Array, o: number): number => (b[o]! << 8) | b[o + 1]!;
const i32 = (b: Uint8Array, o: number): number => u32(b, o) | 0;
const u64 = (b: Uint8Array, o: number): number => u32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const hex2 = (n: number): string => n.toString(16).padStart(2, "0").toUpperCase();
export const MAX_CLUSTER_BYTES = 128 * 1024 * 1024;

export async function demuxVideo(read: Read, size: number): Promise<VideoTrack | null> {
  try {
    const head = await read(0, Math.min(16, size)); if (head.length < 8) return null;
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return await demuxWebm(read, size);
    if (["ftyp", "moov", "mdat", "free", "wide", "skip"].includes(fourcc(head, 4))) return await demuxMp4(read, size);
  } catch { }
  return null;
}

async function demuxMp4(read: Read, size: number): Promise<VideoTrack | null> {
  let moov: Uint8Array | null = null; let p = 0;
  while (p + 8 <= size) { const h = await read(p, 16); let bs = u32(h, 0), hdr = 8; const type = fourcc(h, 4); if (bs === 1) { bs = u64(h, 8); hdr = 16; } else if (bs === 0) bs = size - p; if (bs < hdr) return null; if (type === "moov") { moov = await read(p + hdr, bs - hdr); break; } p += bs; }
  if (!moov) return null;
  const kids = (b: Uint8Array, s: number, e: number): { type: string; s: number; e: number }[] => { const out: { type: string; s: number; e: number }[] = []; let q = s; while (q + 8 <= e) { let bs = u32(b, q), hdr = 8; if (bs === 1) { bs = u64(b, q + 8); hdr = 16; } else if (bs === 0) bs = e - q; if (bs < hdr || q + bs > e) break; out.push({ type: fourcc(b, q + 4), s: q + hdr, e: q + bs }); q += bs; } return out; };
  const find = (b: Uint8Array, box: { s: number; e: number }, ...path: string[]): { s: number; e: number } | null => { let cur: { s: number; e: number } | null = box; for (const t of path) { const k: { type: string; s: number; e: number } | undefined = kids(b, cur!.s, cur!.e).find((x) => x.type === t); if (!k) return null; cur = k; } return cur; };
  const root = { s: 0, e: moov.length };
  for (const trak of kids(moov, 0, moov.length).filter((k) => k.type === "trak")) {
    const hdlr = find(moov, trak, "mdia", "hdlr"); if (!hdlr || fourcc(moov, hdlr.s + 8) !== "vide") continue;
    const tk = find(moov, trak, "tkhd"); let rotation: 0 | 90 | 180 | 270 = 0; if (tk) { const m = tk.s + (moov[tk.s] === 1 ? 48 : 40); const a = i32(moov, m) / 65536, bb = i32(moov, m + 4) / 65536; const deg = Math.round((Math.atan2(bb, a) * 180) / Math.PI / 90) * 90; rotation = ((((deg % 360) + 360) % 360) as 0 | 90 | 180 | 270); }
    const mdhd = find(moov, trak, "mdia", "mdhd")!; const ver = moov[mdhd.s]!; const timescale = ver === 1 ? u32(moov, mdhd.s + 20) : u32(moov, mdhd.s + 12);
    const stbl = find(moov, trak, "mdia", "minf", "stbl"); if (!stbl) return null; void root;
    const box = (t: string): { s: number; e: number } | null => { const k = kids(moov!, stbl.s, stbl.e).find((x) => x.type === t); return k ?? null; };
    const stsd = box("stsd"), stts = box("stts"), stsz = box("stsz"), stsc = box("stsc"); const stco = box("stco") ?? box("co64"); if (!stsd || !stts || !stsz || !stsc || !stco) return null;
    const eStart = stsd.s + 8; const esize = u32(moov, eStart); const etype = fourcc(moov, eStart + 4); if (etype !== "avc1" && etype !== "avc3") return null;
    const width = u16(moov, eStart + 8 + 24), height = u16(moov, eStart + 8 + 26); const avcC = kids(moov, eStart + 8 + 78, eStart + esize).find((k) => k.type === "avcC"); if (!avcC) return null;
    const description = moov.slice(avcC.s, avcC.e); const codec = `${etype}.${hex2(description[1]!)}${hex2(description[2]!)}${hex2(description[3]!)}`;
    const n = u32(moov, stsz.s + 8); const constSize = u32(moov, stsz.s + 4); const sizes = Array.from({ length: n }, (_, i) => (constSize ? constSize : u32(moov!, stsz.s + 12 + i * 4)));
    const co64 = fourcc(moov, stco.s - 4) === "co64"; void co64; const isCo64 = kids(moov, stbl.s, stbl.e).some((k) => k.type === "co64"); const nco = u32(moov, stco.s + 4); const chunkOff = Array.from({ length: nco }, (_, i) => (isCo64 ? u64(moov!, stco.s + 8 + i * 8) : u32(moov!, stco.s + 8 + i * 4)));
    const nsc = u32(moov, stsc.s + 4); const stscE = Array.from({ length: nsc }, (_, i) => ({ first: u32(moov!, stsc.s + 8 + i * 12), per: u32(moov!, stsc.s + 12 + i * 12) }));
    const offsets: number[] = []; for (let c = 0; c < nco && offsets.length < n; c++) { let per = stscE[0]!.per; for (const e of stscE) if (c + 1 >= e.first) per = e.per; let o = chunkOff[c]!; for (let k = 0; k < per && offsets.length < n; k++) { offsets.push(o); o += sizes[offsets.length - 1]!; } }
    const dts: number[] = []; { const ne = u32(moov, stts.s + 4); let t = 0; for (let i = 0; i < ne; i++) { const cnt = u32(moov, stts.s + 8 + i * 8), d = u32(moov, stts.s + 12 + i * 8); for (let k = 0; k < cnt; k++) { dts.push(t); t += d; } } }
    const ctts = box("ctts"); const off: number[] = new Array<number>(n).fill(0); if (ctts) { const v = moov[ctts.s]!; const ne = u32(moov, ctts.s + 4); let i = 0; for (let e = 0; e < ne; e++) { const cnt = u32(moov, ctts.s + 8 + e * 8); const o = v === 1 ? i32(moov, ctts.s + 12 + e * 8) : u32(moov, ctts.s + 12 + e * 8); for (let k = 0; k < cnt && i < n; k++) off[i++] = o; } }
    const stss = box("stss"); const keys = new Set<number>(); if (stss) { const ne = u32(moov, stss.s + 4); for (let i = 0; i < ne; i++) keys.add(u32(moov, stss.s + 8 + i * 4) - 1); }
    let shift = 0; { const elst = find(moov, trak, "edts", "elst"); if (elst) { const v = moov[elst.s]!; const ne = u32(moov, elst.s + 4); for (let i = 0; i < ne; i++) { const mt = v === 1 ? Number(u64(moov, elst.s + 8 + i * 20 + 8)) : i32(moov, elst.s + 8 + i * 12 + 4); if (mt >= 0) { shift = mt; break; } } } }
    if (dts.length < n || offsets.length < n) return null;
    const samples: Sample[] = Array.from({ length: n }, (_, i) => ({ pts: Math.round(((dts[i]! + off[i]! - shift) * 1e6) / timescale), key: stss ? keys.has(i) : true, offset: offsets[i]!, size: sizes[i]! }));
    return { codec, description, width, height, rotation, samples };
  }
  return null;
}

const TOP = new Set([0x1f43b675, 0x1c53bb6b, 0x1254c367, 0x114d9b74, 0x1549a966, 0x1654ae6b, 0x1043a770, 0x1941a469]);
const ebId = (b: Uint8Array, p: number): { id: number; len: number } | null => { const f = b[p]; if (f === undefined) return null; let len = 1; while (len <= 4 && !(f & (0x80 >> (len - 1)))) len++; if (len > 4 || p + len > b.length) return null; let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[p + i]!; return { id: v, len }; };
const ebSize = (b: Uint8Array, p: number): { size: number; len: number } | null => { const f = b[p]; if (f === undefined) return null; let len = 1; while (len <= 8 && !(f & (0x80 >> (len - 1)))) len++; if (len > 8 || p + len > b.length) return null; let v = f & (0xff >> len); let unknown = v === (0xff >> len); for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]!; if (b[p + i] !== 0xff) unknown = false; } return { size: unknown ? -1 : v, len }; };
const ebEl = (b: Uint8Array, p: number): { id: number; hdr: number; size: number } | null => { const a = ebId(b, p); if (!a) return null; const s = ebSize(b, p + a.len); return s ? { id: a.id, hdr: a.len + s.len, size: s.size } : null; };
const ebUint = (b: Uint8Array, s: number, e: number): number => { let v = 0; for (let i = s; i < e; i++) v = v * 256 + b[i]!; return v; };
interface WTrack { num: number; codec: string; priv?: Uint8Array; w: number; h: number }
function webmTracks(b: Uint8Array): WTrack | null {
  let q = 0, found: WTrack | null = null;
  while (q < b.length) { const t = ebEl(b, q); if (!t || t.size < 0) break; if (t.id === 0xae && !found) { let num = 0, type = 0, codec = "", priv: Uint8Array | undefined, w = 0, hh = 0; let r = q + t.hdr; const re = r + t.size;
      while (r < re) { const c = ebEl(b, r); if (!c || c.size < 0) break; const cs = r + c.hdr; if (c.id === 0xd7) num = ebUint(b, cs, cs + c.size); else if (c.id === 0x83) type = ebUint(b, cs, cs + c.size); else if (c.id === 0x86) codec = String.fromCharCode(...b.subarray(cs, cs + c.size)); else if (c.id === 0x63a2) priv = b.slice(cs, cs + c.size);
        else if (c.id === 0xe0) { let v = cs; const ve = cs + c.size; while (v < ve) { const d = ebEl(b, v); if (!d || d.size < 0) break; if (d.id === 0xb0) w = ebUint(b, v + d.hdr, v + d.hdr + d.size); else if (d.id === 0xba) hh = ebUint(b, v + d.hdr, v + d.hdr + d.size); v += d.hdr + d.size; } } r = cs + c.size; }
      if (type === 1) found = { num, codec, ...(priv ? { priv } : {}), w, h: hh }; } q += t.hdr + t.size; }
  return found;
}
function webmCluster(b: Uint8Array, base: number, unknown: boolean, scale: number, track: WTrack, out: Sample[], flags: { lacing: boolean }): { end: number; closed: boolean } {
  let q = 0, tc = 0;
  const block = (s: number, e: number, key: boolean | null): void => { const tn = ebSize(b, s); if (!tn || tn.size !== track.num) return; const hdr = tn.len + 3; const f = b[s + tn.len + 2]!; if (f & 0x06) { flags.lacing = true; return; } const rel = (((b[s + tn.len]! << 8) | b[s + tn.len + 1]!) << 16) >> 16; out.push({ pts: Math.round(((tc + rel) * scale) / 1000), key: key ?? (f & 0x80) !== 0, offset: base + s + hdr, size: e - (s + hdr) }); };
  while (q < b.length) {
    const c = ebEl(b, q); if (!c) return { end: q, closed: false }; if (unknown && TOP.has(c.id)) return { end: q, closed: true };
    if (c.size < 0) return { end: q, closed: false }; const cs = q + c.hdr, ce = cs + c.size; if (ce > b.length) return { end: q, closed: false };
    if (c.id === 0xe7) tc = ebUint(b, cs, ce); else if (c.id === 0xa3) block(cs, ce, null);
    else if (c.id === 0xa0) { let r = cs, has = false, bs = -1, be = -1; while (r < ce) { const g = ebEl(b, r); if (!g || g.size < 0) break; if (g.id === 0xa1) { bs = r + g.hdr; be = r + g.hdr + g.size; } else if (g.id === 0xfb) has = true; r += g.hdr + g.size; } if (bs >= 0) block(bs, be, !has); }
    q = ce;
  }
  return { end: q, closed: !unknown };
}
async function demuxWebm(read: Read, size: number): Promise<VideoTrack | null> {
  const head = await read(0, Math.min(size, 64)); const h = ebEl(head, 0); if (!h || h.id !== 0x1a45dfa3) return null; let p = h.hdr + h.size;
  const seg = ebEl(await read(p, 16), 0); if (!seg || seg.id !== 0x18538067) return null; p += seg.hdr; const segEnd = seg.size < 0 ? size : Math.min(size, p + seg.size);
  let scale = 1_000_000; let track: WTrack | null = null; const samples: Sample[] = []; const flags = { lacing: false };
  while (p < segEnd) {
    const e = ebEl(await read(p, 16), 0); if (!e) break; const s = p + e.hdr;
    if (e.id === 0x1549a966) { if (e.size < 0 || e.size > 1 << 20) return null; const b = await read(s, e.size); let q = 0; while (q < b.length) { const c = ebEl(b, q); if (!c || c.size < 0) break; if (c.id === 0x2ad7b1) scale = ebUint(b, q + c.hdr, q + c.hdr + c.size); q += c.hdr + c.size; } p = s + e.size; }
    else if (e.id === 0x1654ae6b) { if (e.size < 0 || e.size > 4 << 20) return null; track = webmTracks(await read(s, e.size)); p = s + e.size; }
    else if (e.id === 0x1f43b675) {
      if (!track) return null;
      if (e.size >= 0) { if (e.size > MAX_CLUSTER_BYTES) return null; const b = await read(s, e.size); webmCluster(b, s, false, scale, track, samples, flags); p = s + e.size; }
      else {
        let want = 4 << 20; for (;;) { const len = Math.min(want, segEnd - s); const b = await read(s, len); const tmp: Sample[] = []; const r = webmCluster(b, s, true, scale, track, tmp, flags);
          if (r.closed || s + len >= segEnd) { samples.push(...tmp); p = s + r.end; if (!r.closed) p = segEnd; break; } if (want >= MAX_CLUSTER_BYTES) return null; want *= 4; } }
    } else { if (e.size < 0) break; p = s + e.size; }
  }
  if (!track || flags.lacing || !samples.length) return null;
  let codec: string, description: Uint8Array | undefined;
  if (track.codec === "V_VP8") codec = "vp8"; else if (track.codec === "V_VP9") codec = "vp09.00.10.08";
  else if (track.codec === "V_MPEG4/ISO/AVC" && track.priv && track.priv.length > 4) { codec = `avc1.${hex2(track.priv[1]!)}${hex2(track.priv[2]!)}${hex2(track.priv[3]!)}`; description = track.priv; } else return null;
  return { codec, ...(description ? { description } : {}), width: track.w, height: track.h, rotation: 0, samples };
}
