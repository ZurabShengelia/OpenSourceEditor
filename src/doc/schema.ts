import type { BlendMode } from "../editor/blend";
import type { Filters } from "../editor/effects";

export const SCHEMA_VERSION = 2 as const;
export const MAX_CANVAS_SIDE = 16384;
export const MAX_FPS = 240;

export type MediaKind = "video" | "image" | "audio" | "bitmap";
export interface MediaRef { id: string; kind: MediaKind; name: string; mime: string; duration?: number; width?: number; height?: number; hasAudio?: boolean; thumb?: string }

export type AnimProp = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
export type Ease = "linear" | "hold" | "easeInOut";
export interface Keyframe { id: string; t: number; v: number; ease: Ease }
export type Keyframes = Partial<Record<AnimProp, Keyframe[]>>;

export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number }
export interface Crop { l: number; t: number; r: number; b: number }
export interface TextProps {
  text: string; font: string; size: number; weight: number; italic: boolean; align: "left" | "center" | "right"; color: string; outline: number; outlineColor: string;
  shadow: number;
  lineHeight?: number; tracking?: number;
  shadowColor?: string; shadowX?: number; shadowY?: number;
}

export interface TClip {
  id: string; trackId: string; type: "media" | "text" | "compound"; mediaId?: string; compoundId?: string;
  start: number; srcStart: number; srcEnd: number; speed: number; volume: number; balance: number; fadeIn: number; fadeOut: number;
  transform: Transform; crop: Crop; filters: Filters; text?: TextProps; keyframes: Keyframes;
  detached?: boolean; linkId?: string;
  muted?: boolean; disabled?: boolean; locked?: boolean;
}
export interface Track { id: string; kind: "video" | "audio" | "text"; name: string; muted: boolean; solo: boolean; locked: boolean; visible: boolean; collapsed?: boolean; height?: number }
export interface Compound { id: string; name: string; length: number; tracks: Track[]; clips: Record<string, TClip>; transitions: Transition[] }
export interface Marker { id: string; t: number; name: string }
export type TransitionKind = "cut" | "fade" | "dissolve" | "slide" | "wipe";
export interface Transition { id: string; trackId: string; fromClipId: string; toClipId: string; kind: TransitionKind; duration: number; dir: "l" | "r" | "u" | "d" }
export interface VideoDoc { fps: number; width: number; height: number; tracks: Track[]; clips: Record<string, TClip>; transitions: Transition[]; markers?: Marker[]; compounds?: Record<string, Compound> }

export interface Mask { bitmapId: string; enabled: boolean; inverted: boolean; density: number }
export type AdjustKind = "brightness" | "contrast" | "exposure" | "saturation" | "hue" | "temperature" | "tint" | "grayscale";
interface NodeBase { id: string; name: string; visible: boolean; locked: boolean; opacity: number; blend: BlendMode; x: number; y: number; scale: number; rotation: number; mask?: Mask }
export interface RasterLayer extends NodeBase { kind: "image"; mediaId: string; filters: Filters }
export interface PaintLayer extends NodeBase { kind: "paint"; bitmapId: string; filters: Filters }
export interface PhotoText extends NodeBase { kind: "text"; props: TextProps; filters: Filters }
export interface ShapeLayer extends NodeBase { kind: "shape"; shape: "rect" | "ellipse" | "line"; w: number; h: number; fill: string; stroke: string; strokeWidth: number }
export interface AdjustmentLayer extends NodeBase { kind: "adjustment"; adjust: Partial<Record<AdjustKind, number>> }
export interface GroupNode extends NodeBase { kind: "group"; children: LayerNode[] }
export type LayerNode = RasterLayer | PaintLayer | PhotoText | ShapeLayer | AdjustmentLayer | GroupNode;
export interface PhotoDoc { width: number; height: number; root: GroupNode }

export interface ProjectV2 { version: typeof SCHEMA_VERSION; id: string; name: string; updatedAt: number; media: Record<string, MediaRef>; video: VideoDoc; photo: PhotoDoc }
