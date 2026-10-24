# OpenSourceEditor architecture

Stack: React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Vite 6. No UI framework and no runtime dependencies besides React.

## Layers

- `src/doc/*` is pure and has no DOM access. `schema.ts` (v2), `migrate.ts` (v1 to v2 plus validation), `keyframes.ts` (evaluation, presets), `compose.ts` (`evaluateFrame`), `videoOps.ts` (tracks, clips, snapping, transitions), `layerOps.ts` (layer tree), `history.ts` (snapshots, gestures), `text.ts` (text metric defaults, font list).
- `src/render/*` is a Canvas 2D compositor: video frames, the photo layer tree, masks, adjustment layers, CPU pixel effects. Preview, export and the histogram all call it, so what you see is what you export.
- `src/app/store.ts` holds three stores: the document (undoable), UI state (selection, tool, zoom, panels; never in history) and the transport (playhead).
- `src/app/actions.ts` is every user operation. Components call actions; they do not edit the document themselves.
- `src/app/engine.ts` is playback, the WebAudio mix (gain, balance, fades, solo, mute) and real-time recording for export. `media.ts` keeps Blobs, decoded elements and bitmaps outside React.
- `src/app/storage.ts` and `persist.ts` are IndexedDB: versioned records, a blob store, orphan cleanup, quota errors.
- `src/app/snap.ts` is pure snapping, alignment and crop geometry. It is unit-tested.
- `src/app/dialogs.ts` is a promise-based `askText` / `askConfirm`, rendered by `ui/DialogHost.tsx`. There are no native `prompt` or `confirm` calls.
- `src/ui/*` is React: `EditorShell` (layout, keyboard, menus), `TopBar`, `MediaBin`, `ToolRail`, `Preview`, `PhotoCanvas` (with its options bar), `Timeline`, `LayersPanel`, `Inspector`, `StatusBar`, `Viewport` (zoom / pan / handles / guides shared by Preview and PhotoCanvas), `controls.tsx` (the control kit), `Icon.tsx` (the single icon set).

## Data model (schema v2)

```ts
interface ProjectV2 { version: 2; id; name; updatedAt; media: Record<string, MediaRef>; video: VideoDoc; photo: PhotoDoc }
interface VideoDoc { fps; width; height; tracks: Track[]; clips: Record<string, TClip>; transitions: Transition[] }
interface Track { id; kind: "video" | "audio" | "text"; name; order; muted; solo; locked; visible }
interface TClip { id; trackId; type: "media" | "text"; mediaId?; start; srcStart; srcEnd; speed; volume; balance; fadeIn; fadeOut;
                  transform; crop; filters; text?: TextProps; keyframes: Partial<Record<AnimProp, Keyframe[]>> }
interface PhotoDoc { width; height; root: GroupNode; selection }
type LayerNode = image | paint | text | shape | adjustment | group   // common: visible, locked, opacity, blend, transform, mask?
```

`TextProps` gained optional `lineHeight`, `tracking`, `shadowColor`, `shadowX`, `shadowY`. They default through `textMetrics()` in `doc/text.ts`, so existing projects open unchanged and no schema bump or migration was needed.

Drawing: each stroke forks the target bitmap under a new id inside one history gesture, so undo and redo restore pixels without storing strokes in React state.

## Rules the UI follows

- One source of truth: UI state is in the UI store, document state in history. Selection, zoom, pan and panel state are never undoable.
- A drag, a slider scrub or a run of typing is one undo step (`gesture.begin()` / `gesture.end()`).
- Every visible control calls an action. Nothing is a placeholder.
- Snapping is a single flag (`ui.snapping`) shared by the timeline, the preview and the photo canvas; holding Alt turns it off for the current drag.

## Export and linked audio (added)

- `app/exportPlan.ts` is pure: the export job state machine (`idle, preparing, exporting, completed, cancelled, failed`), output size / bitrate / size-estimate arithmetic. Unit-tested.
- `app/exporter.ts` owns the single export job (outside React and outside undo history), the photo exporter, and encoder probing (`VideoEncoder.isConfigSupported`, falling back to a 1080p ceiling when it cannot verify). `ui/ExportDialog.tsx` and the shell notice only read it.
- `Player.record()` ignores pause / seek / play while recording; only the abort signal stops it, and `finally` restores quality, canvases and audio taps.
- `TClip.detached` / `linkId` (optional, no schema bump): a detached video clip has zero gain; its sound lives on an audio-track clip with the same `linkId`. `videoOps.detachAudio / linkAudio / canDetach / linkedVideoFor`.

## Timeline model additions

- Optional document fields (no schema bump): `VideoDoc.markers`, `Track.collapsed / height`, `TClip.muted / disabled / locked`. `migrate.validate` drops malformed values instead of refusing the project.
- `videoOps`: `setClipFlag`, marker ops (`addMarker` refuses a second marker on the same frame; `snap` includes markers), `rowHeight`, `copyClips / pasteClips` (offsets kept, original track reused when free, otherwise another free track, otherwise a new one; link ids remapped; transitions between copied clips re-created).
- The clip clipboard lives in `app/actions.ts`, outside the document and outside undo history. Disabled clips are skipped by `evaluateFrame` and have zero gain; muted clips have zero gain.
- Responsive: `EditorShell` uses `matchMedia` (< 1180px) to render the Media panel and Inspector as overlay drawers; no layout state is stored in the document.

