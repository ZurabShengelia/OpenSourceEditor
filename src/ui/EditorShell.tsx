import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as A from "../app/actions";
import { askConfirm, askText } from "../app/dialogs";
import { player } from "../app/engine";
import { dismissExport, exportActive, useExportActive } from "../app/exporter";
import { ExportNotice } from "./ExportNotice";
import { renderStats } from "../app/renderStats";
import { newDocument, openSaved, listProjects, renameCurrent, saveAs, saveCurrent } from "../app/persist";
import { docDuration } from "../doc/compose";
import { getDoc, getUi, redo, setPref, setUi, undo, useCanRedo, useCanUndo, useDoc, useSaved, useUi, type PhotoTool } from "../app/store";
import { ContextMenuHost } from "../editor/ContextMenu";
import { isMenuOpen, type MenuItem } from "../editor/Menu";
import { ShortcutDialog } from "../editor/ShortcutDialog";
import { Splitter, useSize } from "../editor/Splitter";
import { TooltipHost } from "../editor/Tooltip";
import { IconButton } from "./controls";
import { DialogHost } from "./DialogHost";
import { ExportDialog } from "./ExportDialog";
import { StartDialog, STARTED_KEY } from "./StartDialog";
import { NewPhotoDialog } from "./NewPhotoDialog";
import { ENTRY_KEY } from "../pages/Landing";
import { CommandPalette } from "./CommandPalette";
import { fromMenu, workspaceCommands, type Command } from "../app/commands";
import { Inspector } from "./Inspector";
import { LayersPanel } from "./LayersPanel";
import { MediaBin } from "./MediaBin";
import { PhotoCanvas } from "./PhotoCanvas";
import { Preview } from "./Preview";
import { ProjectDialog } from "./ProjectDialog";
import { StatusBar } from "./StatusBar";
import { Timeline } from "./Timeline";
import { TopBar } from "./TopBar";
import { ToolRail, type IconName, type RailItem } from "./ToolRail";

const TOOLS: [PhotoTool, IconName, string, string][] = [["move", "move", "Move", "V"], ["marquee", "marquee", "Rectangle selection", "M"], ["ellipse", "ellipse", "Ellipse selection", "L"], ["crop", "crop", "Crop", "C"], ["brush", "brush", "Brush", "B"], ["eraser", "eraser", "Eraser", "E"], ["fill", "fill", "Fill", "G"], ["eyedropper", "eyedropper", "Eyedropper", "I"], ["wand", "wand", "Magic Wand", "W"], ["shape", "shape", "Shape", "U"], ["text", "text", "Text", "T"], ["hand", "hand", "Hand", "H"], ["zoom", "zoom", "Zoom", "Z"]];
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform), MOD = MAC ? "⌘" : "Ctrl";
const typing = (el: EventTarget | null): boolean => el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "color"].includes(el.type)) || (el instanceof HTMLElement && el.isContentEditable);

