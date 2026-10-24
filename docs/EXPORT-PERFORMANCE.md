# Export performance: profile, changes, measurements

## Final stabilization pass: what was and was not established

Environment: 1 CPU core (Intel Xeon 2.1 to 2.8 GHz, the host speed varied between runs), 3.9 GB RAM, Chrome 141 and 131 headless, **software rendering, no GPU**. 720p30 timeline of 3.76 s (113 frames), VP9 + Opus source made with ffmpeg, output WebM VP9 + Opus "Medium", frame-accurate method. `tests/browser/perf-scenarios.cjs`, original code ("before") and final code ("after") run in alternation. Export time is the exporter's own `totalMs`.

| Scenario | Before (s), each run | After (s), each run | Verdict |
|---|---|---|---|
| 1 plain | 3.6, 3.6, 3.3 | 3.4, 3.5, 3.3 | no difference |
| 3 five effects (blur, vignette, glow, sharpen, grain) | 15.3, 16.8, 18.0 | 16.6, 16.6, 17.0 | no difference (ranges overlap; the machine itself varied by 15% between runs) |
| 2 five colour adjustments | 6.9 (1 run) | 7.0, 6.9 | no difference (single baseline) |
| 4 four video layers | 8.2 (1 run) | 8.8 | no difference (single baseline) |

**Conclusion: this pass produced no measurable change in export time, but moving the export into a worker removed the page freeze (below).** Every export had exactly the expected frame count (113/113). Per-frame render cost of the effects scenario was 120 to 145 ms before and 135 to 137 ms after.

What the pass did change (correctness and resource use, not speed):
- **Decoders are released when a clip has finished** (`Decoders.releaseFinished` in `offlineExport.ts`). Previously every clip's decoder, with up to about 90 MB of decoded frames per 4K clip and a hardware decoder slot, stayed open until the export ended. This bounds memory on projects with many clips. Measured on a 13-clip project with a transition at every join (`tests/browser/verify-multiclip.cjs`): the original code kept **13 decoders open at once**, the final code peaks at **2** and closes all of them by the end. The output was identical in both (589/589 frames, 19.6 s of continuous audio, clean decode) and the export time was the same (16.2 s and 16.1 to 16.2 s). On this 720p source the saving is memory and decoder slots, not time; at 4K the held frames are far larger (about 90 MB per clip).
- **Encoder backpressure waits on the encoder's `dequeue` event** (with a 20 ms safety timer) instead of polling every 2 ms. Throughput was unchanged.
- **Decoded audio is no longer copied** channel by channel (`decodeAudio`), removing one transient copy of the PCM.
- **WebM muxer end-time uses a loop** instead of `Math.max(...chunks)`, which throws past about 120,000 chunks (about 33 minutes at 60 fps).
- **Sharpen** rewritten with the three channels unrolled: byte-identical to the previous code (checked on random data at 1280x720 and 3840x2160, four strengths) and 15 to 35% cheaper in isolation (48 to 31 ms at 720p, 314 to 269 ms at 4K, noisy). It is a small part of the effect stack, so it does not show up in the export totals above.

**Tried and dropped in this pass**
- **Glow on a downscaled copy**: isolated timing was 30.1 to 30.9 ms (720p), 67.5 to 61.3 ms (1080p), 303.6 to 255 ms (4K). The cost is the software "screen" composite of a full frame, not the blur, and the result differed from the full-size blur by up to 6 of 255 levels. Reverted.
- **`MessageChannel` instead of `setTimeout(0)` for yielding**: no throughput gain, and the main-thread timer probe got worse in the effects scenario (median timer gap about 240 ms against 120 to 136 ms). Reverted.

**Export runs in a Web Worker.** `offlineExport.ts` (page) mixes the audio, then starts `exportWorker.ts`, which runs the unchanged frame loop in `offlineCore.ts` (compositor, decoders, encoders, muxers). Because the compositor is synchronous, the whole loop moves as a unit, so the live preview and the Photo editor are untouched.

