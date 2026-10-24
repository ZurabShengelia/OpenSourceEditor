import { writeFileSync } from "node:fs";
process.env.NODE_ENV = "production";
const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { LogoArt, LOGO_VIEWBOX: V } = await import("../src/ui/Logo");

const TILE = "#081213";
const art = (uid: string, compact: boolean): string => renderToStaticMarkup(createElement(LogoArt, { uid, compact }));
const symbolSvg = (): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${V.x} ${V.y} ${V.w} ${V.h}" width="${V.w}" height="${V.h}">${art("logo", false)}</svg>`;
const tileSvg = (px: number, compact: boolean, fill: number, radius: number): string => {
  const k = (px * fill) / V.h, tx = (px - V.w * k) / 2 - V.x * k, ty = (px - V.h * k) / 2 - V.y * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}"><rect width="${px}" height="${px}" rx="${(px * radius).toFixed(2)}" fill="${TILE}"/><g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${k.toFixed(5)})">${art("t" + px, compact)}</g></svg>`;
};

writeFileSync("public/logo.svg", symbolSvg() + "\n");
writeFileSync("public/favicon.svg", tileSvg(64, true, 0.66, 0.2) + "\n");

let sharp: typeof import("sharp");
try { sharp = (await import("sharp")).default; } catch { console.log("sharp is not installed: wrote the SVG files only (npm i --no-save sharp to also write favicon.ico and apple-touch-icon.png)"); process.exit(0); }
const png = (svg: string): Promise<Buffer> => sharp(Buffer.from(svg), { density: 72 }).png({ compressionLevel: 9 }).toBuffer();
writeFileSync("public/apple-touch-icon.png", await png(tileSvg(180, false, 0.62, 0)));
const frames: { px: number; data: Buffer }[] = [];
for (const [px, compact] of [[16, true], [32, false], [48, false]] as const) frames.push({ px, data: await png(tileSvg(px, compact, 0.74, 0.18)) });
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
let offset = 6 + 16 * frames.length; const dir = frames.map((f) => { const e = Buffer.alloc(16); e[0] = f.px; e[1] = f.px; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(f.data.length, 8); e.writeUInt32LE(offset, 12); offset += f.data.length; return e; });
writeFileSync("public/favicon.ico", Buffer.concat([head, ...dir, ...frames.map((f) => f.data)]));
console.log("wrote public/logo.svg, favicon.svg, favicon.ico, apple-touch-icon.png");
