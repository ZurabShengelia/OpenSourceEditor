import { clipBox } from "../app/geometry";
import { nodeBox } from "../app/photoGeo";
import { getDoc, useDoc, usePlayhead, useUi } from "../app/store";
import { find } from "../doc/layerOps";

const r = (n: number): number => Math.round(n * 10) / 10;
function Geometry() {
  const mode = useUi((u) => u.mode), selC = useUi((u) => u.selClips), selL = useUi((u) => u.selLayers), doc = useDoc((d) => d); const t = usePlayhead();
  if (mode === "video" && selC.length === 1) { const c = doc.video.clips[selC[0]!]; const b = c && clipBox(getDoc(), c, t); if (b) return <span className="mono">X {r(b.cx - doc.video.width / 2)} Y {r(b.cy - doc.video.height / 2)} · {r(b.w)}×{r(b.h)} · {r(b.rot)}°</span>; }
  if (mode === "photo" && selL.length === 1) { const n = find(doc.photo.root, selL[0]!)?.node; const b = n && nodeBox(n, doc); if (b) return <span className="mono">X {r(b.cx - doc.photo.width / 2)} Y {r(b.cy - doc.photo.height / 2)} · {r(b.w)}×{r(b.h)} · {r(b.rot)}°</span>; }
  return null;
}
export function StatusBar({ onHelp }: { onHelp: () => void }) {
  const mode = useUi((u) => u.mode), status = useUi((u) => u.status), zoom = useUi((u) => u.photoZoom), dim = useDoc((d) => (mode === "video" ? d.video : d.photo));
  return (
    <footer className="statusbar">
      <span>{mode === "photo" ? "Photo" : "Video"}</span><span className="mono">{dim.width} × {dim.height}{mode === "video" ? ` · ${(dim as { fps: number }).fps} fps` : ` · ${Math.round(zoom * 100)}%`}</span>
      <Geometry />
      <span className="sp" />{status && <span className="msg" role="status">{status}</span>}
      <button onClick={onHelp} aria-label="Keyboard shortcuts">Shortcuts <span className="kbd" style={{ height: 14, lineHeight: "12px" }}>?</span></button>
    </footer>
  );
}
