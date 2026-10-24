import * as A from "./actions";
import { getDoc, getUi, setUi, transport, type PhotoTool } from "./store";
import { player } from "./engine";

import type { Command } from "./commandSearch";
export { fromMenu, search, score, type Command } from "./commandSearch";

const TOOLS: readonly [PhotoTool, string, string][] = [["move", "Move", "V"], ["marquee", "Rectangle select", "M"], ["ellipse", "Ellipse select", ""], ["crop", "Crop", "C"], ["brush", "Brush", "B"], ["eraser", "Eraser", "E"], ["fill", "Fill", "G"], ["eyedropper", "Eyedropper", "I"], ["wand", "Magic Wand", "W"], ["shape", "Shape", "U"], ["text", "Text", "T"], ["hand", "Hand (pan)", "H"], ["zoom", "Zoom", "Z"]];

export function workspaceCommands(mode: "video" | "photo", mod = "Ctrl"): Command[] {
  const d = getDoc(), u = getUi(); const k = (id: string, title: string, group: string, run: () => void, o: Partial<Command> = {}): Command => ({ id, title, group, enabled: true, run, ...o });
  if (mode === "photo") return [
    ...TOOLS.map(([t, name, key]) => k(`tool:${t}`, `Tool: ${name}`, "Tools", () => setUi({ tool: t }), { ...(key ? { shortcut: key } : {}), checked: u.tool === t, keywords: "tool" })),
    k("p:selall", "Select all pixels", "Selection", A.selectAll, { shortcut: `${mod}+A` }), k("p:desel", "Deselect", "Selection", A.deselect, { shortcut: `${mod}+D`, enabled: !!u.selection }), k("p:invsel", "Invert selection", "Selection", A.invertSelection, { shortcut: `${mod}+Shift+I`, enabled: !!u.selection }),
    k("p:text", "Add text layer", "Layer", () => A.addTextLayer()), k("p:group", "Group selected layers", "Layer", A.addGroup, { shortcut: `${mod}+G` }),
    k("p:ungroup", "Ungroup layer", "Layer", () => { const id = getUi().selLayers[0]; if (id) A.ungroupLayer(id); }, { enabled: u.selLayers.length === 1 }), k("p:dup", "Duplicate layer", "Layer", () => { const id = getUi().selLayers[0]; if (id) A.duplicateLayer(id); }, { enabled: u.selLayers.length > 0 }),
    k("p:del", "Delete selection", "Layer", A.deleteSelection, { shortcut: "Del", enabled: u.selLayers.length > 0 }), k("p:fit", "Fit canvas to window", "View", () => setUi({ fit: true }), { keywords: "zoom" }), k("p:100", "Zoom to 100%", "View", () => setUi({ fit: false, photoZoom: 1 }), { keywords: "zoom actual" }),
  ];
  const sel = u.selClips, has = sel.length > 0, one = sel.length === 1 ? d.video.clips[sel[0]!] : undefined;
  return [
    k("v:play", "Play / pause", "Playback", () => (transport.playing ? player.pause() : player.play()), { shortcut: "Space" }), k("v:start", "Go to start", "Playback", () => player.seek(0), { shortcut: "Home" }),
    k("v:split", "Split at playhead", "Clip", A.splitAtPlayhead, { shortcut: "S" }), k("v:text", "Add text clip", "Clip", A.addTextClip), k("v:dup", "Duplicate clips", "Clip", () => A.duplicateClips(getUi().selClips), { shortcut: `${mod}+D`, enabled: has }),
    k("v:cut", "Cut clips", "Clip", () => A.cutClips(), { shortcut: `${mod}+X`, enabled: has }), k("v:copy", "Copy clips", "Clip", () => A.copyClips(), { shortcut: `${mod}+C`, enabled: has }), k("v:paste", "Paste clips at playhead", "Clip", () => A.pasteClips(), { shortcut: `${mod}+V`, enabled: A.hasClipClipboard() }),
    k("v:del", "Delete selected clips", "Clip", A.deleteSelection, { shortcut: "Del", enabled: has }), k("v:selall", "Select all clips", "Clip", A.selectAllClips, { shortcut: `${mod}+A` }),
    k("v:detach", "Detach audio from video", "Audio", () => A.detachAudio(), { enabled: sel.some((i) => A.canDetachAudio(i)), keywords: "separate split sound" }), k("v:link", "Link audio & video", "Audio", () => A.linkAudio(), { enabled: sel.some((i) => A.canLinkAudio(i)), keywords: "attach merge sound" }),
    k("v:mute", "Mute / unmute clips", "Audio", () => A.toggleClipFlag("muted"), { shortcut: "Shift+M", enabled: has }), k("v:disable", "Disable / enable clips", "Clip", () => A.toggleClipFlag("disabled"), { shortcut: "Shift+E", enabled: has }), k("v:lock", "Lock / unlock clips", "Clip", () => A.toggleClipFlag("locked"), { shortcut: "Shift+L", enabled: has }),
    k("v:compound", "Create compound clip", "Clip", () => A.createCompoundClip(), { enabled: has && getDoc() !== undefined, keywords: "nest group wrap" }), k("v:break", "Break apart compound clip", "Clip", () => one && A.breakApartCompound(one.id), { enabled: one?.type === "compound", keywords: "ungroup unnest" }),
    k("v:marker", "Add marker at playhead", "Timeline", () => A.addMarkerAt(), { shortcut: "M" }), k("v:nextm", "Go to next marker", "Timeline", () => A.jumpToMarker(1), { shortcut: ".", enabled: (d.video.markers?.length ?? 0) > 0 }), k("v:prevm", "Go to previous marker", "Timeline", () => A.jumpToMarker(-1), { shortcut: ",", enabled: (d.video.markers?.length ?? 0) > 0 }),
    k("v:tv", "Add video track", "Timeline", () => A.addTrack("video")), k("v:ta", "Add audio track", "Timeline", () => A.addTrack("audio")), k("v:tt", "Add text track", "Timeline", () => A.addTrack("text")),
    k("v:snap", "Toggle snapping", "Timeline", () => setUi({ snapping: !getUi().snapping }), { checked: u.snapping }),
  ];
}
