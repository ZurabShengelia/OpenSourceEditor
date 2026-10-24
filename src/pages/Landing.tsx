import { useEffect, useState } from "react";
import { listProjects } from "../app/persist";
import type { ProjectMeta } from "../app/storage";
import { href } from "../app/router";
import { Icon, Mark, type IconName } from "../ui/Icon";

export const ENTRY_KEY = "loupe.entry";
const go = (entry: string): void => { try { sessionStorage.setItem(ENTRY_KEY, entry); } catch { } };

function PhotoDemo() {
  const tools: IconName[] = ["move", "marquee", "wand", "crop", "brush", "eraser"];
  return (
    <div className="demo" role="img" aria-label="Photo editor: tool rail, a layered image with a Magic Wand selection, and the layers panel">
      <div className="demo-rail">{tools.map((t) => <span key={t} className={t === "wand" ? "on" : ""}><Icon name={t} size={13} /></span>)}</div>
      <svg className="demo-canvas" viewBox="0 0 240 150" aria-hidden="true">
        <defs><linearGradient id="ld-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0e3a3f" /><stop offset="1" stopColor="#1f6f5a" /></linearGradient><pattern id="ld-chk" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#22282a" /><rect width="5" height="5" fill="#2b3234" /><rect x="5" y="5" width="5" height="5" fill="#2b3234" /></pattern></defs>
        <rect width="240" height="150" fill="url(#ld-chk)" /><rect x="14" y="12" width="212" height="126" rx="2" fill="url(#ld-sky)" />
        <circle cx="158" cy="56" r="20" fill="#e8d9a8" /><path d="M14 138V104l46-32 38 26 34-18 58 40v18z" fill="#0b2a2c" /><path d="M14 138v-18l50-22 44 20 46-14 72 34z" fill="#07191b" opacity=".85" />
        <circle className="ants" cx="158" cy="56" r="21.5" fill="rgba(87,201,216,.16)" stroke="#fff" strokeWidth="1.2" strokeDasharray="4 3" />
      </svg>
      <ul className="demo-layers" aria-hidden="true"><li><Icon name="eye" size={11} />Sun</li><li className="on"><Icon name="eye" size={11} />Mountains</li><li><Icon name="mask" size={11} />Sky + mask</li><li><Icon name="adjust" size={11} />Color</li></ul>
    </div>
  );
}
function VideoDemo() {
  return (
    <div className="demo vid" role="img" aria-label="Video editor: preview above a multitrack timeline with a playhead">
      <div className="demo-prev"><svg viewBox="0 0 160 90" aria-hidden="true"><rect width="160" height="90" fill="#0d3238" /><path d="M0 90V58l34-22 30 18 28-14 68 34v16z" fill="#0b4b43" /><circle cx="118" cy="26" r="10" fill="#e8d9a8" opacity=".9" /><text x="12" y="80" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui">Title</text></svg></div>
      <div className="demo-tl" aria-hidden="true">
        <div className="trk"><i className="c v" style={{ left: "0%", width: "38%" }} /><i className="c v" style={{ left: "40%", width: "42%" }} /></div>
        <div className="trk"><i className="c t" style={{ left: "6%", width: "24%" }} /></div>
        <div className="trk"><i className="c a" style={{ left: "0%", width: "82%" }} /></div>
        <b className="head" />
      </div>
    </div>
  );
}

export function Landing() {
  const [recent, setRecent] = useState<ProjectMeta[]>([]);
  useEffect(() => { void listProjects().then((l) => setRecent(l.slice(0, 5))).catch(() => undefined); }, []);
  return (
    <div className="landing">
      <header className="ld-top"><span className="brand"><Mark size={22} />OpenSourceEditor</span><span className="muted">Free and open source. Works offline. Your files stay on this device.</span></header>
      <main className="ld-main">
        <section className="ld-start" aria-label="Start">
          <div className="ld-brand"><Mark size={60} /><div><h1>OpenSourceEditor</h1><p>Edit photos and video in your browser. Layers, masks and selections for images; a multitrack timeline for video.</p></div></div>
          <a className="btn primary xl ld-open" href={href("editor")} onClick={() => go("start")}>Open Editor<Icon name="chevR" size={15} /></a>
          <h2>New project</h2>
          <ul className="ld-list">
            <li><a href={href("editor")} onClick={() => go("video")}><Icon name="video" size={18} /><span><b>Video project</b><small>Timeline, transitions, colour, audio</small></span></a></li>
            <li><a href={href("editor")} onClick={() => go("photo")}><Icon name="image" size={18} /><span><b>Photo project</b><small>Choose size and background</small></span></a></li>
          </ul>
          <h2>Recent projects</h2>
          {recent.length > 0 ? <ul className="ld-list">{recent.map((p) => <li key={p.id}><a href={href("editor")} onClick={() => go(`open:${p.id}`)}><Icon name="folder" size={18} /><span><b>{p.name}</b><small className="mono">{new Date(p.updatedAt).toLocaleDateString()}</small></span></a></li>)}</ul> : <p className="ld-none">No saved projects yet. Projects you edit are kept in this browser.</p>}
        </section>
        <section className="ld-view" aria-label="The editors">
          <figure><PhotoDemo /><figcaption><b>Photo</b>Layers, groups, masks, adjustment layers, Magic Wand and brush. Export PNG, JPEG or WebP.</figcaption></figure>
          <figure><VideoDemo /><figcaption><b>Video</b>Separate video and audio tracks, detach audio, transitions, keyframes and effects. Export WebM or MP4.</figcaption></figure>
        </section>
      </main>
    </div>
  );
}
