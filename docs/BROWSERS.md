# Browser and hardware support

What is verified and what is not. "Verified" means exercised by the suites in `tests/browser` against a real browser in this repository's development environment; everything else is a code-level expectation, not a test result.

## Verified
- **Chromium 141** (Playwright build, software rendering, 1 CPU core, no GPU): all suites.
- **Chrome 131** (Chrome for Testing, with H.264): all suites, including MP4 export and H.264 MP4 *sources*.

## Not verified (could not be run where this was developed)
- **Firefox**, **Safari / WebKit**, and any **GPU-accelerated** run. The suites accept `BROWSER=firefox|webkit`, `GPU=1` and `HEADED=1` (see `tests/browser/launch.cjs`), so they can be run in one command wherever those exist:
  ```
  npm run build && npm run build:test
  BROWSER=firefox BUNDLE_DIR=dist BUNDLE_TEST_DIR=dist-test npm run test:browser
  BROWSER=webkit  BUNDLE_DIR=dist BUNDLE_TEST_DIR=dist-test npm run test:browser
  GPU=1 HEADED=1 node tests/browser/perf-export.cjs      # needs BUNDLE_DIR=dist-test
  ```
  Some fixtures are generated with `MediaRecorder` (WebM VP8/Opus), which Safari does not write, so on WebKit expect fixture setup failures rather than product failures.

## What the code does when a feature is missing
| Feature | Used for | If absent |
|---|---|---|
| WebCodecs `VideoEncoder` + `VideoFrame` | Frame-accurate export | The Method control is hidden; Real-time export is used |
| WebCodecs `AudioEncoder` (Opus / AAC) | Audio in frame-accurate export | The format note says the file will have no sound and the Audio switch is disabled |
| WebCodecs `VideoDecoder` + a demuxable file (MP4/MOV H.264, WebM VP8/VP9/H.264) | Fast source decoding | That clip is decoded by seeking a `<video>` element (slower, same output) |
| `MediaRecorder` | Real-time export | Real-time is not offered; frame-accurate still is |
| `OffscreenCanvas` | Layers, frame canvases | `HTMLCanvasElement` is used |
| H.264 encoder (`VideoEncoder`/`MediaRecorder`) | MP4 | MP4 is not offered; WebM is |

Formats shown in the export dialog are only those the browser reports it can encode (probed with `isConfigSupported` / `isTypeSupported`). MOV is never offered.

## Known risks outside the verified browsers
- Safari does not implement `CanvasRenderingContext2D.filter`. Colour and blur effects are drawn through it, so on Safari they would not appear in the preview or in exports. Not tested.
- Firefox and Safari have partial WebCodecs coverage (notably audio encoding); the capability probes above are what keep the dialog honest, but the combinations were not exercised.
- All speed numbers in the README come from a single-core, software-rendered machine and say nothing about GPU hardware.

## Export worker
The frame-accurate export runs in a dedicated Web Worker (module worker, WebCodecs and OffscreenCanvas inside it). Chrome and Edge support all of it. If a browser cannot start the worker, or the project needs something only the page can do (a clip it cannot decode directly, an SVG image), the same export runs on the page instead; nothing is lost except responsiveness. Firefox and Safari were not tested.
