const P = {
  import: "M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14", export: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19h14", save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  undo: "M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 8h-3", redo: "M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 8h3", search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.2 15.2 20 20",
  x: "M6 6l12 12M18 6 6 18", plus: "M12 5v14M5 12h14", minus: "M5 12h14", check: "M5 12.5l4.5 4.5L19 7.5", more: "M5.5 12h.01M12 12h.01M18.5 12h.01",
  folder: "M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z", chevR: "M9 6l6 6-6 6", chevD: "M6 9l6 6 6-6", up: "M12 19V5M6 11l6-6 6 6", down: "M12 5v14M6 13l6 6 6-6", reset: "M5 12a7 7 0 1 0 2.2-5.1M5 4.5V9h4.5",
  panelL: "M4 5h16v14H4zM9 5v14", panelR: "M4 5h16v14H4zM15 5v14", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13", copy: "M8 8h11v12H8zM5 16V4h11",
  video: "M4 5h16v14H4zM8 5v14M16 5v14M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4", audio: "M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2", image: "M4 5h16v14H4zM4 16.5l5-5 4 4 3-3 4 4M15 9.2h.01",
  move: "M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5",
  marquee: "M5 5h3M11 5h3M17 5h2v2M19 11v3M19 17v2h-2M14 19h-3M8 19H5v-2M5 14v-3M5 8V5", ellipse: "M12 5c4 0 7 3 7 7s-3 7-7 7-7-3-7-7 3-7 7-7z",
  crop: "M7 3v14h14M3 7h14v14", brush: "M4 20c3 0 4-2 4-4l8-9 3 3-9 8c-1 1-3 2-6 2zM14 6l3-3 4 4-3 3", eraser: "M4 16l8-9 8 8-4 4H8zM9 12l6 6M12 20h8",
  fill: "M5 13l7-8 7 8-6 6zM19 15c1 1.5 2 2.5 2 3.5a2 2 0 0 1-4 0c0-1 1-2 2-3.5z", eyedropper: "M15 4l5 5-3 3-5-5zM13 8l-9 9v3h3l9-9", wand: "M4 20 14 10M14 10l2-2M16 4v3M14.5 5.5h3M20 9v2.5M18.8 10.2h2.4M9 4v2M8 5h2M19 15v2M18 16h2", shape: "M4 5h9v9H4zM14 10a5 5 0 1 0 0 .1z",
  text: "M6 6h12M12 6v13M9 19h6", hand: "M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2 6-5 6-3 0-4-2-5-4l-2-4a1.5 1.5 0 0 1 3-1l1 2",
  zoom: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5M8 10h4M10 8v4",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", eyeOff: "M3 3l18 18M10 5.2A9 9 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.6M6.5 6.8C3.8 8.6 2 12 2 12s4 7 10 7c1.5 0 2.8-.4 4-1",
  lock: "M7 11h10v8H7zM9 11V8a3 3 0 0 1 6 0v3", unlock: "M7 11h10v8H7zM9 11V8a3 3 0 0 1 5.5-1.7", mask: "M4 4h16v16H4zM12 4a8 8 0 0 1 0 16z",
  group: "M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z", adjust: "M12 3a9 9 0 1 0 0 18zM12 3v18", layers: "M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  play: "M7 4.5v15l12-7.5z", pause: "M7 5h3.5v14H7zM13.5 5H17v14h-3.5z", skipStart: "M6 5v14M19 5 9 12l10 7z", skipEnd: "M18 5v14M5 5l10 7-10 7z", stepBack: "M15 5l-7 7 7 7", stepFwd: "M9 5l7 7-7 7",
  split: "M12 3v18M7 8 4 12l3 4M17 8l3 4-3 4", keyframe: "M12 4l7 8-7 8-7-8z", magnet: "M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4", fit: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5", safe: "M3 6h18v12H3zM6.5 9h11v6h-11z",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4", rulers: "M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4",
  alignL: "M4 4v16M8 7h12M8 14h7", alignHC: "M12 3v18M6 7h12M8.5 14h7", alignR: "M20 4v16M4 7h12M9 14h7", alignT: "M4 4h16M7 8v12M14 8v7", alignVM: "M3 12h18M7 6v12M14 8.5v7", alignB: "M4 20h16M7 4v12M14 9v7",
  flag: "M6 21V4M6 5h11l-2.5 3.5L17 12H6", cut: "M6 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8 9l12 9M8 15 20 6", paste: "M9 4h6v3H9zM7 5.5H5v15h14v-15h-2M9 12h6M9 16h6", volOff: "M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6",
  tLeft: "M4 6h16M4 10h10M4 14h16M4 18h10", tCenter: "M4 6h16M7 10h10M4 14h16M7 18h10", tRight: "M4 6h16M10 10h10M4 14h16M10 18h10", italic: "M10 5h7M7 19h7M14 5l-4 14",
} as const;
export type IconName = keyof typeof P;
const FILLED = new Set<IconName>(["play", "pause"]);
export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const f = FILLED.has(name);
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={f ? "currentColor" : "none"} stroke="currentColor" strokeWidth={f ? 1 : 1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={P[name]} /></svg>;
}
export { Mark } from "./Logo";
export const kindIcon = (k: string): IconName => (k === "video" ? "video" : k === "audio" ? "audio" : k === "image" ? "image" : "layers");