## Compound clips, linked-audio strips, palette

- `VideoDoc.compounds` holds nested timelines (`Compound`: own tracks, clips, transitions, length). A clip with `type: "compound"` plays one; `srcStart/srcEnd` are times inside it, so trim, split, speed and keyframes reuse the ordinary clip maths. `migrate.validate` rejects dangling references, missing media inside compounds and cycles.
- Rendering: `compositor.renderVideo` draws a compound item by rendering its nested timeline to an `OffscreenCanvas` (transparent background) and placing that layer through the normal transform / crop / effects path. Audio and decoders: `compose.flatClips` expands compounds into virtual clips with ids `${compoundClipId}/${innerId}` and outer-timeline timing; `liveClipIds` does the same for visibility. The engine resolver finds those clips through a cached `flatIndex`. Two instances of one compound therefore never share a decoder.
- `videoOps.createCompound / breakApart / pruneCompounds / dropMedia`: pure, unit-tested; removing media also removes it from inside compounds.
- Linked audio strip: a derived, read-only row under a video track for clips whose sound is still attached (`attached()` in Timeline). It is not a document object, so there is nothing to keep in sync; detaching turns it into a real audio clip.
- Command palette: `app/commandSearch.ts` (pure ranking, menu conversion, unit-tested) + `app/commands.ts` (workspace commands) + `ui/CommandPalette.tsx`. The shell feeds it the same menu arrays it renders, so menus and palette cannot drift apart.

## Frame-accurate export pipeline

`offlineExport.ts` (page side: mixes the audio, starts `exportWorker.ts`, falls back to running the same code on the page) hands the project to `offlineCore.ts`, which orchestrates: for each output frame i, `compose.liveSources(v, i/fps)` says which media frame each visible clip needs (descending into compounds); `Decoders.prepare` makes each clip's decoder produce exactly that frame; `renderVideo` (the preview's compositor) draws it; `VideoFrame` -> `VideoEncoder`. Audio is `flatClips` -> decoded PCM -> `audioMix.mixAudio` (gain automation from the same `gain()` the preview uses, StereoPanner law for balance, WSOLA `timeStretch` for speed) -> `AudioEncoder`. `mux/webm.ts` and `mux/mp4.ts` assemble the file.

- Source decoding: `frameDecoder.FrameDecoder` demuxes (`demux/demux.ts`) and feeds `VideoDecoder` sequentially, keyed by decode index; it restarts at a keyframe only when the needed picture is behind the decoder or in a later GOP. Any failure drops that clip to the `<video>` seeking path.
- Muxers are pure and refuse rather than guess (MP4 throws on out-of-order video timestamps). Demuxers return null for what they do not understand.
- Cancellation is an `AbortSignal` checked every frame; encoders, decoders and elements are released in `finally`.
- The real-time `Player.record` path is unchanged and still offered.

## Export pipeline additions (performance and reliability pass)

- `frameDecoder.ts` pipelines decoding: it feeds the decoder a few frames ahead of the one needed (bounded by a memory budget of decoded frames), prefetches source bytes in 4 MB windows, and waits on decoder events rather than timers. A restart at a keyframe happens only when a needed picture was already discarded.
- `demux/demux.ts`: the WebM parser is windowed. It walks elements, reads and parses one cluster at a time and keeps only the sample table, so memory is bounded by the largest cluster and there is no file-size limit (the old 768 MB limit was an implementation choice, not a browser constraint). Unknown-size (live recorded) clusters are read in growing windows. MP4 track header rotation (0/90/180/270) is read and applied by the fast path; browsers apply it to `<video>` elements, so preview and export agree. Browsers do not apply WebM rotation metadata, so neither do we.
- `mux/mp4.ts` supports B-frames: video arrives in decode order with presentation timestamps; decode times go on a constant-rate grid, composition offsets in `ctts`, and an edit list starts presentation at zero. Irregular timing combined with reordering is refused.
- `offlineExport.preflightOffline` encodes a tiny real sample with the chosen codecs (video, and audio when requested) before a long export starts, and checks that H.264 and AAC provide the configuration record MP4 needs.
- `render/pixelEffects.ts`: the CPU colour pass folds tone and temperature/tint into three lookup tables, sharpen runs in place with rolling rows, and scratch canvases are pooled and CPU-backed (`willReadFrequently`). `tests/pixelEffects.test.ts` holds the original algorithm as an oracle and requires byte-identical output.
- `resources.ts` counts decoders, encoders, `<video>` elements and object URLs held by an export; every exit path releases them and the reliability suite asserts the counters return to zero after completion, failure, finalisation failure and cancel.
- `ExportNotice.tsx` is the only component that subscribes to export progress; the editor shell subscribes to a boolean-valued selector (`useExportActive`), so a progress tick does not re-render the editor.
