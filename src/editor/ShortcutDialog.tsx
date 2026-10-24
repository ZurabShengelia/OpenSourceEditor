import { Modal } from "../ui/DialogHost";

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
const GROUPS: { title: string; rows: [string, string[]][] }[] = [
  { title: "General", rows: [["Save project", [mod, "S"]], ["Import media", [mod, "O"]], ["Undo", [mod, "Z"]], ["Redo", [mod, "Shift", "Z"]], ["Deselect / cancel", ["Esc"]], ["Shortcuts", ["?"]]] },
  { title: "Video timeline", rows: [["Command palette", [mod, "K"]], ["Play / pause", ["Space"]], ["Go to start / end", ["Home", "/", "End"]], ["Split at playhead", ["S"]], ["Delete selected", ["Del"]], ["Cut / copy / paste clips", [mod, "X", "/", "C", "/", "V"]], ["Duplicate clips", [mod, "D"]], ["Add marker", ["M"]], ["Previous / next marker", [",", "/", "."]], ["Mute / disable / lock clips", ["Shift", "M", "/", "E", "/", "L"]], ["Nudge selected clip", ["←", "/", "→"]], ["Select all clips", [mod, "A"]], ["Add to selection", [mod, "Click"]], ["Select range", ["Shift", "Click"]], ["Marquee select", ["Drag"]], ["Zoom timeline", [mod, "Wheel"]], ["Snap off while dragging", ["Alt", "Drag"]]] },
  { title: "Nudge (clips and layers)", rows: [["Move by one frame / pixel", ["←", "→", "↑", "↓"]], ["Fine (tenth of a step)", ["Shift", "Arrow"]], ["Coarse (ten steps)", ["Alt", "Arrow"]]] },
  { title: "Photo tools", rows: [["Move · Select · Ellipse · Crop", ["V", "M", "L", "C"]], ["Brush · Eraser · Fill · Picker", ["B", "E", "G", "I"]], ["Shape · Text · Hand · Zoom", ["U", "T", "H", "Z"]], ["Brush size", ["[", "]"]], ["Pan while held", ["Space"]], ["Select all / none", [mod, "A", "/", mod, "D"]], ["Copy · Cut · Paste", [mod, "C", "/", "X", "/", "V"]], ["Erase selected pixels", ["Del"]], ["Apply / cancel crop", ["Enter", "/", "Esc"]]] },
  { title: "View and transform", rows: [["Zoom canvas", [mod, "Wheel"]], ["Pan", ["Wheel", "/", "Middle drag"]], ["Rotate in 15° steps", ["Shift", "Drag handle"]], ["Snap off while moving", ["Alt", "Drag"]]] },
];
export function ShortcutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} wide>
      <div className="sc-grid">{GROUPS.map((g) => <div key={g.title}><h3>{g.title}</h3><dl>{g.rows.map(([d, k]) => <div key={d}><dt>{d}</dt><dd>{k.map((x, i) => (x === "/" ? <span key={i} className="muted">/</span> : <span key={i} className="kbd">{x}</span>))}</dd></div>)}</dl></div>)}</div>
    </Modal>
  );
}
