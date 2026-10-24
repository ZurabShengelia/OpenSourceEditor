import { useState } from "react";
import { addAdjustment, addGroup, addPaintLayer, addShapeLayer, addTextLayer, createMask, deleteMask, deleteSelection, duplicateLayer, moveLayerTo, patchMask, patchNode, reorderLayer, selectLayer, ungroupLayer } from "../app/actions";
import { getDoc, setUi, useDoc, useUi } from "../app/store";
import { find } from "../doc/layerOps";
import type { AdjustKind, GroupNode, LayerNode } from "../doc/schema";
import { BLEND_MODES, type BlendMode } from "../editor/blend";
import { openContextMenu } from "../editor/ContextMenu";
import { Menu } from "../editor/Menu";
import { IconButton, NumberBox } from "./controls";
import { Icon, type IconName } from "./Icon";

const KIND: Record<LayerNode["kind"], string> = { image: "Image", paint: "Paint", text: "Text", shape: "Shape", adjustment: "Adjustment", group: "Group" };
const ICON: Record<LayerNode["kind"], IconName> = { image: "image", paint: "brush", text: "text", shape: "shape", adjustment: "adjust", group: "group" };
const ADJ: AdjustKind[] = ["brightness", "contrast", "exposure", "saturation", "hue", "temperature", "tint", "grayscale"];
type Drop = { id: string; pos: "above" | "below" | "into" } | null;