const NARROW_PX = 1180;
function useNarrow(px: number): boolean {
  return useSyncExternalStore((f) => { const m = window.matchMedia(`(max-width: ${px - 1}px)`); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, () => window.matchMedia(`(max-width: ${px - 1}px)`).matches);
}
export function EditorShell() {
  renderStats.shell++;
  const mode = useUi((u) => u.mode), tool = useUi((u) => u.tool), name = useDoc((d) => d.name), saved = useSaved(), canUndo = useCanUndo(), canRedo = useCanRedo(), binOpen = useUi((u) => u.binOpen), inspOpen = useUi((u) => u.inspOpen), brushColor = useUi((u) => u.brush.color), snapping = useUi((u) => u.snapping), rulers = useUi((u) => u.rulers), safeAreas = useUi((u) => u.safeAreas);
  const [error, setError] = useState<string | null>(null), [help, setHelp] = useState(false), [dialog, setDialog] = useState(false), [exportOpen, setExportOpen] = useState(false), [newPhoto, setNewPhoto] = useState(false), [palette, setPalette] = useState(false), [start, setStart] = useState(() => { try { return !sessionStorage.getItem(STARTED_KEY) && !sessionStorage.getItem(ENTRY_KEY); } catch { return false; } }), [recent, setRecent] = useState<{ id: string; name: string }[]>([]);
  const [inspW, setInspW] = useSize("loupe.inspector", 344, 300, 560), [tlH, setTlH] = useSize("loupe.timeline", 300, 170, 640), [layH, setLayH] = useSize("loupe.layers", 230, 110, 460), [binW, setBinW] = useSize("loupe.bin", 236, 190, 420);
  const fail = (e: unknown): void => { setError(e instanceof Error ? e.message : "Something went wrong"); };
  const save = (): void => { setError(null); saveCurrent().then(() => setUi({ status: `Saved at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` })).catch(fail); };
  const refreshRecent = (): void => { void listProjects().then((l) => setRecent(l.slice(0, 5))).catch(() => undefined); };
  useEffect(refreshRecent, [saved]);
  const fileRef = useRef<HTMLInputElement>(null); const pick = (): void => fileRef.current?.click();
  const narrow = useNarrow(NARROW_PX); const userToggled = useRef(false);
  const toggleBin = (on: boolean): void => { userToggled.current = true; setUi({ binOpen: on }); setPref("loupe.binOpen", on); };
  useEffect(() => {
    let entry: string | null = null; try { entry = sessionStorage.getItem(ENTRY_KEY); sessionStorage.removeItem(ENTRY_KEY); } catch { }
    if (!entry || entry === "start") { if (entry === "start") setStart(true); return; }
    try { sessionStorage.setItem(STARTED_KEY, "1"); } catch { }
    if (entry === "photo") { setUi({ mode: "photo" }); setNewPhoto(true); }
    else if (entry === "video") { newDocument(); setUi({ mode: entry }); }
    else if (entry.startsWith("open:")) void openSaved(entry.slice(5)).catch((e: unknown) => { setStart(true); setError(e instanceof Error ? e.message : "Could not open that project"); });
  }, []);
  useEffect(() => { const i = (): void => pick(); const x = (): void => { if (!exportActive()) setExportOpen(true); }; window.addEventListener("loupe:import", i); window.addEventListener("loupe:export", x); return () => { window.removeEventListener("loupe:import", i); window.removeEventListener("loupe:export", x); }; }, []);
  useEffect(() => { const f = (): void => { if (userToggled.current) return; if (window.innerWidth < NARROW_PX) { if (getUi().binOpen) setUi({ binOpen: false }); if (getUi().inspOpen) setUi({ inspOpen: false }); } }; f(); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);

  const paletteCommands = (): Command[] => {
    const all = [...workspaceCommands(mode, MOD), ...fromMenu("Edit", edit), ...fromMenu("File", file), ...fromMenu("View", view.filter((v) => !("label" in v) || v.label !== "Command palette…")), ...fromMenu("Export", exportItems),
      { id: "ws", title: mode === "photo" ? "Switch to Video workspace" : "Switch to Photo workspace", group: "Workspace", enabled: !exporting, run: () => setMode(mode === "photo" ? "video" : "photo") }, { id: "imp", title: "Import media", group: "File", shortcut: `${MOD}+O`, enabled: true, run: pick }, { id: "help", title: "Keyboard shortcuts", group: "Help", shortcut: "?", enabled: true, run: () => setHelp(true) }];
    const seen = new Set<string>(); return all.filter((c) => { const k = c.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  };
  const activeKind = useExportActive(); const exporting = activeKind !== null;
  const exportItems: MenuItem[] = [{ label: mode === "photo" ? "Export image…" : "Export video…", disabled: exporting, onSelect: () => setExportOpen(true) }];

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(); if (mod && k === "s") { e.preventDefault(); save(); return; }
      if (mod && k === "k") { e.preventDefault(); if (!document.querySelector("[role=dialog]:not(.palette)") && !exportActive()) setPalette((o) => !o); return; }
      const el = e.target; if (typing(el)) return; if (document.querySelector("[role=dialog], dialog[open]")) return;
      if (exportActive()) { if (mod || e.key === "Delete" || e.key === "Backspace" || e.key === " ") e.preventDefault(); return; }
      const u = getUi(), t = el instanceof HTMLElement ? el : null; const onRange = t instanceof HTMLInputElement && t.type === "range", inWidget = !!t?.closest("[role=separator], [role=menu], [role=tablist], [role=slider]"), onButton = !!t?.closest("button, a, summary");
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); player.refresh(); }
      else if (mod && k === "y") { e.preventDefault(); redo(); player.refresh(); }
      else if (mod && k === "o") { e.preventDefault(); pick(); }
      else if (mod && k === "a" && u.mode === "photo") { e.preventDefault(); A.selectAll(); }
      else if (mod && k === "a" && u.mode === "video") { e.preventDefault(); A.selectAllClips(); }
      else if (mod && k === "c" && u.mode === "video") { e.preventDefault(); A.copyClips(); }
      else if (mod && k === "x" && u.mode === "video") { e.preventDefault(); A.cutClips(); }
      else if (mod && k === "v" && u.mode === "video") { e.preventDefault(); A.pasteClips(); }
      else if (mod && k === "d" && u.mode === "video") { e.preventDefault(); A.duplicateClips(getUi().selClips); }
      else if (mod && k === "d" && u.mode === "photo") { e.preventDefault(); A.deselect(); }
      else if (mod && e.shiftKey && k === "i" && u.mode === "photo") { e.preventDefault(); A.invertSelection(); }
      else if (mod && k === "c" && u.mode === "photo") { e.preventDefault(); A.copySelection(); }
      else if (mod && k === "x" && u.mode === "photo") { e.preventDefault(); A.cutSelection(); }
      else if (mod && k === "v" && u.mode === "photo") { e.preventDefault(); A.paste(); }
      else if (mod || e.altKey && !e.key.startsWith("Arrow")) return;
      else if (e.key === " " && u.mode === "video") { if (onButton || inWidget) return; e.preventDefault(); player.toggle(); }
      else if (e.key === "Home" && u.mode === "video") { e.preventDefault(); player.seek(0); }
      else if (e.key === "End" && u.mode === "video") { e.preventDefault(); player.seek(docDuration(getDoc().video)); }
      else if (k === "s" && u.mode === "video") A.splitAtPlayhead();
      else if (u.mode === "video" && e.shiftKey && k === "m") A.toggleClipFlag("muted");
      else if (u.mode === "video" && e.shiftKey && k === "e") A.toggleClipFlag("disabled");
      else if (u.mode === "video" && e.shiftKey && k === "l") A.toggleClipFlag("locked");
      else if (u.mode === "video" && k === "m") A.addMarkerAt();
      else if (u.mode === "video" && (e.key === "," || e.key === ".")) A.jumpToMarker(e.key === "." ? 1 : -1);
      else if (e.key === "Delete" || e.key === "Backspace") { if (inWidget) return; if (u.mode === "photo" && u.selection && (u.tool === "marquee" || u.tool === "ellipse" || u.tool === "wand")) A.deleteSelectionPixels(); else A.deleteSelection(); }
      else if (e.key.startsWith("Arrow")) { if (onRange || inWidget || (t instanceof HTMLButtonElement && t.getAttribute("role") === "tab")) return; e.preventDefault(); const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0; A.nudge(dx, dy, e.shiftKey, e.altKey); }
      else if (e.key === "?") setHelp(true);
      else if (e.key === "Escape") { if (isMenuOpen()) return; A.deselect(); if (getUi().maskEdit) setUi({ maskEdit: false }); }
      else if ((e.key === "[" || e.key === "]") && u.mode === "photo") { const b = u.brush; setUi({ brush: { ...b, size: Math.min(400, Math.max(1, Math.round(b.size * (e.key === "]" ? 1.15 : 1 / 1.15) + (e.key === "]" ? 1 : -1)))) } }); }
      else if (u.mode === "photo") { const tl = TOOLS.find((x) => x[3].toLowerCase() === k); if (tl) setUi({ tool: tl[0] }); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { const f = (e: BeforeUnloadEvent): void => { if (saved) return; e.preventDefault(); }; window.addEventListener("beforeunload", f); return () => window.removeEventListener("beforeunload", f); }, [saved]);

  const setMode = (m: "photo" | "video"): void => { if (exporting) { setUi({ status: "Finish or cancel the export before switching workspace" }); return; } player.pause(); dismissExport(); setUi({ mode: m, selClips: [], selLayers: [], selTransition: null, maskEdit: false, inspectorTab: "", status: "" }); };
  const confirmNew = async (): Promise<boolean> => saved || askConfirm("Start a new project?", "Unsaved changes in the current project will be lost.", { ok: "Discard and start new", danger: true });
  const newDoc = (): void => { void confirmNew().then((ok) => { if (ok) newDocument(); }); };
  const rename = (n: string): void => { void renameCurrent(n).catch(fail); };
  const askSaveAs = (): void => { void askText("Save project as", `${name} copy`, { ok: "Save" }).then((n) => (n ? saveAs(n).catch(fail) : undefined)); };
  const photo = mode === "photo";
  const file: MenuItem[] = [{ label: "New project", onSelect: newDoc }, { label: "New photo project…", onSelect: () => void confirmNew().then((ok) => { if (ok) setNewPhoto(true); }) }, { label: "Open project…", onSelect: () => setDialog(true) }, ...(recent.length ? [{ sep: true } as MenuItem, { heading: "Recent" } as MenuItem, ...recent.map((r) => ({ label: `Recent: ${r.name}`, onSelect: () => void openSaved(r.id).catch(fail) }))] : []),
    { sep: true }, { label: "Save", shortcut: `${MOD}+S`, onSelect: save }, { label: "Save as…", onSelect: askSaveAs }, { label: "Rename project…", onSelect: () => void askText("Rename project", name, { ok: "Rename" }).then((n) => (n ? rename(n) : undefined)) }, { sep: true }, { label: "Import media…", shortcut: `${MOD}+O`, onSelect: pick }];
  const edit: MenuItem[] = [{ label: "Undo", shortcut: `${MOD}+Z`, disabled: !canUndo, onSelect: () => { undo(); player.refresh(); } }, { label: "Redo", shortcut: `${MOD}+Shift+Z`, disabled: !canRedo, onSelect: () => { redo(); player.refresh(); } }, { sep: true }, { label: "Delete selected", shortcut: "Del", onSelect: A.deleteSelection },
    ...(photo ? [{ sep: true } as MenuItem, { label: "Select all", shortcut: `${MOD}+A`, onSelect: A.selectAll }, { label: "Deselect", shortcut: `${MOD}+D`, onSelect: A.deselect }, { label: "Invert selection", shortcut: `${MOD}+Shift+I`, onSelect: A.invertSelection }, { sep: true } as MenuItem, { label: "Copy selection", shortcut: `${MOD}+C`, onSelect: A.copySelection }, { label: "Cut selection", shortcut: `${MOD}+X`, onSelect: A.cutSelection }, { label: "Paste", shortcut: `${MOD}+V`, onSelect: A.paste }] : [{ label: "Select all clips", shortcut: `${MOD}+A`, onSelect: A.selectAllClips } as MenuItem])];
  const view: MenuItem[] = [{ label: "Command palette…", shortcut: `${MOD}+K`, onSelect: () => setPalette(true) }, { sep: true }, { label: "Media panel", checked: binOpen, onSelect: () => toggleBin(!binOpen) }, { label: "Inspector", checked: inspOpen, onSelect: () => { setUi({ inspOpen: !inspOpen }); setPref("loupe.inspOpen", !inspOpen); } }, { sep: true }, { label: "Snapping", checked: snapping, onSelect: () => setUi({ snapping: !snapping }) },
    photo ? { label: "Rulers", checked: rulers, onSelect: () => setUi({ rulers: !rulers }) } : { label: "Safe areas", checked: safeAreas, onSelect: () => setUi({ safeAreas: !safeAreas }) }, { sep: true }, { label: "Fit to window", onSelect: () => setUi(photo ? { fit: true } : { vFit: true }) }, { label: "Keyboard shortcuts", shortcut: "?", onSelect: () => setHelp(true) }];

  const rail: RailItem[] = photo
    ? [{ icon: "import", label: "Import image", shortcut: `${MOD}+O`, group: 0, onClick: pick }, ...TOOLS.map(([id, icon, label, key]) => ({ icon, label, shortcut: key, group: id === "move" ? 1 : id === "marquee" || id === "ellipse" || id === "wand" || id === "crop" ? 2 : id === "brush" || id === "eraser" || id === "fill" || id === "eyedropper" ? 3 : id === "shape" || id === "text" ? 4 : 5, active: tool === id, onClick: () => setUi({ tool: id }) }))]
    : [{ icon: "import", label: "Import media", shortcut: `${MOD}+O`, group: 0, onClick: pick }, { icon: "text", label: "Add text", group: 1, onClick: A.addTextClip }, { icon: "split", label: "Split at playhead", shortcut: "S", group: 1, onClick: A.splitAtPlayhead }];
  return (
    <div className="app">
      <TopBar mode={mode} setMode={setMode} name={name} onRename={rename} saved={saved} onSave={save} canUndo={canUndo} canRedo={canRedo} onUndo={() => { undo(); player.refresh(); }} onRedo={() => { redo(); player.refresh(); }} file={file} edit={edit} view={view} exportItems={exportItems} exporting={exporting} />
      <ExportNotice error={error} clearError={() => setError(null)} />
      <div className="work" inert={activeKind === "video"}>
        <input ref={fileRef} type="file" hidden multiple accept="video/*,audio/*,image/*" onChange={(e) => { const f = Array.from((e.target.files ?? []) as ArrayLike<File>); e.target.value = ""; A.importFiles(f).catch(fail); }} />
        <ToolRail items={rail} {...(photo ? { color: brushColor, onColor: (c: string) => setUi((u) => ({ brush: { ...u.brush, color: c } })) } : {})} />
        {binOpen ? narrow ? <><div className="drawer-scrim" onClick={() => toggleBin(false)} /><div className="drawer l" role="complementary" aria-label="Media drawer"><MediaBin onError={(m) => fail(new Error(m))} width={Math.min(binW, 320)} /></div></> : <><MediaBin onError={(m) => fail(new Error(m))} width={binW} /><Splitter dir="v" label="Resize media panel" onDrag={(d) => setBinW((w) => w + d)} onReset={() => setBinW(236)} /></>
          : <div className="rail l"><IconButton icon="panelL" label="Show media panel" size="sm" onClick={() => toggleBin(true)} /><span className="vtxt">Media</span></div>}
        <div className="center">
          {photo ? <PhotoCanvas onImport={pick} /> : <><Preview onImport={pick} /><Splitter dir="h" label="Resize timeline" onDrag={(d) => setTlH((h) => h - d)} onReset={() => setTlH(300)} /><div style={{ height: tlH, minWidth: 0 }} className="tlwrap"><Timeline onImport={pick} /></div></>}
        </div>
        {inspOpen ? <>
          {narrow ? <div className="drawer-scrim" onClick={() => setUi({ inspOpen: false })} /> : <Splitter dir="v" label="Resize inspector" onDrag={(d) => setInspW((w) => w - d)} onReset={() => setInspW(344)} />}
          {photo ? <div className={`rcol ${narrow ? "drawer r" : ""}`} style={{ width: narrow ? Math.min(inspW, 340) : inspW }}><LayersPanel height={layH} /><Splitter dir="h" label="Resize layers panel" onDrag={(d) => setLayH((h) => h + d)} onReset={() => setLayH(230)} /><Inspector width={inspW} onCollapse={() => setUi({ inspOpen: false })} /></div> : <div className={`rcol ${narrow ? "drawer r" : ""}`} style={{ width: narrow ? Math.min(inspW, 340) : inspW }}><Inspector width={inspW} onCollapse={() => setUi({ inspOpen: false })} /></div>}</>
          : <div className="rail r"><IconButton icon="panelR" label="Show inspector" size="sm" onClick={() => { setUi({ inspOpen: true }); setPref("loupe.inspOpen", true); }} /><span className="vtxt">Inspector</span></div>}
      </div>
      <StatusBar onHelp={() => setHelp(true)} />
      <ContextMenuHost /><TooltipHost /><DialogHost />{newPhoto && <NewPhotoDialog onClose={() => setNewPhoto(false)} />}{start && <StartDialog onNewPhoto={() => setNewPhoto(true)} onDone={() => setStart(false)} onBrowse={() => setDialog(true)} onError={(m) => fail(new Error(m))} />}{palette && <CommandPalette commands={paletteCommands()} onClose={() => setPalette(false)} />}{exportOpen && <ExportDialog mode={mode} onClose={() => setExportOpen(false)} />}<ShortcutDialog open={help} onClose={() => setHelp(false)} /><ProjectDialog open={dialog} onClose={() => setDialog(false)} onError={(m) => fail(new Error(m))} confirmNew={confirmNew} />
    </div>
  );
}
