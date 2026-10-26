# OpenSourceEditor

A free photo and video editor that runs entirely in your browser. No account, no upload, no backend, no ads, no paid services. Your projects and media never leave your machine.

I built OpenSourceEditor myself and I am releasing it for everyone under the MIT license. Use it, change it, fork it, ship your own version of it. Everything in this repository is free.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Performance and how you can help](#performance-and-how-you-can-help)
- [Contributing](#contributing)
- [Privacy and security](#privacy-and-security)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Browser support](#browser-support)
- [License](#license)

## Features

**Video**

- Multi-track timeline with video, audio and text tracks
- Drag, trim, split, duplicate, copy and paste, snapping, marquee and range selection, markers
- Transitions: fade, dissolve, slide, wipe
- Keyframes with presets
- Per-clip colour adjustments and effects
- Detach and link audio, compound (nested) clips
- Command palette (`Ctrl+K`)
- Export to WebM or MP4, in the formats your browser can actually encode

**Photo**

- Layer tree: image, paint, text, shape and adjustment layers, plus nested groups
- 16 blend modes and raster masks
- Brush, eraser, fill, eyedropper, rectangle and ellipse selection, magic wand, crop
- Transform handles with snapping and alignment guides, zoom and pan
- Export to PNG, JPEG or WebP with an exact file-size readout

**Everywhere**

- Undo and redo with coalesced gestures
- Projects saved in your browser (save, save as, open, rename, duplicate, delete, recent projects)
- Versioned project format with migrations, so older projects keep opening
- Resizable and collapsible panels that turn into drawers on narrow screens
- Beginner-friendly Inspector with plain-language labels, hints, tooltips and reset controls

## Quick start

You need Node.js and npm. Clone the repository, open its folder, then run:

```bash
npm install
npm run dev
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm test` | Unit and conformance tests (needs `ffmpeg` and `ffprobe` on your PATH) |
| `npm run build:test` | Build with the test hook enabled (`dist-test/`) |
| `npm run test:browser` | Real-browser test suites (see [Testing](#testing)) |

The production build is plain static files. Host it anywhere that serves static content.

## Performance and how you can help

Adding effects can lower the frame rate in the preview, especially on weaker computers and with several effects stacked on one clip. This is the biggest known weakness of the project, and it is where help is most welcome.

Why it happens:

- Pixel effects (film grain, sharpen, vignette, distortion, chromatic aberration and others) are JavaScript loops over canvas pixels, and the preview reads pixels back from the canvas and writes them again.
- Rendering runs on the main thread with Canvas 2D. There is no GPU rendering path yet.
- Some effects already have caches and tuned loops, and the tests check that optimised output stays byte-identical to the reference implementation.

Ideas for anyone who wants to make it faster:

- Move pixel effects to WebGL or WebGPU shaders
- Render the preview in a Web Worker with `OffscreenCanvas`
- Render a lower-resolution preview while playing and the full-resolution frame when paused or exporting
- Cache per-clip results when the effect settings and the source frame have not changed
- Use `SharedArrayBuffer` for worker threads (this needs cross-origin isolation headers on the host)

Where to start:

- `src/render/pixelEffects.ts`: the pixel passes
- `src/render/compositor.ts`: the Canvas 2D compositor
- `scripts/bench-pixels.ts`, `tests/bench/effects.bench.ts` and `tests/browser/bench-effects.cjs`: micro-benchmarks
- `tests/pixelEffects.test.ts` and `tests/pixelEffectsExact.test.ts`: correctness checks to keep green
- `docs/EXPORT-PERFORMANCE.md`: measurements and notes on the export pipeline

If you find something to improve, take it, change it, and share it back. You do not need to ask me first.

## Contributing

OpenSourceEditor is free and stays free. Anyone can fork it, rework it, or send improvements.

1. Fork the repository and create a branch
2. Make your change
3. Run `npm run typecheck` and `npm test`
4. Open a pull request that says what changed and why

Bug reports with steps to reproduce, browser and operating system are very helpful. For performance work, include before and after numbers and the machine you measured on.

## Privacy and security

- The application source contains no network calls (`fetch`, `XMLHttpRequest`, `WebSocket`, beacons), no analytics, no tracking, no remote fonts and no remote scripts
- Projects are stored in your browser's IndexedDB and small interface preferences in `localStorage` and `sessionStorage`
- Opened files are read locally and are never uploaded
- Production builds include a Content-Security-Policy (`scripts/csp.ts`) that limits loading to the same origin, plus `blob:` and `data:` for media
- Project data read from storage is validated and migrated before use (`src/doc/migrate.ts`)

A meta tag cannot set every protection. If you host the build yourself, send headers such as `X-Content-Type-Options`, `Referrer-Policy` and `frame-ancestors` from your web server where it allows you to.

Please report security problems privately through the repository's Security tab on GitHub rather than in a public issue.

## Tech stack

React 19, TypeScript (strict) and Vite 6. Hand-written CSS. Rendering uses Canvas 2D. Export uses WebCodecs where available, project-written WebM and MP4 muxers and demuxers, and a Web Worker. The only runtime dependencies are React and React DOM.

## Project structure

```
src/doc/        document model: schema, migrations, keyframes, layer and video operations, history
src/render/     Canvas 2D compositor and pixel effects
src/app/        stores, actions, playback engine, persistence, snapping, export
src/app/mux/    WebM and MP4 muxers
src/app/demux/  MP4/MOV and WebM demuxers
src/ui/         React components
src/editor/     shared editor pieces: menus, tooltips, splitters, effect registry
src/styles/     design tokens and CSS
tests/          unit tests and real-browser tests
docs/           architecture, design, browser support, export performance
```

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/DESIGN.md`](docs/DESIGN.md), [`docs/BROWSERS.md`](docs/BROWSERS.md).

## Testing

```bash
npm test
```

This runs the unit and conformance tests with `tsx`. Several of them encode real media and check it with `ffmpeg` and `ffprobe`, so both must be installed.

The real-browser suites live in `tests/browser/` and drive the built editor with Playwright:

```bash
npm run build:test
CHROME=/path/to/chrome npm run test:browser
```

See `tests/browser/README.md` for the environment variables each suite reads.

## Browser support

Developed and tested on Chromium-based browsers (Chromium 141 and Chrome 131). Firefox and Safari have not been tested. Features that depend on WebCodecs or `MediaRecorder` are hidden or replaced with a fallback when the browser does not provide them. Details are in [`docs/BROWSERS.md`](docs/BROWSERS.md).

MP4 export with H.264 and AAC uses your browser's own encoders. Whether those codecs are licensed for your use case is a question for you and your browser vendor, not something this project decides.

## License

[MIT](LICENSE). Free to use, copy, modify, merge, publish, distribute and sell, with no warranty. dasdasdasd
