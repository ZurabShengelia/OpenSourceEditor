export interface VideoColor { primaries: number; transfer: number; matrix: number; fullRange: boolean }
export const BT709_LIMITED: VideoColor = { primaries: 1, transfer: 1, matrix: 1, fullRange: false };
interface WcColorSpace { primaries?: string | null; transfer?: string | null; matrix?: string | null; fullRange?: boolean | null }
const PRIM: Record<string, number> = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9 };
const TRC: Record<string, number> = { bt709: 1, smpte170m: 6, linear: 8, "iec61966-2-1": 13, pq: 16, hlg: 18 };
const MTX: Record<string, number> = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, "bt2020-ncl": 9 };
export function colorFromEncoder(cs: WcColorSpace | null | undefined): VideoColor {
  if (!cs) return BT709_LIMITED;
  return {
    primaries: PRIM[cs.primaries ?? ""] ?? BT709_LIMITED.primaries,
    transfer: TRC[cs.transfer ?? ""] ?? BT709_LIMITED.transfer,
    matrix: (MTX[cs.matrix ?? ""] ?? BT709_LIMITED.matrix) || BT709_LIMITED.matrix,
    fullRange: cs.fullRange === true,
  };
}
