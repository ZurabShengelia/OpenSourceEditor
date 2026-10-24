export interface Pcm { sampleRate: number; channels: Float32Array[] }
export interface MixClip { pcm: Pcm; srcStart: number; srcEnd: number; speed: number; start: number; balance: number; gain: (t: number) => number }

export function timeStretch(chans: readonly Float32Array[], ratio: number, sampleRate: number): Float32Array[] {
  const n = chans[0]?.length ?? 0; if (!n || Math.abs(ratio - 1) < 1e-6) return chans.map((c) => c.slice());
  const N = 2 * Math.round((sampleRate * 0.03) / 2), Hs = N / 2, Ha = Hs * ratio, delta = Math.round(sampleRate * 0.008);
  const outLen = Math.max(1, Math.round(n / ratio)); const out = chans.map(() => new Float32Array(outLen + 2 * N)); const norm = new Float32Array(outLen + 2 * N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / N);
  const mono = new Float32Array(n); for (const c of chans) for (let i = 0; i < n; i++) mono[i]! += c[i]! / chans.length;
  const D = 4;
  let prev = 0; const frames = Math.ceil(outLen / Hs) + 1;
  for (let k = 0; k < frames; k++) {
    const nominal = Math.round(k * Ha); let pos = nominal;
    if (k > 0) {
      const want = prev + Hs; let best = -Infinity, bo = 0;
      for (let o = -delta; o <= delta; o += D) { const p = nominal + o; if (p < 0 || p + N > n || want + N > n) continue; let c = 0; for (let i = 0; i < N; i += D) c += mono[want + i]! * mono[p + i]!; if (c > best) { best = c; bo = o; } }
      pos = nominal + bo;
    }
    pos = Math.max(0, Math.min(pos, Math.max(0, n - 1))); const at = k * Hs;
    for (let i = 0; i < N; i++) { const si = pos + i; if (si >= n) break; const w = win[i]!; const oi = at + i; norm[oi]! += w; for (let c = 0; c < chans.length; c++) out[c]![oi]! += chans[c]![si]! * w; }
    prev = pos;
  }
  return out.map((o) => { const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) { const w = norm[i]!; r[i] = w > 1e-3 ? o[i]! / w : 0; } return r; });
}

export function panGains(pan: number, mono: boolean): [number, number, number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  if (mono) { const x = ((p + 1) / 2) * (Math.PI / 2); return [Math.cos(x), 0, Math.sin(x), 0]; }
  if (p <= 0) { const x = (p + 1) * (Math.PI / 2); return [1, Math.cos(x), 0, Math.sin(x)]; }
  const x = p * (Math.PI / 2); return [Math.cos(x), 0, Math.sin(x), 1];
}

const GAIN_STEP = 240;
export function mixAudio(clips: readonly MixClip[], sampleRate: number, seconds: number): { left: Float32Array; right: Float32Array } {
  const len = Math.max(1, Math.ceil(seconds * sampleRate)); const L = new Float32Array(len), R = new Float32Array(len);
  for (const c of clips) {
    if (c.pcm.sampleRate !== sampleRate) throw new Error("mixAudio: source must already be at the output sample rate");
    const a = Math.max(0, Math.round(c.srcStart * sampleRate)), b = Math.min(c.pcm.channels[0]?.length ?? 0, Math.round(c.srcEnd * sampleRate)); if (b <= a) continue;
    let seg = c.pcm.channels.map((ch) => ch.subarray(a, b)); if (Math.abs(c.speed - 1) > 1e-6) seg = timeStretch(seg, c.speed, sampleRate);
    const mono = seg.length === 1; const [ll, lr, rl, rr] = panGains(c.balance, mono); const l = seg[0]!, r = seg[1] ?? seg[0]!; const o0 = Math.round(c.start * sampleRate); const n = l.length;
    let g0 = c.gain(c.start), g1 = g0, step = 0;
    for (let j = 0; j < n; j++) {
      const oi = o0 + j; if (oi < 0) continue; if (oi >= len) break;
      if (j % GAIN_STEP === 0) { g0 = j === 0 ? g0 : g1; g1 = c.gain(c.start + (j + GAIN_STEP) / sampleRate); step = 0; }
      const g = g0 + (g1 - g0) * (step++ / GAIN_STEP);
      if (mono) { L[oi]! += l[j]! * g * ll; R[oi]! += l[j]! * g * rl; } else { L[oi]! += (l[j]! * ll + r[j]! * lr) * g; R[oi]! += (l[j]! * rl + r[j]! * rr) * g; }
    }
  }
  for (let i = 0; i < len; i++) { L[i] = Math.max(-1, Math.min(1, L[i]!)); R[i] = Math.max(-1, Math.min(1, R[i]!)); }
  return { left: L, right: R };
}
