export const PEAK_RATE = 100;
export interface Peaks { data: Float32Array; duration: number }

export function reducePeaks(channels: Float32Array[], sampleRate: number, rate = PEAK_RATE): Float32Array {
  const len = channels[0]?.length ?? 0; const step = Math.max(1, Math.floor(sampleRate / rate));
  const out = new Float32Array(Math.ceil(len / step));
  for (const ch of channels) for (let i = 0; i < len; i++) { const v = Math.abs(ch[i] ?? 0); const b = (i / step) | 0; if (v > (out[b] ?? 0)) out[b] = v; }
  return out;
}

const cache = new Map<string, Promise<Peaks | null>>();
export function loadPeaks(id: string, blob: Blob): Promise<Peaks | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
        return { data: reducePeaks(chans, buf.sampleRate), duration: buf.duration };
      } catch { return null; }
      finally { void ctx.close(); }
    })();
    cache.set(id, p);
  }
  return p;
}
