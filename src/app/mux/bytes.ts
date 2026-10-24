export const concat = (parts: readonly Uint8Array[]): Uint8Array => { let n = 0; for (const p of parts) n += p.length; const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
export const u8 = (...b: number[]): Uint8Array => Uint8Array.from(b);
export const be = (v: number, bytes: number): Uint8Array => { const o = new Uint8Array(bytes); let x = Math.floor(v); for (let i = bytes - 1; i >= 0; i--) { o[i] = x % 256; x = Math.floor(x / 256); } return o; };
export const str = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 0xff));
export const f64 = (v: number): Uint8Array => { const o = new Uint8Array(8); new DataView(o.buffer).setFloat64(0, v); return o; };
export const f32 = (v: number): Uint8Array => { const o = new Uint8Array(4); new DataView(o.buffer).setFloat32(0, v); return o; };
