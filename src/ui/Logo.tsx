import { useId } from "react";

export const LOGO_VIEWBOX = { x: 431, y: 359, w: 431, h: 534 } as const;
export const LOGO_ASPECT = LOGO_VIEWBOX.w / LOGO_VIEWBOX.h;

const OUTLINE = "M431 437 C431 393 470 359 521 359 L690 359 A172 172 0 0 1 690 707 L569 709 L569 874 Q569 893 548 893 Q541 893 534 889 L433 829 Q431 828 431 825 Z";
const PLAY = "M569 652 L569 462 Q569 437 596 438 L731 514 Q745 524 742 538 Q741 548 731 556 Z";
const HOLES = "M472 437.5 H506 Q512 437.5 512 443.5 V478.5 Q512 484.5 506 484.5 H472 Q466 484.5 466 478.5 V443.5 Q466 437.5 472 437.5 Z M472 513 H506 Q512 513 512 519 V554 Q512 560 506 560 H472 Q466 560 466 554 V519 Q466 513 472 513 Z M472 590 H506 Q512 590 512 596 V631 Q512 637 506 637 H472 Q466 637 466 631 V596 Q466 590 472 590 Z";
const GRAD = {
  main: { x1: 783.8, y1: 581.9, x2: 593.0, y2: 300.5, from: "#1cbb90", to: "#71f1b2" },
  strip: { x1: 579.6, y1: 554.2, x2: 421.6, y2: 514.8, from: "#2caf86", to: "#4fe1a4" },
  panel: { x1: 532.5, y1: 752.5, x2: 437.0, y2: 643.7, from: "#18b48b", to: "#30c695" },
  fold: { x1: 495.2, y1: 781.6, x2: 562.3, y2: 877.6, from: "#065b49", to: "#29dba3" },
} as const;
const SHADE = { x1: 543.4, y1: 726.7, x2: 805.8, y2: 578.3, color: "#045c4a", opacity: 0.9 } as const;
const STRIP = "431,437 569,437 569,637 431,637", PANEL = "431,637 569,637 569,726 432,826", FOLD = "432,826 569,726 569,900 500,900", SHADE_AREA = "569,652 880,472 880,720 569,720";

export function LogoArt({ uid, compact = false }: { uid: string; compact?: boolean }) {
  const id = (n: string): string => `osl-${n}-${uid}`;
  return (
    <>
      <defs>
        {(["main", "strip", "panel", "fold"] as const).map((k) => (
          <linearGradient key={k} id={id(k)} gradientUnits="userSpaceOnUse" x1={GRAD[k].x1} y1={GRAD[k].y1} x2={GRAD[k].x2} y2={GRAD[k].y2}>
            <stop offset="0" stopColor={GRAD[k].from} />
            <stop offset="1" stopColor={GRAD[k].to} />
          </linearGradient>
        ))}
        <linearGradient id={id("shade")} gradientUnits="userSpaceOnUse" x1={SHADE.x1} y1={SHADE.y1} x2={SHADE.x2} y2={SHADE.y2}>
          <stop offset="0" stopColor={SHADE.color} stopOpacity={SHADE.opacity} />
          <stop offset="1" stopColor={SHADE.color} stopOpacity="0" />
        </linearGradient>
        <clipPath id={id("clip")}><path clipRule="evenodd" d={compact ? `${OUTLINE} ${PLAY}` : `${OUTLINE} ${PLAY} ${HOLES}`} /></clipPath>
      </defs>
      <g clipPath={`url(#${id("clip")})`}>
        <rect x="425" y="350" width="445" height="550" fill={`url(#${id("main")})`} />
        <polygon points={SHADE_AREA} fill={`url(#${id("shade")})`} />
        <polygon points={STRIP} fill={`url(#${id("strip")})`} />
        <polygon points={PANEL} fill={`url(#${id("panel")})`} />
        <polygon points={FOLD} fill={`url(#${id("fold")})`} />
      </g>
    </>
  );
}

export function Mark({ size = 22, title }: { size?: number; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const v = LOGO_VIEWBOX;
  return (
    <svg className="mark" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} height={size} width={Math.round(size * LOGO_ASPECT * 100) / 100} role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true} focusable="false">
      <LogoArt uid={uid} compact={size < 20} />
    </svg>
  );
}
