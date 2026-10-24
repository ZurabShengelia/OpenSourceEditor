import * as A from "../app/actions";
import { getDoc, setPref, setUi, transport, useDoc, usePlayhead, useUi } from "../app/store";
import { clipDuration } from "../doc/compose";
import { hasAnimation, valueAt } from "../doc/keyframes";
import { find } from "../doc/layerOps";
import type { AdjustKind, AnimProp, LayerNode, TClip, TextProps, Transition, TransitionKind } from "../doc/schema";
import { fontOptions, textMetrics, WEIGHTS } from "../doc/text";
import { BLEND_MODES, type BlendMode } from "../editor/blend";
import { DEFAULT_FILTERS, EFFECT_DEFS, type EffectKey, type Filters } from "../editor/effects";
import { Btn, Color, Field, Hint, IconButton, NumberBox, Section, Select, Seg, Slider, Tabs, Toggle } from "./controls";
import { HistogramPanel } from "./HistogramPanel";
import { Icon, type IconName } from "./Icon";

const def = (k: EffectKey) => EFFECT_DEFS.find((d) => d.key === k)!;
const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

function ResetKeys({ keys, filters, onChange }: { keys: EffectKey[]; filters: Filters; onChange: (f: Filters) => void }) {
  const dirty = keys.some((k) => filters[k] !== DEFAULT_FILTERS[k]); if (!dirty) return null;
  return <button className="ibtn xs reset" aria-label="Reset section" data-tip="Reset section" onClick={() => onChange({ ...filters, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_FILTERS[k]])) })}><Icon name="reset" size={12} /></button>;
}
const FX_HINT: Partial<Record<EffectKey, string>> = {
  exposure: "Overall brightness, like changing the camera's exposure", brightness: "Makes the whole picture lighter or darker", contrast: "The difference between light and dark areas",
  highlights: "Adjusts only the brightest areas", shadows: "Adjusts only the darkest areas", whites: "Sets the brightest point of the picture", blacks: "Sets the darkest point of the picture",
  saturation: "How vivid the colors are. 0% is black and white", hue: "Rotates every color around the color wheel", temperature: "Warmer (orange) to cooler (blue)", tint: "Shifts between green and magenta", grayscale: "Removes color, leaving black and white",
  sepia: "Warm brown, old-photo tone", invert: "Swaps light and dark, like a film negative", vintage: "Faded, warm retro look", film: "Adds film grain", vignette: "Darkens the edges of the picture", glow: "A soft bloom around bright areas",
  blur: "Softens the picture", sharpen: "Makes edges crisper", distortion: "Bulges or pinches the picture like a lens", chromatic: "Color fringing at the edges, like a cheap lens",
};
const fxLabel = (k: EffectKey): string => def(k).label.replace(" (px)", "").replace(" (EV)", "");
const fxValue = (k: EffectKey, v: number): string => { const d = def(k); const u = d.label.includes("(px)") ? " px" : d.label.includes("(EV)") ? " EV" : d.max > 10 || d.min < -10 ? "" : ""; return `${Math.round(v * 100) / 100}${u}`; };
function FilterSections({ groups, filters, onChange }: { groups: [string, EffectKey[]][]; filters: Filters; onChange: (f: Filters) => void }) {
  return <>{groups.map(([title, keys]) => <Section key={title} title={title} right={<ResetKeys keys={keys} filters={filters} onChange={onChange} />}>
    {keys.map((k) => { const d = def(k); return <Slider key={k} label={fxLabel(k)} hint={FX_HINT[k]} min={d.min} max={d.max} step={d.step} def={d.def} value={filters[k]} onChange={(v) => onChange({ ...filters, [k]: v })} />; })}</Section>)}</>;
}
function AppliedEffects({ groups, filters, onChange, noun }: { groups: [string, EffectKey[]][]; filters: Filters; onChange: (f: Filters) => void; noun: string }) {
  const keys = groups.flatMap(([, k]) => k); const active = keys.filter((k) => filters[k] !== DEFAULT_FILTERS[k]);
  return <Section title="Applied" badge={active.length || undefined} hint={active.length ? undefined : `Nothing applied yet. Move any slider below to add ${noun}.`} right={active.length > 1 ? <button className="btn ghost sm" onClick={() => onChange({ ...filters, ...Object.fromEntries(keys.map((k) => [k, DEFAULT_FILTERS[k]])) })}>Remove all</button> : null}>
    {active.length > 0 && <ul className="applied" aria-label="Applied adjustments">{active.map((k) => <li key={k}><span className="grow">{fxLabel(k)}</span><span className="mono">{fxValue(k, filters[k])}</span><IconButton icon="x" label={`Remove ${fxLabel(k)}`} size="xs" onClick={() => onChange({ ...filters, [k]: DEFAULT_FILTERS[k] })} /></li>)}</ul>}</Section>;
}
const COLOR_GROUPS: [string, EffectKey[]][] = [["Light", ["exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks"]], ["Color", ["saturation", "hue", "temperature", "tint", "grayscale"]]];
const FX_GROUPS: [string, EffectKey[]][] = [["Stylize", ["sepia", "invert", "vintage", "film", "vignette", "glow"]], ["Blur and sharpen", ["blur", "sharpen"]], ["Lens", ["distortion", "chromatic"]]];