export function LayersPanel({ height }: { height: number }) {
  const root = useDoc((d) => d.photo.root), media = useDoc((d) => d.media), sel = useUi((u) => u.selLayers), maskEdit = useUi((u) => u.maskEdit);
  const [closed, setClosed] = useState<Set<string>>(new Set()); const [rename, setRename] = useState<string | null>(null); const [dragId, setDragId] = useState<string | null>(null); const [drop, setDrop] = useState<Drop>(null);
  const toggle = (id: string): void => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const doDrop = (target: LayerNode, parent: GroupNode, idx: number, pos: "above" | "below" | "into"): void => {
    if (!dragId || dragId === target.id) return; const src = find(getDoc().photo.root, dragId); if (!src) return;
    if (pos === "into" && target.kind === "group") moveLayerTo(dragId, target.id); else { const ins = pos === "above" ? idx + 1 : idx; const adj = src.parent.id === parent.id && src.index < ins ? ins - 1 : ins; moveLayerTo(dragId, parent.id, adj); }
    setDragId(null); setDrop(null);
  };
  const menu = (e: React.MouseEvent, n: LayerNode): void => { if (!sel.includes(n.id)) selectLayer(n.id);
    openContextMenu(e, [{ label: "Rename", shortcut: "F2", onSelect: () => setRename(n.id) }, { label: "Duplicate", onSelect: () => duplicateLayer(n.id) }, { sep: true }, { label: "Group selected", onSelect: addGroup }, ...(n.kind === "group" ? [{ label: "Ungroup", onSelect: () => ungroupLayer(n.id) }] : []),
      { label: "Bring forward", onSelect: () => reorderLayer(n.id, 1) }, { label: "Send backward", onSelect: () => reorderLayer(n.id, -1) }, { sep: true },
      ...(n.kind === "adjustment" ? [] : n.mask ? [{ label: n.mask.enabled ? "Disable mask" : "Enable mask", onSelect: () => patchMask(n.id, { enabled: !n.mask!.enabled }) }, { label: "Invert mask", onSelect: () => patchMask(n.id, { inverted: !n.mask!.inverted }) }, { label: "Delete mask", onSelect: () => deleteMask(n.id) }] : [{ label: "Add mask: reveal all", onSelect: () => createMask(n.id, "reveal") }, { label: "Add mask: hide all", onSelect: () => createMask(n.id, "hide") }, { label: "Add mask from selection", onSelect: () => createMask(n.id, "selection") }]),
      { sep: true }, { label: "Delete", shortcut: "Del", danger: true, onSelect: deleteSelection }]); };
  const row = (n: LayerNode, parent: GroupNode, idx: number, depth: number): React.ReactNode => {
    const on = sel.includes(n.id), g = n.kind === "group", m = n.kind === "image" ? media[n.mediaId] : undefined;
    return (
      <li key={n.id} role="none">
        <div role="treeitem" aria-selected={on} aria-expanded={g ? !closed.has(n.id) : undefined} aria-label={`${n.name}, ${KIND[n.kind]} layer`} tabIndex={0} draggable
          className={`lrow ${n.visible ? "" : "hidden"} ${dragId === n.id ? "dragging" : ""} ${drop?.id === n.id ? `drop-${drop.pos === "above" ? "before" : drop.pos === "below" ? "after" : "into"}` : ""}`}
          onDragStart={(e) => { setDragId(n.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", n.id); }} onDragEnd={() => { setDragId(null); setDrop(null); }}
          onDragOver={(e) => { if (!dragId || dragId === n.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; setDrop({ id: n.id, pos: g && y > 0.28 && y < 0.72 ? "into" : y < 0.5 ? "above" : "below" }); }}
          onDragLeave={() => setDrop((d) => (d?.id === n.id ? null : d))} onDrop={(e) => { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; doDrop(n, parent, idx, g && y > 0.28 && y < 0.72 ? "into" : y < 0.5 ? "above" : "below"); }}
          onClick={(e) => selectLayer(n.id, e.shiftKey || e.ctrlKey || e.metaKey)} onKeyDown={(e) => { if (e.target !== e.currentTarget) return; if (e.key === "Enter") selectLayer(n.id); if (e.key === "F2") setRename(n.id); }} onContextMenu={(e) => menu(e, n)}
          style={{ paddingLeft: 4 + depth * 14 }}>
          {Array.from({ length: depth }, (_, i) => <span key={i} className="guide" style={{ left: 11 + i * 14 }} />)}
          {g ? <button className="tog" aria-label={closed.has(n.id) ? "Expand group" : "Collapse group"} onClick={(e) => { e.stopPropagation(); toggle(n.id); }}><Icon name={closed.has(n.id) ? "chevR" : "chevD"} size={11} /></button> : <span className="tog" />}
          <button className={`ibtn xs vis ${n.visible ? "" : "on"}`} aria-label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`} aria-pressed={!n.visible} data-tip={n.visible ? "Hide layer" : "Show layer"} onClick={(e) => { e.stopPropagation(); patchNode(n.id, { visible: !n.visible, locked: n.locked }); }}><Icon name={n.visible ? "eye" : "eyeOff"} size={13} /></button>
          <span className="lico">{m?.thumb ? <img src={m.thumb} alt="" /> : <Icon name={ICON[n.kind]} size={12} />}</span>
          {rename === n.id ? <input autoFocus defaultValue={n.name} aria-label="Layer name" onClick={(e) => e.stopPropagation()} onFocus={(e) => e.currentTarget.select()} onBlur={(e) => { patchNode(n.id, { name: e.target.value.trim() || n.name }); setRename(null); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRename(null); }} />
            : <span className="lname trunc" onDoubleClick={() => setRename(n.id)}>{n.name}</span>}
          {n.opacity < 1 && <span className="lop">{Math.round(n.opacity * 100)}%</span>}
          {n.mask && <button className={`chip ${n.mask.enabled ? "" : "off"}`} aria-label={`Edit mask of ${n.name}`} aria-pressed={on && maskEdit} data-tip={n.mask.enabled ? "Mask: click to paint it" : "Mask (disabled)"} onClick={(e) => { e.stopPropagation(); selectLayer(n.id); setUi({ maskEdit: !(on && maskEdit), ...(!(on && maskEdit) ? { tool: "brush" } : {}) }); }}><Icon name="mask" size={12} /></button>}
          <button className={`ibtn xs vis ${n.locked ? "on" : ""}`} aria-label={n.locked ? `Unlock ${n.name}` : `Lock ${n.name}`} aria-pressed={n.locked} data-tip={n.locked ? "Unlock layer" : "Lock layer"} onClick={(e) => { e.stopPropagation(); patchNode(n.id, { locked: !n.locked }); }}><Icon name={n.locked ? "lock" : "unlock"} size={12} /></button>
        </div>
        {g && !closed.has(n.id) && <ul role="group">{(n as GroupNode).children.map((c, i) => [c, i] as const).reverse().map(([c, i]) => row(c, n as GroupNode, i, depth + 1))}</ul>}
      </li>
    );
  };
  const one = sel.length === 1 ? find(root, sel[0]!)?.node : undefined;
  return (
    <section aria-label="Layers" className="panel layers" style={{ height }}>
      <div className="panel-h"><h2>Layers</h2>
        <Menu id="newlayer" ghost icon="plus" label="New" items={[{ label: "Paint layer", onSelect: () => addPaintLayer() }, { label: "Shape layer", onSelect: () => addShapeLayer("rect") }, { label: "Text layer", onSelect: () => addTextLayer() }, { label: "Group", onSelect: addGroup }, { sep: true }, { heading: "Adjustment layer" }, ...ADJ.map((a) => ({ label: a[0]!.toUpperCase() + a.slice(1), onSelect: () => addAdjustment(a) }))]} />
        <IconButton icon="copy" label="Duplicate layer" size="sm" disabled={!one} onClick={() => one && duplicateLayer(one.id)} /><IconButton icon="up" label="Bring forward" size="sm" disabled={!one} onClick={() => one && reorderLayer(one.id, 1)} /><IconButton icon="down" label="Send backward" size="sm" disabled={!one} onClick={() => one && reorderLayer(one.id, -1)} /><IconButton icon="trash" label="Delete layer" keys="Del" size="sm" disabled={!sel.length} onClick={deleteSelection} />
      </div>
      {one && <div className="layer-quick"><span className="lab">Blend</span>
        <select className="sel" aria-label="Layer blend mode" value={one.blend} onChange={(e) => patchNode(one.id, { blend: e.target.value as BlendMode })}>{BLEND_MODES.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
        <span className="lab">Opacity</span><NumberBox label="Layer opacity" value={Math.round(one.opacity * 100)} min={0} max={100} unit="%" onChange={(v) => patchNode(one.id, { opacity: v / 100 })} /></div>}
      <ul role="tree" aria-label="Layer stack" aria-multiselectable="true" className="tree">
        {root.children.length === 0 && <li className="tree-empty" role="none">No layers yet.<br />Import an image, add text, or paint on a new layer.</li>}
        {root.children.map((c, i) => [c, i] as const).reverse().map(([c, i]) => row(c, root, i, 0))}
      </ul>
    </section>
  );
}
