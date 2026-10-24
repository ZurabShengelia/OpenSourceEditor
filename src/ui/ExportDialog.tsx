import { useEffect, useMemo, useState } from "react";
import { docDuration } from "../doc/compose";
import { photoBlob, startPhotoExport, startVideoExport, probeEncoder, supportedFormats, supportedImageTypes, knownImageTypes, offlineFormats, type OfflineFormat, type VideoFormat } from "../app/exporter";
import { offlineAvailable } from "../app/offlineExport";
import { ASPECTS, CODEC_CHOICE, RESOLUTIONS, groupFormats, type ExportMethod, estimateBytes, hasAlpha, linkedSize, outputSize, videoBitrate, type Aspect, type ImgType, type QualityId, type ResolutionId } from "../app/exportPlan";
import { getDoc } from "../app/store";
import { Btn, Field, NumberBox, Select, Seg, Slider, Toggle, fmtSize } from "./controls";
import { Modal } from "./DialogHost";

type Probe = Record<string, { ok: boolean; reason?: string }>;
const PRESETS: readonly { res: ResolutionId; fps: 30 | 60; label: string }[] = [
  { res: "720", fps: 30, label: "720p 30" }, { res: "720", fps: 60, label: "720p 60" }, { res: "1080", fps: 30, label: "1080p 30" }, { res: "1080", fps: 60, label: "1080p 60" },
  { res: "1440", fps: 30, label: "1440p 30" }, { res: "1440", fps: 60, label: "1440p 60" }, { res: "2160", fps: 30, label: "4K 30" }, { res: "2160", fps: 60, label: "4K 60" }];
const AUDIO_KBPS = [96, 128, 192, 256] as const;

export function ExportDialog({ mode, onClose }: { mode: "video" | "photo"; onClose: () => void }) {
  return <Modal title={mode === "video" ? "Export video" : "Export image"} onClose={onClose} wide>{mode === "video" ? <VideoForm onClose={onClose} /> : <PhotoForm onClose={onClose} />}</Modal>;
}