function AlignRow() {
  const items: [IconName, Parameters<typeof A.alignSelection>[0], string][] = [["alignL", "left", "Align left"], ["alignHC", "hcenter", "Center horizontally"], ["alignR", "right", "Align right"], ["alignT", "top", "Align top"], ["alignVM", "vmiddle", "Center vertically"], ["alignB", "bottom", "Align bottom"]];
  return <Field label="Align"><div className="row tight">{items.map(([i, e, l]) => <IconButton key={e} icon={i} label={l} size="sm" onClick={() => A.alignSelection(e)} />)}</div></Field>;
}
function KeyBtn({ clip, prop }: { clip: TClip; prop: AnimProp }) {
  usePlayhead(); const fps = getDoc().video.fps; const on = !!A.keyframeAt(clip, prop, Math.min(Math.max(transport.t - clip.start, 0), clipDuration(clip)), fps), has = !!clip.keyframes[prop]?.length;
  return <button className={`ibtn xs keybtn ${on ? "on" : has ? "has" : ""}`} aria-label={`${on ? "Remove" : "Add"} ${prop} keyframe at playhead`} aria-pressed={on} data-tip={on ? "Remove keyframe here" : "Add keyframe at playhead"} onClick={() => A.toggleKeyframe(clip.id, prop)}><Icon name="keyframe" size={12} /></button>;
}
const anim = (c: TClip, p: AnimProp, label: string, min: number, max: number, step: number, to: (v: number) => number, from: (v: number) => number, unit: string, d: number, bare = false) => {
  const lt = Math.min(Math.max(transport.t - c.start, 0), clipDuration(c));
  return <Slider key={p} label={label} unit={unit} min={min} max={max} step={step} bare={bare} def={from(d)} value={Math.round(from(valueAt(c, p, lt)) * 100) / 100} onChange={(v) => A.setAnimated(c.id, p, to(v))} keyed={<KeyBtn clip={c} prop={p} />} />;
};

function Typography({ t, set }: { t: TextProps; set: (p: Partial<TextProps>) => void }) {
  const m = textMetrics(t);
  return <>
    <Section title="Content"><textarea aria-label="Text content" className="inp" rows={3} value={t.text} onFocus={() => A.beginTextEdit()} onBlur={() => A.endTextEdit()} onChange={(e) => set({ text: e.target.value })} /></Section>
    <Section title="Font">
      <Field label="Family"><Select label="Font family" value={t.font} onChange={(v) => set({ font: v })} options={fontOptions(t.font)} /></Field>
      <Field label="Weight"><Select label="Weight" value={String(t.weight)} onChange={(v) => set({ weight: Number(v) })} options={WEIGHTS} /><IconButton icon="italic" label="Italic" pressed={t.italic} onClick={() => set({ italic: !t.italic })} /></Field>
      <Slider label="Size" min={8} max={600} def={64} unit="px" value={t.size} onChange={(v) => set({ size: v })} />
    </Section>
    <Section title="Paragraph">
      <Field label="Align"><Seg label="Alignment" value={t.align} onChange={(v) => set({ align: v })} options={[{ id: "left", icon: "tLeft", tip: "Align left" }, { id: "center", icon: "tCenter", tip: "Align center" }, { id: "right", icon: "tRight", tip: "Align right" }]} /></Field>
      <Slider label="Line height" min={0.6} max={3} step={0.05} def={1.2} unit="×" value={m.lineHeight} onChange={(v) => set({ lineHeight: v })} />
      <Slider label="Tracking" min={-10} max={60} step={0.5} def={0} unit="px" value={m.tracking} onChange={(v) => set({ tracking: v })} />
    </Section></>;
}
function TextLook({ t, set }: { t: TextProps; set: (p: Partial<TextProps>) => void }) {
  const m = textMetrics(t);
  return <>
    <Section title="Fill"><Field label="Color"><Color label="Text color" value={t.color} onChange={(v) => set({ color: v })} /><span className="mono muted">{t.color}</span></Field></Section>
    <Section title="Stroke" open={t.outline > 0}><Slider label="Width" min={0} max={30} def={0} unit="px" value={t.outline} onChange={(v) => set({ outline: v })} /><Field label="Color"><Color label="Outline color" value={t.outlineColor} onChange={(v) => set({ outlineColor: v })} /></Field></Section>
    <Section title="Shadow" open={t.shadow > 0 || m.shadowX !== 0}><Slider label="Blur" min={0} max={60} def={0} unit="px" value={t.shadow} onChange={(v) => set({ shadow: v })} />
      <Slider label="Offset X" min={-60} max={60} def={0} unit="px" value={m.shadowX} onChange={(v) => set({ shadowX: v, shadowY: m.shadowY })} /><Slider label="Offset Y" min={-60} max={60} def={Math.round(t.shadow / 3)} unit="px" value={Math.round(m.shadowY * 10) / 10} onChange={(v) => set({ shadowY: v, shadowX: m.shadowX })} />
      <Field label="Color"><Color label="Shadow color" value={m.shadowColor} onChange={(v) => set({ shadowColor: v })} /></Field></Section></>;
}