- **Same file.** The same effects-and-audio project exported in the worker and on the page gives byte-identical files (equal SHA-256, 3,023,350 and 3,414,115 bytes in two runs; `tests/browser/verify-worker.cjs`).
- **The page no longer freezes.** Scenario 3 (five effects), page-thread timer gaps, two interleaved pairs: on the page the median gap was 120 and 124 ms (max 355 and 293 ms, 111 gaps over 100 ms); with the worker the median was 10 ms (max 94 and 173 ms, 0 and 1 gaps over 100 ms).
- **Throughput is unchanged where measured.** Scenario 3 took 17.2 and 16.1 s on the page and 16.3 and 16.8 s in the worker; scenario 1 took 3.2 to 3.4 s either way. The effect passes still run on one thread (now the worker's), so this does not make effects cheaper. The 4K/60 files above (26.8 s and 16.8 s) were produced by the worker; the earlier page-based run took 32.6 s and 23.8 s. That is a single pair of runs on a machine whose speed varied by about 15%, so it is not claimed as a speed-up.
- **Cancel** posts an abort to the worker, which stops at the next frame; the page terminates the worker (so every encoder, decoder and canvas dies with it) and waits at most 3 s. After a cancel no encoder is held and a new export starts normally.
- **When it falls back to the page** (same code, same result): no `Worker` support or the worker fails to start within 10 s; a clip the worker cannot demux or decode (it has no `<video>` element); an image a worker cannot decode (for example SVG); direct decoding switched off. The audio is mixed again on the page in that case.
- **Build status:** on a real machine `npm install`, `npm test` (86/86), `tsc --noEmit` and `vite build` all pass, and Vite emits the worker as its own file (`assets/exportWorker-*.js`). That the production page actually loads and runs that file in a browser was **not** tested; the tests here use an esbuild bundle. The page side is written so that a worker that cannot load is not fatal: a load error, a missing `ready` message within 10 s, a job that cannot be sent, unreadable messages, or 120 s of silence after the job was sent each end in either the page-thread fallback (before the export started) or a clear error (after). Firefox and Safari workers were not tested; multi-core scaling was not measured (the worker is still a single thread).

**Still images with effects are processed once.** In `compositor.ts` a clip whose source is an immutable image (`ImageBitmap` or `<img>`) keeps its processed layer between frames: when the source, placement, crop and filters are unchanged, the pixel passes (which are deterministic and have no time input) would produce the same pixels, so the stored layer is drawn instead. At most two layers are kept and they are released when an export ends. Video frames and editable bitmaps never use it. Measured (`tests/browser/verify-still-cache.cjs`, 5 s still image, 1920x1080, 30 fps, colour plus five effects, WebM): **18.7 to 21.0 s without the cache, 5.7 to 5.8 s with it** (two runs; pixel-pass time 15.9 to 18.4 s down to 0.1 to 0.2 s, 149 of 150 frames reused). The two files are byte-for-byte identical, and a video clip with the same effects recorded zero cache hits. This helps slideshow-style projects; it does nothing for effects on moving video, which is still about 120 to 145 ms per 720p frame.

**Still true.** 4K with the five-effect set costs about 850 ms per frame in a profile (glow about 450 ms, vignette+grain pass about 210 ms, sharpen about 145 ms, readback about 55 ms). That work is now on the worker's thread instead of the page's, but it is still serial; splitting rows across several workers is the remaining lever and was not built.

**Not measured**: hardware encoding, multi-core scaling, GPU rendering, the browser's own AAC encoder (none exists in the test browsers), Firefox and Safari.

**Why effects were not moved to workers.** The compositor is synchronous from the clip draw down to the pixel passes, and the same code serves the live preview and the Photo editor. Running the passes in workers means making that whole render path asynchronous, and the gain (parallel rows on a multi-core machine) cannot be measured on the one-core test machine. That is a change to the preview as well as the export, so it was left out of a stabilization pass rather than shipped unmeasured.

### Output checks (`tests/browser/verify-formats.cjs`, Chrome 131, files inspected with ffprobe/ffmpeg)
The tables below are from the final run. Checked per file: container name and magic bytes against the chosen format, file extension, video codec, dimensions, frame rate, frame count against the timeline, duration, audio presence, full decode with no errors. Across files: bitrate rises with the Low, Medium and High settings, colour adjustments and the effect stack change the exported pixels (whole-frame difference against a measured noise floor of 0.000 between identical exports).

| File (Chrome 131) | Container / codec | Size, fps requested = measured | Frames | Audio | Size on disk, kbps | Full decode |
|---|---|---|---|---|---|---|
| WebM, Medium | matroska,webm / VP9 | 1280x720, 30 = 30 | 121/121 | Opus | 1.07 MB, 2113 | clean |
| WebM, Low / High | matroska,webm / VP9 | 1280x720, 30 = 30 | 121/121 | Opus | 0.75 MB, 1489 / 1.53 MB, 3036 | clean |
| WebM, Advanced VP8 | matroska,webm / VP8 | 1280x720, 30 = 30 | 121/121 | Opus | 1.36 MB, 2705 | clean |
| MP4 | mov,mp4 (`ftyp`) / H.264 | 1280x720, 30 = 30 | 121/121 | Opus (fallback: no AAC encoder here) | 1.38 MB, 2747 | clean |
| MP4 | mov,mp4 (`ftyp`) / H.264 | 1920x1080, 60 = 60 | 241/241 | Opus | 5.4 MB, 10743 | clean |
| MP4, 9:16 | mov,mp4 (`ftyp`) / H.264 | 1080x1920, 30 = 30 | 121/121 | Opus | 2.94 MB, 5828 | clean |

Durations were 4.020 to 4.033 s for a 4.008 s timeline (the 12 to 25 ms difference is the audio tail). Export times on this machine: WebM 3.6 s, VP8 3.0 s, MP4 720p30 2.5 s, MP4 1080p60 9.7 s. VP8 was 3.0 s against 3.6 s for VP9 in this single pair of runs, which supports "faster" but not a percentage. Multi-clip and transition behaviour is covered by the many-clip check below and by the existing `smoke-offline-export` and `smoke-timeline` suites.

**4K at 60 fps, High quality** (3 s clip from a 3840x2160 source, one core, software rendering, no GPU): both files are 3840x2160, measured 60 fps, 181/181 frames, 3.02 s, Opus audio, and decode with no errors.

| Format | Export time | CPU time | Speed | Bitrate | Size |
|---|---|---|---|---|---|
| WebM (VP9) | 32.6 s | 31.6 s | 5.6 frames/s | 66.6 Mbps | 25.1 MB |
| MP4 (H.264) | 23.8 s | 22.7 s | 7.6 frames/s | 61.5 Mbps | 23.2 MB |

On this machine a 4K/60 export therefore runs at roughly 6 to 8 frames per second, about 8 to 11 times slower than real time, and the CPU is busy for the whole export (CPU time is close to wall time). That is the software encoder on one core; it says nothing about machines with a hardware encoder or several cores.

**Many-clip project** (13 clips, a transition at every join, 19.6 s, WebM 720p30): output 589/589 frames, container 19.633 s, audio 19.6 s with no silent gaps, clean decode.

## Earlier pass (kept for the record; not re-measured in the final pass)

Everything below was measured with the scripts in `tests/browser` (`perf-scenarios.cjs`, `perf-effects.cjs`, `perf-export.cjs`). Nothing here is a preview frame rate: every figure is a frame actually rendered, encoded and written to the output file, and every output was checked with `ffprobe` (frame count, timestamps) and a full `ffmpeg` decode.

## Environment (all numbers)
1 CPU core, Intel Xeon (reported as 2.1 to 2.8 GHz; the sandbox's host changed speed between sessions, so before/after builds were run **interleaved, three repetitions each**, and the tables give medians with ranges), 3.9 GB RAM, Chrome 141 (Playwright Chromium) with software rendering and no GPU. Source: `testsrc2` 1280x720, 30 fps, VP9 with a 30-frame GOP, plus Opus audio (made with ffmpeg). Output: WebM VP9 + Opus, 1280x720, 30 fps, "Medium" quality, frame-accurate method. Timeline: 6.01 s (scenario 6: 30.01 s).

## Where the time went (before)
Stage timers per frame (`offlineStats`): decode/seek, render, hand-off to the encoder, waiting on the encoder, plus audio decode+mix, encoder flush and mux.

| Finding | Evidence |
|---|---|
| Decoding cost **123 ms per frame** for a clip the decoder can decode at **4 ms per frame** | `decodeBench` (decoder fed flat out) measured 3.7 to 4.3 ms/frame; the exporter fed exactly the frame it needed, then polled for it with 15 to 30 ms timers, and the decoder holds frames back, so it waited on timers rather than doing work |
| Colour adjustments cost 69 ms per frame | CSS filter chain plus a CPU pass: `getImageData`, per-pixel branches, a canvas allocated per frame |
| Several effects cost 199 ms per frame | measured per effect in `perf-effects.cjs` (single effects at 720p: grain 38 ms, vignette 27, sharpen 27, distortion 26, glow 25, temperature 17, blur 12, CSS colour 8 to 12 ms) |
| Rendering a plain or layered clip costs 0.3 to 0.4 ms | the compositor itself is not the bottleneck |
| Encoding is the floor on this machine | after the fixes, "waiting on encoder" plus hand-off is most of the remaining time for plain footage |

## What changed, and what it measured
Median (min to max) over 3 interleaved runs per build; "x" is before divided by after.

| Scenario | Export time before | after | x | Decode ms/frame before / after | Render ms/frame before / after |
|---|---|---|---|---|---|
| 1 plain | 24.3 s (23.7 to 25.1) | 7.3 s (7.0 to 8.0) | 3.3 | 122.6 / 8.7 | 0.3 / 0.3 |
| 2 five colour adjustments | 27.8 s (21.4 to 28.5) | 16.8 s (16.7 to 17.1) | 1.7 | 73.8 / 10.2 | 68.6 / 59.0 |
| 3 five effects (blur, vignette, glow, sharpen, grain) | 51.8 s (49.4 to 52.0) | 39.5 s (38.7 to 39.7) | 1.3 | 70.3 / 11.0 | 199.1 / 197.7 |
| 4 four video layers (4 decoders) | 35.7 s (34.8 to 36.5) | 17.4 s (17.3 to 17.5) | 2.1 | 178.3 / 55.3 | 0.4 / 0.4 |
| 6a 30 s source, direct decode (1 run each) | 58.2 s | 38.5 s | 1.5 | 46.2 / 12.9 | 0.2 / 0.2 |

In every scenario and both builds: output frames = expected frames (181/181, 901/901), 0 dropped, 0 duplicated frames (checked with per-frame hashes), worst timestamp error 0.33 ms. Audio decode + mix went from about 0.5 s to about 0.1 to 0.25 s.

The gain is almost entirely the decoder change. Be careful with single before/after pairs: the old design's decode latency was bimodal (the same build measured 18 ms and 130 ms per frame in different runs), the new one is stable (8 to 12 ms).

**Real changes**
1. **Pipelined decoding** (`frameDecoder.ts`): keep the decoder fed ahead of the frame needed (bounded by a memory budget of decoded frames), prefetch source bytes in 4 MB windows, wait on decoder events, restart only when a discarded picture is requested again.
2. **CPU colour pass** (`pixelEffects.ts`): tone and temperature/tint folded into per-channel lookup tables, sharpen in place with rolling rows, pooled CPU-backed scratch canvases. Output is byte-identical to the original algorithm (oracle test, 13 effect combinations, 4 sizes, plus the sharpen oracle). Measured effect on a colour-adjusted export: render 68.6 to 59.0 ms (-14%).
3. **No filter for untouched clips** (`filterCss` omits defaults): an identity filter chain measured 21 of the 22 ms per 720p frame in the first version of the pipeline.
4. **Compound clips** with no transform/opacity/crop/effects render straight into their parent; others reuse a cached layer.
5. **Output spilled to Blob storage** (`Spill` in `offlineExport.ts`): encoded chunks are moved out of the JS heap in 8 MB batches and the muxers assemble the file from Blob slices without concatenating it. On a 90 s, 2,701-frame, 32.5 MB export the JS heap peak went from 199 MB to 84 MB (single run each). **Total browser-process RSS did not change measurably** (peak 1,676 vs 1,804 MB with baselines of 946 vs 1,057 MB, i.e. within the run-to-run noise), so at this output size no RSS benefit can be claimed; the change matters for much larger outputs and I did not measure those.
6. **React**: the editor shell no longer subscribes to export progress (only a small notice component does); a test asserts the shell re-renders at most 8 times during an export while the notice re-renders 10 or more times.

**Tried and dropped (no measured benefit)**: caching per-pixel vignette and grain maps (27 to 26 ms and 38 to 34 ms: noise; and tens of MB at 4K), so they were removed.

**Not improved**: effects-heavy rendering (199 ms/frame before and after). The remaining cost is software canvas raster plus `getImageData`/`putImageData` per effect pass on one core; a GPU-backed canvas or a WebGL/WebGPU effect pipeline is the next lever, and I did not build one because this environment has no GPU to measure it on, and the brief asks for changes only where measurement justifies them.

**Workers / OffscreenCanvas**: not added in the earlier pass; the final pass moved the whole frame loop into one worker (see the top of this file).

## The large-file path
The 768 MB limit was an **implementation choice** (the WebM parser read the whole file into one buffer), not a browser limitation. The WebM parser is now windowed: it walks elements and reads, parses and drops one cluster at a time. `tests/demux.test.ts` demuxes a synthetic **1.1 GB** WebM (generated on demand, never on disk) and asserts the largest single read is about one cluster (1.5 MB), and that unknown-size (live-recorded) clusters bigger than the first read window are handled. Clusters over 128 MB, or codecs the demuxer does not know, still fall back to seeking a `<video>` element.

## Longer source on the seeking path
Scenario 6b (30 s source forced through `<video>` seeking) was measured once in the first baseline session at about 130 ms per frame for seeking, versus 46 to 13 ms per frame (before/after) with direct decoding. The seeking code itself did not change.

## Not measured
Hardware-accelerated encoding and decoding (`hardwareAcceleration` is left at the browser default, `no-preference`, so a browser that has hardware encoders can use them); multi-core scaling; GPU canvas; 4K 60 on real hardware (4K 60 was run end to end, but only on one core with software encoding, see above).
