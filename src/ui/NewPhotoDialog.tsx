import { useState } from "react";
import { newPhotoDocument, PHOTO_MAX, type PhotoBackground } from "../app/persist";
import { setUi } from "../app/store";
import { Btn, Field, NumberBox, Seg } from "./controls";
import { Modal } from "./DialogHost";

export const PHOTO_PRESETS = [
  { id: "hd", label: "1920 × 1080", w: 1920, h: 1080 }, { id: "story", label: "1080 × 1920", w: 1080, h: 1920 }, { id: "square", label: "1080 × 1080", w: 1080, h: 1080 },
  { id: "post", label: "1080 × 1350", w: 1080, h: 1350 }, { id: "4k", label: "3840 × 2160", w: 3840, h: 2160 }, { id: "custom", label: "Custom", w: 0, h: 0 },
] as const;

export function NewPhotoDialog({ onClose, onCreated }: { onClose: () => void; onCreated?: () => void }) {
  const [name, setName] = useState("Untitled"), [w, setW] = useState(1920), [h, setH] = useState(1080), [bg, setBg] = useState<"transparent" | "white" | "black" | "custom">("white"), [color, setColor] = useState("#1d2527");
  const preset = PHOTO_PRESETS.find((p) => p.w === w && p.h === h)?.id ?? "custom";
  const background: PhotoBackground = bg === "custom" ? color : bg, valid = w >= 1 && h >= 1 && w <= PHOTO_MAX && h <= PHOTO_MAX, mp = (w * h) / 1e6;
  const create = (): void => { if (!valid) return; newPhotoDocument({ name, width: w, height: h, background }); setUi({ mode: "photo", fit: true }); onCreated?.(); onClose(); };
  return (
    <Modal title="New photo project" onClose={onClose}>
      <div className="dlg-b newphoto">
        <Field label="Name"><input className="inp full" aria-label="Document name" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") create(); }} /></Field>
        <Field label="Preset"><div className="np-presets" role="group" aria-label="Size presets">{PHOTO_PRESETS.map((p) => <button key={p.id} type="button" className="np-preset" aria-pressed={preset === p.id} onClick={() => { if (p.w) { setW(p.w); setH(p.h); } }}>{p.label}</button>)}</div></Field>
        <Field label="Pixels"><span className="np-dims"><NumberBox label="Width in pixels" value={w} min={1} max={PHOTO_MAX} unit="px" onChange={setW} /><span aria-hidden="true">×</span><NumberBox label="Height in pixels" value={h} min={1} max={PHOTO_MAX} unit="px" onChange={setH} /></span></Field>
        <Field label="Background"><Seg label="Background" value={bg} onChange={setBg} options={[{ id: "transparent", label: "Transparent" }, { id: "white", label: "White" }, { id: "black", label: "Black" }, { id: "custom", label: "Color" }]} />{bg === "custom" && <input type="color" className="swatch" aria-label="Background color" value={color} onChange={(e) => setColor(e.target.value)} />}</Field>
        <div className="np-preview" aria-hidden="true"><div className={`np-page ${bg === "transparent" ? "checker" : ""}`} style={{ aspectRatio: `${w} / ${h}`, background: bg === "transparent" ? undefined : background }} /></div>
        <p className="np-note mono">{w} × {h} px · {mp.toFixed(1)} megapixels{bg === "transparent" ? " · transparent (exports as PNG or WebP with alpha)" : ""}{!valid ? ` · each side must be 1 to ${PHOTO_MAX} px` : ""}</p>
      </div>
      <div className="dlg-f"><Btn onClick={onClose}>Cancel</Btn><span className="grow" /><Btn primary disabled={!valid} onClick={create}>Create</Btn></div>
    </Modal>
  );
}