function AnimationPanel({ c }: { c: TClip }) {
  const fps = getDoc().video.fps; usePlayhead(); const lt = Math.min(Math.max(transport.t - c.start, 0), clipDuration(c));
  return <>
    <Section title="Presets"><div className="preset-grid">{A.ANIM_PRESETS.map((p) => <Btn key={p.id} sm onClick={() => A.applyAnimation(c.id, p.id)}>{p.label}</Btn>)}</div>
      <Btn sm className="ghost" disabled={!hasAnimation(c.keyframes)} onClick={() => A.clearAnimation(c.id)}>Clear all keyframes</Btn></Section>
    <Section title="Keyframes">
      {(["x", "y", "scale", "rotation", "opacity", "volume"] as AnimProp[]).map((p) => { const list = c.keyframes[p] ?? []; return (
        <div key={p} className="kf-group"><div className="row"><span className="grow" style={{ fontWeight: 600, color: "var(--text-2)" }}>{p === "x" ? "Position X" : p === "y" ? "Position Y" : cap(p)}</span><Btn sm className="ghost" onClick={() => A.toggleKeyframe(c.id, p)}>{A.keyframeAt(c, p, lt, fps) ? "Remove here" : "Add at playhead"}</Btn></div>
          {list.length === 0 ? <span className="hint">Not animated</span> : list.map((k) => <div key={k.id} className="kf-item"><span className="mono muted">{k.t.toFixed(2)}s</span><span className="mono">{Math.round(k.v * 1000) / 1000}</span>
            <Select label={`${p} interpolation`} value={k.ease} onChange={(v) => A.setKeyframeEase(c.id, p, k.id, v)} options={[["linear", "Linear"], ["easeInOut", "Ease in-out"], ["hold", "Hold"]]} /><IconButton icon="trash" label="Delete keyframe" size="sm" onClick={() => A.removeKeyframe(c.id, p, k.id)} /></div>)}</div>); })}
      <p className="hint">Move the playhead, then change an animated value to record a keyframe. Drag diamonds on the timeline to retime.</p></Section></>;
}
function TransitionFields({ id, t }: { id: string; t: Transition }) {
  return <div className="insp-pad"><Field label="Type"><Select<TransitionKind> label="Transition type" value={t.kind} onChange={(v) => A.patchTransition(id, { kind: v })} options={[["cut", "Cut"], ["fade", "Fade through black"], ["dissolve", "Cross dissolve"], ["slide", "Slide"], ["wipe", "Wipe"]]} /></Field>
    <Slider label="Duration" unit="s" min={0.1} max={4} step={0.1} value={t.duration} def={1} onChange={(v) => A.patchTransition(id, { duration: v })} />
    {(t.kind === "slide" || t.kind === "wipe") && <Field label="Direction"><Select label="Direction" value={t.dir} onChange={(v) => A.patchTransition(id, { dir: v })} options={[["l", "From left"], ["r", "From right"], ["u", "From top"], ["d", "From bottom"]]} /></Field>}
    <Btn sm onClick={A.deleteSelection}>Remove transition</Btn></div>;
}

