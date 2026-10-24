import assert from "node:assert/strict";
import { test } from "node:test";
import { mixAudio, panGains, timeStretch, type MixClip, type Pcm } from "../src/app/audioMix";

const SR = 48000;
const tone = (hz: number, sec: number, amp = 0.5): Float32Array => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
const pcm = (...c: Float32Array[]): Pcm => ({ sampleRate: SR, channels: c });
const rms = (a: Float32Array, from = 0, to = a.length): number => { let s = 0; for (let i = from; i < to; i++) s += a[i]! * a[i]!; return Math.sqrt(s / Math.max(1, to - from)); };
const freq = (a: Float32Array): number => { let z = 0; for (let i = 1; i < a.length; i++) if (a[i - 1]! < 0 && a[i]! >= 0) z++; return z / (a.length / SR); };

test("time stretch: duration scales by 1/ratio and pitch is preserved", () => {
  for (const r of [0.5, 0.75, 1.5, 2]) { const out = timeStretch([tone(440, 2)], r, SR)[0]!; assert.ok(Math.abs(out.length - SR * 2 / r) <= 2, `len ${out.length} for ${r}`); const f = freq(out.subarray(SR * 0.2 | 0, out.length - (SR * 0.2 | 0))); assert.ok(Math.abs(f - 440) < 12, `ratio ${r}: ${f} Hz`); assert.ok(rms(out, 4800, out.length - 4800) > 0.3, "level kept"); }
  assert.equal(timeStretch([tone(440, 1)], 1, SR)[0]!.length, SR); assert.equal(timeStretch([new Float32Array(0)], 2, SR)[0]!.length, 0);
});
test("pan law matches StereoPanner: centre keeps mono at cos/sin(pi/4), hard left silences right, stereo balance leaves the near channel alone", () => {
  const c = panGains(0, true); assert.ok(Math.abs(c[0] - Math.SQRT1_2) < 1e-9 && Math.abs(c[2] - Math.SQRT1_2) < 1e-9);
  const l = panGains(-1, true); assert.ok(Math.abs(l[0] - 1) < 1e-9 && Math.abs(l[2]) < 1e-9); const r = panGains(1, true); assert.ok(Math.abs(r[0]) < 1e-9 && Math.abs(r[2] - 1) < 1e-9);
  assert.deepEqual(panGains(0, false).map((x) => Math.round(x * 1e6) / 1e6), [1, 0, 0, 1]); const sl = panGains(-1, false); assert.ok(Math.abs(sl[3]) < 1e-9 && Math.abs(sl[0] - 1) < 1e-9);
});
test("mix: placement, gain, fades, clamp, balance, and untouched silence", () => {
  const src = pcm(tone(440, 1, 0.5)); const base: MixClip = { pcm: src, srcStart: 0, srcEnd: 1, speed: 1, start: 1, balance: 0, gain: () => 1 };
  const m = mixAudio([base], SR, 3); assert.equal(m.left.length, 3 * SR); assert.equal(rms(m.left, 0, SR - 10), 0); assert.ok(Math.abs(rms(m.left, SR + 100, 2 * SR - 100) - 0.5 * Math.SQRT1_2 * Math.SQRT1_2) < 0.01, "mono at centre = amplitude x cos(pi/4), RMS of a sine x 1/sqrt2"); assert.equal(rms(m.left, 2 * SR + 10), 0);
  const half = mixAudio([{ ...base, gain: () => 0.5 }], SR, 3); assert.ok(Math.abs(rms(half.left, SR + 100, 2 * SR - 100) / rms(m.left, SR + 100, 2 * SR - 100) - 0.5) < 0.02);
  const fade = mixAudio([{ ...base, gain: (t) => Math.min(1, Math.max(0, t - 1)) }], SR, 3); assert.ok(rms(fade.left, SR, SR + 4800) < rms(fade.left, 2 * SR - 4800, 2 * SR) * 0.3, "fade-in ramps up");
  const loud = mixAudio([{ ...base, gain: () => 10 }], SR, 3); let pk = 0; for (const x of loud.left) pk = Math.max(pk, Math.abs(x)); assert.ok(pk <= 1 && pk > 0.99, `peak ${pk}`);
  const left = mixAudio([{ ...base, balance: -1 }], SR, 3); assert.ok(rms(left.left, SR + 100, 2 * SR - 100) > 0.3 && rms(left.right, SR + 100, 2 * SR - 100) < 1e-6);
  const sum = mixAudio([base, base], SR, 3); assert.ok(rms(sum.left, SR + 100, 2 * SR - 100) > rms(m.left, SR + 100, 2 * SR - 100) * 1.5, "overlapping clips add");
  const trimmed = mixAudio([{ ...base, srcStart: 0.5, srcEnd: 0.75 }], SR, 3); assert.ok(rms(trimmed.left, SR + 100, SR + 0.25 * SR - 100) > 0.2 && rms(trimmed.left, SR + 0.25 * SR + 100) === 0);
  const fast = mixAudio([{ ...base, speed: 2 }], SR, 3); assert.ok(rms(fast.left, SR + 100, SR + 0.5 * SR - 100) > 0.2 && rms(fast.left, SR + 0.5 * SR + 1000) < 0.01, "2x speed halves the length");
  assert.throws(() => mixAudio([{ ...base, pcm: { sampleRate: 44100, channels: [new Float32Array(10)] } }], SR, 1));
});