function VideoForm({ onClose }: { onClose: () => void }) {
  const V = getDoc().video; const dur = docDuration(V); const rtFormats = useMemo(() => supportedFormats(), []);
  const [method, setMethod] = useState<ExportMethod>(offlineAvailable() ? "offline" : "realtime"), [offFormats, setOffFormats] = useState<OfflineFormat[] | null>(offlineAvailable() ? null : []);
  useEffect(() => { if (!offlineAvailable()) return; let live = true; void offlineFormats().then((f) => { if (!live) return; setOffFormats(f); if (!f.length) setMethod("realtime"); }); return () => { live = false; }; }, []);
  const formats: (VideoFormat | OfflineFormat)[] = method === "offline" ? offFormats ?? [] : rtFormats; const canOffline = (offFormats?.length ?? 0) > 0; const groups = groupFormats(formats);
  const [gid, setGid] = useState<string>(""), [cid, setCid] = useState<string>(""), [res, setRes] = useState<ResolutionId>("1080"), [fps, setFps] = useState<30 | 60>(30), [aspect, setAspect] = useState<Aspect>("original");
  const [quality, setQuality] = useState<QualityId>("medium"), [wantAudio, setAudio] = useState(true), [kbps, setKbps] = useState<number>(192), [probe, setProbe] = useState<Probe>({});
  const group = groups.find((g) => g.id === gid) ?? groups[0]; const fmt: VideoFormat | OfflineFormat | undefined = group?.options.find((f) => f.id === cid) ?? group?.options[0];
  useEffect(() => { if (groups.length && !groups.some((g) => g.id === gid)) setGid(groups[0]!.id); }, [groups, gid]); const audio = wantAudio && fmt?.audio !== "none";
  const size = (r: ResolutionId) => outputSize(V.width, V.height, r, aspect);
  const fmtKey = fmt ? `${fmt.id}|${fmt.codec}` : "";
  useEffect(() => {
    if (!fmt) return; let live = true; setProbe({});
    const keys = new Set<string>(); const jobs: { r: ResolutionId; f: 30 | 60 }[] = [];
    for (const p of PRESETS) { const k = `${p.res}|${p.fps}`; if (!keys.has(k)) { keys.add(k); jobs.push({ r: p.res, f: p.fps }); } }
    for (const r of RESOLUTIONS) for (const f of [30, 60] as const) { const k = `${r.id}|${f}`; if (!keys.has(k)) { keys.add(k); jobs.push({ r: r.id, f }); } }
    const acc: Probe = {}; let next = 0;
    const lane = async (): Promise<void> => { while (live && next < jobs.length) { const j = jobs[next++]!; const s = outputSize(V.width, V.height, j.r, aspect); const p = await probeEncoder(fmt, s.w, s.h, j.f, videoBitrate(s.w, s.h, j.f, quality)); if (!live) return; acc[`${j.r}|${j.f}`] = p; setProbe({ ...acc }); } };
    void lane(); void lane();
    return () => { live = false; };
  }, [fmtKey, aspect, quality, V.width, V.height]);
  const state = (r: ResolutionId, f: 30 | 60) => probe[`${r}|${f}`]; const ok = (r: ResolutionId, f: 30 | 60): boolean => state(r, f)?.ok === true;
  const resOpts = RESOLUTIONS.filter((r) => ok(r.id, fps) || r.id === res).map((r) => [r.id, `${r.label} (${size(r.id).w}×${size(r.id).h})`] as const);
  const cur = state(res, fps); const out = size(res); const vbps = videoBitrate(out.w, out.h, fps, quality), abps = audio ? kbps * 1000 : 0;
  const unavailable = RESOLUTIONS.flatMap((r) => ([30, 60] as const).filter((f) => state(r.id, f) && !ok(r.id, f)).map((f) => ({ r, f, why: state(r.id, f)?.reason }))).filter((u) => PRESETS.some((p) => p.res === u.r.id && p.fps === u.f));
  const empty = dur <= 0; const heavy = out.w * out.h * fps > 1920 * 1080 * 30; const go = (): void => { if (!fmt || !cur?.ok || empty) return; onClose(); const off = method === "offline" && "container" in fmt ? { container: fmt.container, codec: fmt.codec, audioCodec: audio ? fmt.audio : "none" as const } : undefined;
    void startVideoExport({ mime: "mime" in fmt ? fmt.mime : "", ext: fmt.ext, formatLabel: fmt.label, width: out.w, height: out.h, fps, videoBps: vbps, audio, audioBps: abps, method: off ? "offline" : "realtime", ...(off ? { offline: off } : {}) }); };
  if (!formats.length && (method === "realtime" || offFormats !== null)) return <><div className="dlg-b"><p className="dlg-msg">This browser cannot record video, so OpenSourceEditor cannot export from it. Try a current Chrome, Edge or Firefox.</p></div><div className="dlg-f"><Btn onClick={onClose}>Close</Btn></div></>;
  return (
    <>
      <div className="dlg-b xform">
        <p className="dlg-intro">Pick a quick setting, or fine-tune below. Only options this browser can really produce are offered.</p>
        <div className="sum" role="status" aria-live="polite"><b>{fmt?.label ?? "Checking what this browser can encode…"}</b><span>{out.w}×{out.h} · {fps} fps</span><span>{audio ? `${kbps} kbps sound` : "no sound"}</span><span>up to about {fmtSize(estimateBytes(dur, vbps, abps))}</span></div>
        <div className="presets" role="group" aria-label="Presets">{PRESETS.map((p) => { const s = state(p.res, p.fps); return <button key={p.label} className={`chip ${res === p.res && fps === p.fps ? "on" : ""}`} disabled={!s?.ok} aria-pressed={res === p.res && fps === p.fps} title={s && !s.ok ? s.reason : undefined} onClick={() => { setRes(p.res); setFps(p.fps); }}>{p.label}</button>; })}</div>
        <h3 className="grp">Format</h3>
        {canOffline && <><Field label="Method"><Seg label="Method" value={method} options={[{ id: "offline", label: "Frame-accurate" }, { id: "realtime", label: "Real-time" }]} onChange={setMethod} /></Field><p className="note">{method === "offline" ? "Renders every frame exactly, so the result is the same on any computer. A slower computer just takes longer." : "Records the timeline while it plays. Needs a computer fast enough to play it smoothly, or frames are dropped."}</p></>}
        <Field label="Format"><Select label="Format" value={group?.id ?? ""} options={groups.length ? groups.map((g) => [g.id, g.label] as const) : [["", "Checking…"] as const]} onChange={(v) => { setGid(v); setCid(""); }} /></Field>
        <Field label="Aspect ratio"><Seg label="Aspect ratio" value={aspect} options={ASPECTS.map((a) => ({ id: a.id, label: a.label }))} onChange={setAspect} /></Field>
        <h3 className="grp">Size and speed</h3>
        <Field label="Resolution"><Select label="Resolution" value={res} options={resOpts.length ? resOpts : [[res, "Checking…"]]} onChange={setRes} /></Field>
        <Field label="Frame rate"><Seg label="Frame rate" value={String(fps) as "30" | "60"} options={([30, 60] as const).filter((f) => ok(res, f) || f === fps).map((f) => ({ id: String(f) as "30" | "60", label: `${f} FPS` }))} onChange={(v) => setFps(v === "60" ? 60 : 30)} /></Field>
        <h3 className="grp">Quality and sound</h3>
        <Field label="Quality"><Seg label="Quality" value={quality} options={[{ id: "low", label: "Low" }, { id: "medium", label: "Medium" }, { id: "high", label: "High" }]} onChange={setQuality} /></Field>
        <Field label="Audio"><Toggle label="Include audio" checked={audio} disabled={!fmt || fmt.audio === "none"} onChange={setAudio} /></Field>
        {audio && <Field label="Audio bitrate"><Select label="Audio bitrate" value={String(kbps)} options={AUDIO_KBPS.map((k) => [String(k), `${k} kbps`] as const)} onChange={(v) => setKbps(Number(v))} /></Field>}
        {group && group.options.length > 1 && fmt && <details className="adv"><summary>Advanced</summary><Field label="Video codec"><Select label="Video codec" value={fmt.id} options={group.options.map((f) => [f.id, CODEC_CHOICE[f.codec].label] as const)} onChange={setCid} /><span className="hint">{CODEC_CHOICE[fmt.codec].hint}</span></Field></details>}
        <dl className="facts">
          <dt>Output</dt><dd>{out.w}×{out.h}, {fps} fps{aspect !== "original" ? `, ${aspect} with black bars where the shapes differ` : ""}</dd>
          <dt>Video bitrate</dt><dd>{(vbps / 1e6).toFixed(1)} Mbps</dd>
          <dt>Target size</dt><dd>up to about {fmtSize(estimateBytes(dur, vbps, abps))} for {dur.toFixed(1)} s. The encoder aims for this bitrate; simple footage usually comes out smaller.</dd>
          <dt>Export time</dt><dd>{method === "offline" ? "Every frame is rendered exactly, so the result is the same on any machine; a slower machine just takes longer." : `about ${Math.ceil(dur)} s. OpenSourceEditor plays the timeline in real time to record it; a slow machine can drop frames at high resolutions.`}</dd>
        </dl>
        {heavy && method === "realtime" && <p className="note">This is demanding: OpenSourceEditor records in real time, so a machine that cannot render and encode {out.w}×{out.h} at {fps} fps will drop frames or the browser may stop the recording. If that happens, lower the resolution or frame rate.</p>}
        {empty && <p className="note">The timeline is empty. Add a clip before exporting.</p>}
        <p className="note">MOV is not offered. Browsers cannot write real QuickTime files, and renaming MP4 or WebM data to .mov would produce a mislabelled file.</p>
        {cur && !cur.ok && <p className="note err" role="alert">{RESOLUTIONS.find((r) => r.id === res)?.label} at {fps} FPS isn't available here: {cur.reason ?? "this browser cannot encode it"}. Pick another preset above; nothing is changed for you.</p>}
        {fmt?.note && <p className="note">{fmt.note}</p>}
        {unavailable.length > 0 && <p className="note">Unavailable here: {unavailable.map((u) => `${u.r.label} ${u.f} FPS`).join(", ")}. {unavailable[0]?.why}</p>}
      </div>
      <div className="dlg-f"><Btn onClick={onClose}>Cancel</Btn><Btn primary disabled={!cur?.ok || empty} onClick={go} autoFocus>Export</Btn></div>
    </>
  );
}

function PhotoForm({ onClose }: { onClose: () => void }) {
  const P = getDoc().photo;
  const [types, setTypes] = useState<ImgType[]>(knownImageTypes() ?? ["image/png"]), [type, setType] = useState<ImgType>("image/png"), [w, setW] = useState(P.width), [h, setH] = useState(P.height), [keep, setKeep] = useState(true), [q, setQ] = useState(92), [bg, setBg] = useState<"transparent" | "#ffffff" | "#000000">("transparent");
  useEffect(() => { let live = true; void supportedImageTypes().then((t) => { if (live) setTypes(t); }); return () => { live = false; }; }, []);
  const alpha = hasAlpha(type); const bgv = alpha ? (bg === "transparent" ? null : bg) : bg === "#000000" ? "#000000" : "#ffffff";
  const setSize = (edit: "w" | "h", v: number): void => { if (keep) { const s = linkedSize(P.width, P.height, edit, v); setW(s.w); setH(s.h); } else if (edit === "w") setW(Math.min(16384, Math.max(1, Math.round(v)))); else setH(Math.min(16384, Math.max(1, Math.round(v)))); };
  const original = w === P.width && h === P.height; const [bytes, setBytes] = useState<number | null>(null), [sizeErr, setSizeErr] = useState<string | null>(null);
  useEffect(() => { setBytes(null); setSizeErr(null); const ac = new AbortController(); const t = setTimeout(() => { photoBlob({ type, width: w, height: h, quality: q / 100, background: bgv }, ac.signal).then((b) => { if (!ac.signal.aborted) setBytes(b.size); }).catch((e: unknown) => { if (!ac.signal.aborted) setSizeErr(e instanceof Error ? e.message : "Could not encode"); }); }, 350); return () => { clearTimeout(t); ac.abort(); }; }, [type, w, h, q, bgv]);
  const go = (): void => { onClose(); void startPhotoExport({ type, width: w, height: h, quality: q / 100, background: bgv }); };
  return (
    <>
      <div className="dlg-b xform">
        <Field label="Format"><Seg label="Format" value={type} options={types.map((t) => ({ id: t, label: t === "image/png" ? "PNG" : t === "image/jpeg" ? "JPEG" : "WebP" }))} onChange={setType} /></Field>
        <Field label="Dimensions"><div className="xform-dim">
        <div className="row2"><NumberBox label="Width" unit="px" min={1} max={16384} value={w} onChange={(v) => setSize("w", v)} /><NumberBox label="Height" unit="px" min={1} max={16384} value={h} onChange={(v) => setSize("h", v)} /></div>
        <Toggle label="Keep proportions" checked={keep} onChange={setKeep} />
        {!original && <div><Btn onClick={() => { setW(P.width); setH(P.height); }}>Reset to original size ({P.width}×{P.height})</Btn></div>}
        </div></Field>
        {type === "image/png" ? <p className="note">PNG is lossless, so there is no quality setting.</p> : <Slider label="Quality" value={q} min={1} max={100} def={92} onChange={setQ} />}
        <Field label="Background"><Select label="Background" value={bgv ?? "transparent"} options={alpha ? [["transparent", "Transparent"], ["#ffffff", "White"], ["#000000", "Black"]] : [["#ffffff", "White"], ["#000000", "Black"]]} onChange={(v) => setBg(v as typeof bg)} /></Field>
        {!alpha && <p className="note">JPEG has no transparency, so the image is flattened onto the background.</p>}
        <dl className="facts"><dt>Output</dt><dd>{w}×{h} px, {type.split("/")[1]!.toUpperCase()}</dd><dt>File size</dt><dd>{sizeErr ? <span className="err-text">{sizeErr}</span> : bytes === null ? "Calculating…" : `${fmtSize(bytes)} (exact for these settings)`}</dd></dl>
      </div>
      <div className="dlg-f"><Btn onClick={onClose}>Cancel</Btn><Btn primary onClick={go} autoFocus>Export</Btn></div>
    </>
  );
}