const TAB_ALIAS: Record<string, string> = { Transform: "Basic", Animation: "Advanced", Keyframes: "Advanced", Transition: "Basic" };
const pickTab = (tabs: readonly string[], stored: string): string => (tabs.includes(stored) ? stored : tabs.includes(TAB_ALIAS[stored] ?? "") ? TAB_ALIAS[stored]! : tabs[0]!);
function ClipInspector({ c }: { c: TClip }) {
  usePlayhead(); const isText = c.type === "text"; const tabs = isText ? ["Text", "Basic", "Style", "Advanced"] : ["Basic", "Audio", "Color", "Effects", "Advanced"]; const stored = useUi((u) => u.inspectorTab); const tab = pickTab(tabs, stored);
  const d = getDoc(); const out = d.video.transitions.find((x) => x.fromClipId === c.id); const track = d.video.tracks.find((t) => t.id === c.trackId); const mk = d.media[c.mediaId ?? ""]?.kind; const hasAudio = !isText && (mk === "audio" || mk === "video" || c.type === "compound"); const dur = clipDuration(c); const W = d.video.width, H = d.video.height;
  const set = (p: Partial<TextProps>): void => A.patchText(c.id, p);
  const clipSec = <Section title="This clip's sound" hint="Mute it, or split it from the picture to edit them separately."><Toggle label="Mute this clip" checked={!!c.muted} onChange={() => A.toggleClipFlag("muted", [c.id])} />
    <div className="btnrow">{A.canDetachAudio(c.id) && <Btn sm onClick={() => A.detachAudio([c.id])} tipLabel="Moves the sound onto its own audio clip so you can edit it separately">Detach audio</Btn>}{A.canLinkAudio(c.id) && <Btn sm onClick={() => A.linkAudio([c.id])}>Link audio &amp; video</Btn>}</div>
    {c.detached && <Hint>This clip's sound is on its own audio clip. Edit volume, fades and trim there.</Hint>}</Section>;
  const opacity = <Section title="Opacity" hint="Lower it to see through to the clips underneath.">{anim(c, "opacity", "Opacity", 0, 100, 1, (v) => v / 100, (v) => v * 100, "%", 1)}</Section>;
  return <><Tabs tabs={tabs} value={tab} onChange={(t) => setUi({ inspectorTab: t })} /><div className="insp-body">
    {tab === "Text" && c.text && <Typography t={c.text} set={set} />}
    {tab === "Basic" && <><Section title="Position and size" hint="Drag the picture in the preview, or type exact values.">{anim(c, "x", "Move horizontally", -100, 100, 0.1, (v) => v / 100, (v) => v * 100, "%", 0, true)}{anim(c, "y", "Move vertically", -100, 100, 0.1, (v) => v / 100, (v) => v * 100, "%", 0, true)}{anim(c, "scale", "Size", 5, 400, 1, (v) => v / 100, (v) => v * 100, "%", 1)}{anim(c, "rotation", "Rotate", -360, 360, 1, (v) => v, (v) => v, "°", 0)}<AlignRow /></Section>
      {opacity}
      {!isText && <Section title="Crop" open={Object.values(c.crop).some((v) => v > 0)} hint="Trim away the edges of the picture.">{(["l", "t", "r", "b"] as const).map((k) => <Slider key={k} label={{ l: "From left", t: "From top", r: "From right", b: "From bottom" }[k]} unit="%" min={0} max={90} def={0} value={Math.round(c.crop[k] * 100)} onChange={(v) => A.patchClip(c.id, { crop: { ...c.crop, [k]: v / 100 } })} />)}</Section>}
      {!isText && <Section title="Speed" open={c.speed !== 1} hint="2× plays twice as fast, 0.5× is slow motion. The sound keeps its pitch."><Slider label="Playback speed" unit="×" min={0.1} max={8} step={0.05} def={1} value={c.speed} onChange={(v) => A.setSpeed(c.id, v)} /></Section>}
      {track?.kind === "video" ? <Section title="Transition to next clip" hint="Blend into the clip that follows on this track.">{out ? <TransitionFields id={out.id} t={out} /> : <div className="preset-grid">{(["fade", "dissolve", "slide", "wipe"] as TransitionKind[]).map((k) => <Btn key={k} sm onClick={() => A.addTransition(c.id, k)}>{cap(k)}</Btn>)}</div>}</Section> : null}</>}
    {tab === "Style" && c.text && <><TextLook t={c.text} set={set} />{opacity}</>}
    {tab === "Audio" && (hasAudio ? c.detached ? clipSec : <>{clipSec}<Section title="Volume" hint="100% is the original loudness; above 100% boosts it.">{anim(c, "volume", "Volume", 0, 200, 1, (v) => v / 100, (v) => v * 100, "%", 1)}<Slider label="Balance" hint="Pan the sound toward the left (-1) or right (+1) speaker" min={-1} max={1} step={0.05} def={0} value={c.balance} onChange={(v) => A.patchClip(c.id, { balance: v })} /></Section>
      <Section title="Fade" hint="Ease the sound in at the start and out at the end."><Slider label="Fade in" unit="s" min={0} max={Math.max(0.1, dur / 2)} step={0.05} def={0} value={c.fadeIn} onChange={(v) => A.patchClip(c.id, { fadeIn: v })} /><Slider label="Fade out" unit="s" min={0} max={Math.max(0.1, dur / 2)} step={0.05} def={0} value={c.fadeOut} onChange={(v) => A.patchClip(c.id, { fadeOut: v })} /></Section>
      <Hint>Mute and solo for track {track?.name} are in the timeline header.</Hint></> : <p className="empty-sel">This clip has no sound to adjust.</p>)}
    {tab === "Color" && <><Hint>Correct how the picture looks. Every slider returns to neutral with its reset button.</Hint><FilterSections groups={COLOR_GROUPS} filters={c.filters} onChange={(f) => A.patchClip(c.id, { filters: f })} /></>}
    {tab === "Effects" && <><AppliedEffects groups={FX_GROUPS} filters={c.filters} onChange={(f) => A.patchClip(c.id, { filters: f })} noun="an effect" /><FilterSections groups={FX_GROUPS} filters={c.filters} onChange={(f) => A.patchClip(c.id, { filters: f })} /></>}
    {tab === "Advanced" && <><AnimationPanel c={c} />
      <Section title="Exact placement" open={false} hint="The same position as Basic, in pixels of the project frame.">{anim(c, "x", "X from center", -W, W, 1, (v) => v / W, (v) => v * W, "px", 0, true)}{anim(c, "y", "Y from center", -H, H, 1, (v) => v / H, (v) => v * H, "px", 0, true)}</Section>
      <Section title="Timing" open={false} hint="Where this clip sits on the timeline."><Field label="Start" hint="Seconds from the start of the project"><NumberBox label="Clip start" value={c.start} min={0} step={0.01} unit="s" onChange={(v) => A.moveClip(c.id, v)} /></Field><Field label="Length"><span className="mono">{dur.toFixed(2)} s</span></Field></Section></>}
  </div></>;
}

function MaskFields({ n }: { n: LayerNode }) {
  const maskEdit = useUi((u) => u.maskEdit);
  if (!n.mask) return <div className="insp-pad"><p className="hint">A mask hides parts of this layer without erasing pixels. White shows, black hides; paint it with the Brush (shows) and Eraser (hides).</p><div className="preset-grid"><Btn sm onClick={() => A.createMask(n.id, "reveal")}>Reveal all</Btn><Btn sm onClick={() => A.createMask(n.id, "hide")}>Hide all</Btn></div><Btn sm onClick={() => A.createMask(n.id, "selection")}>From selection</Btn></div>;
  const m = n.mask;
  return <><Section title="Mask"><Toggle label="Mask enabled" checked={m.enabled} onChange={(v) => A.patchMask(n.id, { enabled: v })} /><Toggle label="Invert mask" checked={m.inverted} onChange={(v) => A.patchMask(n.id, { inverted: v })} /><Slider label="Density" unit="%" min={0} max={100} def={100} value={Math.round(m.density * 100)} onChange={(v) => A.patchMask(n.id, { density: v / 100 })} /></Section>
    <Section title="Edit"><Toggle label="Paint on mask" checked={maskEdit} onChange={(v) => setUi({ maskEdit: v, tool: v ? "brush" : "move" })} /><p className="hint">Brush reveals, Eraser hides. Press Esc or untick to leave mask editing.</p><Btn sm danger onClick={() => A.deleteMask(n.id)}>Delete mask</Btn></Section></>;
}
function LayerInspector({ n }: { n: LayerNode }) {
  const kind = n.kind; const tabs = kind === "adjustment" ? ["Adjust", "Appearance", "Mask"] : kind === "group" ? ["Arrange", "Appearance", "Children"] : kind === "shape" ? ["Arrange", "Appearance", "Shape", "Mask"] : kind === "text" ? ["Text", "Arrange", "Appearance", "Color", "Effects", "Mask"] : ["Arrange", "Appearance", "Color", "Effects", "Mask"];
  const stored = useUi((u) => u.inspectorTab); const tab = tabs.includes(stored) ? stored : stored === "Transform" && tabs.includes("Arrange") ? "Arrange" : tabs[0]!; const p = (x: Partial<LayerNode>): void => A.patchNode(n.id, x); const filt = n.kind === "image" || n.kind === "paint" || n.kind === "text" ? n.filters : null;
  const setText = (x: Partial<TextProps>): void => { if (n.kind === "text") p({ props: { ...n.props, ...x } } as Partial<LayerNode>); };
  return <><Tabs tabs={tabs} value={tab} onChange={(t) => setUi({ inspectorTab: t })} /><div className="insp-body">
    {tab === "Text" && n.kind === "text" && <Typography t={n.props} set={setText} />}
    {tab === "Arrange" && <Section title="Position and size" hint="Drag the layer on the canvas, or type exact values. Align snaps it to the canvas edges and center."><Slider label="Move horizontally" unit="px" bare step={0.1} min={-4000} max={4000} def={0} value={Math.round(n.x * 10) / 10} onChange={(v) => p({ x: v })} /><Slider label="Move vertically" unit="px" bare step={0.1} min={-4000} max={4000} def={0} value={Math.round(n.y * 10) / 10} onChange={(v) => p({ y: v })} /><Slider label="Size" hint="100% is the original size" unit="%" min={1} max={500} def={100} value={Math.round(n.scale * 100)} onChange={(v) => p({ scale: v / 100 })} /><Slider label="Rotate" unit="°" min={-180} max={180} def={0} value={Math.round(n.rotation * 10) / 10} onChange={(v) => p({ rotation: v })} /><AlignRow /></Section>}
    {tab === "Appearance" && <><Section title="Blending" hint="Opacity makes the layer see-through. Blend mode changes how it mixes with the layers below."><Slider label="Opacity" unit="%" min={0} max={100} def={100} value={Math.round(n.opacity * 100)} onChange={(v) => p({ opacity: v / 100 })} /><Field label="Blend mode"><Select<BlendMode> label="Blend mode" value={n.blend} onChange={(v) => p({ blend: v })} options={BLEND_MODES.map((b) => [b.id, b.label] as const)} /></Field></Section>
      {n.kind === "text" && <TextLook t={n.props} set={setText} />}</>}
    {tab === "Shape" && n.kind === "shape" && <><Section title="Fill and stroke"><Field label="Fill"><Color label="Fill" value={n.fill} onChange={(v) => p({ fill: v } as Partial<LayerNode>)} /></Field><Field label="Stroke"><Color label="Stroke" value={n.stroke} onChange={(v) => p({ stroke: v } as Partial<LayerNode>)} /></Field><Slider label="Stroke width" unit="px" min={0} max={60} def={0} value={n.strokeWidth} onChange={(v) => p({ strokeWidth: v } as Partial<LayerNode>)} /></Section>
      <Section title="Size"><Slider label="Width" unit="px" min={1} max={4000} value={Math.round(n.w)} onChange={(v) => p({ w: v } as Partial<LayerNode>)} />{n.shape !== "line" && <Slider label="Height" unit="px" min={1} max={4000} value={Math.round(n.h)} onChange={(v) => p({ h: v } as Partial<LayerNode>)} />}</Section></>}
    {tab === "Color" && filt && <><Hint>Adjustments change how this layer looks without altering its pixels, so you can undo or reset them at any time.</Hint><FilterSections groups={COLOR_GROUPS} filters={filt} onChange={(f) => p({ filters: f } as Partial<LayerNode>)} /></>}
    {tab === "Effects" && filt && <><AppliedEffects groups={FX_GROUPS} filters={filt} onChange={(f) => p({ filters: f } as Partial<LayerNode>)} noun="an effect" /><FilterSections groups={FX_GROUPS} filters={filt} onChange={(f) => p({ filters: f } as Partial<LayerNode>)} /></>}
    {tab === "Adjust" && n.kind === "adjustment" && <Section title="Adjustment">{([["brightness", 0, 200, 100], ["contrast", 0, 200, 100], ["exposure", -3, 3, 0], ["saturation", 0, 300, 100], ["hue", -180, 180, 0], ["temperature", -100, 100, 0], ["tint", -100, 100, 0], ["grayscale", 0, 100, 0]] as [AdjustKind, number, number, number][]).map(([k, lo, hi, d]) => <Slider key={k} label={cap(k)} min={lo} max={hi} step={k === "exposure" ? 0.05 : 1} def={d} value={n.adjust[k] ?? d} onChange={(v) => p({ adjust: { ...n.adjust, [k]: v } } as Partial<LayerNode>)} />)}<p className="hint">Affects every layer below it in the same group. Lower its opacity to blend the effect.</p></Section>}
    {tab === "Children" && n.kind === "group" && (n.children.length ? <ul style={{ padding: 6 }}>{[...n.children].reverse().map((c) => <li key={c.id}><button className="btn ghost sm" style={{ width: "100%", justifyContent: "flex-start" }} onClick={() => A.selectLayer(c.id)}>{c.name}</button></li>)}</ul> : <p className="empty-sel">Empty group. Drag layers onto it in the Layers panel.</p>)}
    {tab === "Mask" && <MaskFields n={n} />}
  </div></>;
}

const askImport = (): void => { window.dispatchEvent(new Event("loupe:import")); };
const askExport = (): void => { window.dispatchEvent(new Event("loupe:export")); };
function Steps({ items }: { items: { done: boolean; title: string; body: React.ReactNode }[] }) {
  const next = items.findIndex((i) => !i.done);
  return <ol className="steps" aria-label="Getting started">{items.map((i, n) => <li key={n} className={i.done ? "done" : n === next ? "next" : ""}><b>{i.title}</b> {i.body}</li>)}</ol>;
}
function ProjectInspector() {
  const mode = useUi((u) => u.mode), v = useDoc((d) => d.video), P = useDoc((d) => d.photo), media = useDoc((d) => d.media);
  const hasMedia = Object.values(media).length > 0, hasClips = Object.keys(v.clips).length > 0;
  if (mode === "video") {
    const lead = !hasMedia ? "Start by importing a video, photo or sound." : !hasClips ? "Add your media to the timeline below." : "Click a clip on the timeline to change how it looks and sounds.";
    return <div className="insp-body"><p className="guide-lead">{lead}</p>
      <Section title="Getting started" open={!hasClips}><Steps items={[
        { done: hasMedia, title: "Import media.", body: <><span>Pick files, or drop them anywhere.</span><div className="btnrow"><Btn sm primary={!hasMedia} onClick={askImport}>Import media</Btn></div></> },
        { done: hasClips, title: "Place it on the timeline.", body: "Click + on a media item, or drag it onto a track." },
        { done: false, title: "Select and trim.", body: <>Click a clip, then drag its edges to trim. Press <span className="kbd">S</span> to split at the playhead.</> },
        { done: false, title: "Change its look.", body: "With a clip selected, this panel shows Basic, Audio, Color and Effects." },
        { done: false, title: "Add text or sound.", body: <><span>Text goes on its own track; audio files import like video.</span><div className="btnrow"><Btn sm onClick={A.addTextClip}>Add text</Btn></div></> },
        { done: false, title: "Export.", body: <><span>Choose format, size and frame rate.</span><div className="btnrow"><Btn sm disabled={!hasClips} onClick={askExport}>Export video…</Btn></div></> },
      ]} /></Section>
      <Section title="Project" open={false} hint="The size and frame rate of the finished video."><Field label="Size"><NumberBox label="Video width" value={v.width} min={16} max={7680} onChange={(w) => A.setVideoSize(w, v.height)} /><span className="muted">×</span><NumberBox label="Video height" value={v.height} min={16} max={4320} onChange={(h) => A.setVideoSize(v.width, h)} /></Field>
        <Field label="Frame rate"><Select label="Frame rate" value={String(v.fps)} onChange={(f) => A.setVideoSize(v.width, v.height, Number(f))} options={[["24", "24 fps"], ["25", "25 fps"], ["30", "30 fps"], ["60", "60 fps"]]} /></Field>
        <div className="preset-grid">{([[1920, 1080, "1080p"], [1280, 720, "720p"], [1080, 1920, "Vertical"], [1080, 1080, "Square"]] as const).map(([w, h, l]) => <Btn key={l} sm onClick={() => A.setVideoSize(w, h)}>{l}</Btn>)}</div></Section></div>;
  }
  const hasLayers = P.root.children.length > 0;
  return <div className="insp-body"><p className="guide-lead">{hasLayers ? "Click a layer in the Layers panel, or on the canvas, to edit it." : "Start by importing an image, or add text or a shape from the tools on the left."}</p>
    <Section title="Getting started" open={!hasLayers}><Steps items={[
      { done: hasLayers, title: "Add something.", body: <><span>Import an image, or use the Text and Shape tools.</span><div className="btnrow"><Btn sm primary={!hasLayers} onClick={askImport}>Import image</Btn></div></> },
      { done: false, title: "Select a layer.", body: "Pick it in the Layers panel or click it on the canvas. Handles appear for moving, sizing and rotating." },
      { done: false, title: "Arrange and adjust.", body: "Arrange moves and sizes it; Appearance sets opacity and blending; Color and Effects change how it looks without altering pixels." },
      { done: false, title: "Crop, select, paint.", body: <>Use the tools on the left. <span className="kbd">Space</span>+drag pans, scroll zooms.</> },
      { done: false, title: "Export.", body: <><span>PNG, JPEG or WebP at any size.</span><div className="btnrow"><Btn sm disabled={!hasLayers} onClick={askExport}>Export image…</Btn></div></> },
    ]} /></Section>
    <Section title="Canvas" open={false} hint="The size of the finished image."><Field label="Size"><NumberBox label="Canvas width" value={P.width} min={1} max={16000} onChange={(w) => A.setCanvasSize(w, P.height)} /><span className="muted">×</span><NumberBox label="Canvas height" value={P.height} min={1} max={16000} onChange={(h) => A.setCanvasSize(P.width, h)} /></Field></Section>
    <Section title="Histogram" open={false} hint="How light and dark the image is overall."><HistogramPanel /></Section></div>;
}

export function Inspector({ width, onCollapse }: { width: number; onCollapse: () => void }) {
  const mode = useUi((u) => u.mode), selClips = useUi((u) => u.selClips), selTr = useUi((u) => u.selTransition), selLayers = useUi((u) => u.selLayers); const doc = useDoc((d) => d);
  let body: React.ReactNode; let title = "Project"; let icon: IconName = "sliders"; let sub = "";
  if (mode === "video") {
    const tr = selTr ? doc.video.transitions.find((x) => x.id === selTr) : undefined;
    if (tr) { title = "Transition"; icon = "split"; sub = `${tr.duration.toFixed(1)}s`; body = <div className="insp-body"><TransitionFields id={tr.id} t={tr} /></div>; }
    else if (selClips.length === 1 && doc.video.clips[selClips[0]!]) { const c = doc.video.clips[selClips[0]!]!; title = c.type === "text" ? c.text?.text.split("\n")[0] || "Text" : c.type === "compound" ? doc.video.compounds?.[c.compoundId ?? ""]?.name ?? "Compound" : doc.media[c.mediaId ?? ""]?.name ?? "Clip"; icon = c.type === "text" ? "text" : doc.media[c.mediaId ?? ""]?.kind === "audio" ? "audio" : "video"; sub = `${clipDuration(c).toFixed(2)}s`; body = <ClipInspector c={c} />; }
    else if (selClips.length > 1) { title = `${selClips.length} clips`; icon = "layers"; const first = doc.video.clips[selClips[0]!]; body = <div className="insp-body"><Section title="Selection"><Slider label="Volume" unit="%" min={0} max={200} def={100} value={Math.round((first?.volume ?? 1) * 100)} onChange={(v) => A.patchClips(selClips, { volume: v / 100 })} /><AlignRow /><div className="row"><Btn sm onClick={() => A.duplicateClips(selClips)}>Duplicate</Btn><Btn sm danger onClick={A.deleteSelection}>Delete</Btn></div></Section></div>; }
    else body = <ProjectInspector />;
  } else {
    const n = selLayers.length === 1 ? find(doc.photo.root, selLayers[0]!)?.node : undefined;
    if (n) { title = n.name; icon = n.kind === "image" ? "image" : n.kind === "paint" ? "brush" : n.kind === "text" ? "text" : n.kind === "shape" ? "shape" : n.kind === "adjustment" ? "adjust" : "group"; sub = n.kind; body = <LayerInspector n={n} />; }
    else if (selLayers.length > 1) { title = `${selLayers.length} layers`; icon = "layers"; body = <div className="insp-body"><Section title="Selection"><AlignRow /><div className="row"><Btn sm onClick={A.addGroup}>Group</Btn><Btn sm danger onClick={A.deleteSelection}>Delete</Btn></div></Section></div>; }
    else body = <ProjectInspector />;
  }
  return <aside aria-label="Inspector" style={{ width }} className="panel insp"><div className="insp-head"><span className="ico"><Icon name={icon} size={14} /></span><h2 className="trunc">{title}</h2>{sub && <span className="sub">{sub}</span>}<IconButton icon="panelR" label="Hide inspector" size="sm" onClick={() => { onCollapse(); setPref("loupe.inspOpen", false); }} /></div>{body}</aside>;
}
