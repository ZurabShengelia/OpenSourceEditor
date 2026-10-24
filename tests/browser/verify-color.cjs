const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs"), cp = require("child_process"), path = require("path");
const DIR = process.env.BUNDLE_DIR || "dist-test"; const W = 1280, H = 720, T = 0.5;
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync(path.join(DIR, f))); } catch { r.statusCode = 404; r.end(); } });
const J = (a) => JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-print_format", "json", ...a]).toString());
const PATCHES = [["black", 0, 0, 0], ["white", 255, 255, 255], ["gray", 128, 128, 128], ["red", 255, 0, 0], ["green", 0, 255, 0], ["blue", 0, 0, 255], ["skin", 224, 172, 140], ["dark", 40, 40, 40]];
const ok = []; const check = (n, v, x = "") => { ok.push(v); console.log(v ? "PASS" : "FAIL", n, x); };
const TOL = { patchMax: 6, meanAll: 2.0, psnr: 35 };
function metrics(prevRgb, outRgb) {
  let max = 0, sum = 0; for (let i = 0; i < prevRgb.length; i++) { const d = Math.abs(prevRgb[i] - outRgb[i]); sum += d; if (d > max) max = d; }
  let pmax = 0; const rows = []; PATCHES.forEach((p, i) => { const cx = Math.floor((i % 4) * W / 4 + W / 8), cy = Math.floor(Math.floor(i / 4) * (H / 2) * 0.5 + H / 8); let m = 0; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const o = ((cy + dy) * W + cx + dx) * 3; for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(prevRgb[o + c] - outRgb[o + c])); } pmax = Math.max(pmax, m); rows.push(`${p[0]}:${m}`); });
  return { max, mean: sum / prevRgb.length, pmax, rows };
}
function psnrSsim(a, b) { const run = (f) => { const r = cp.spawnSync("ffmpeg", ["-v", "info", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", a, "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-i", b, "-lavfi", f, "-f", "null", "-"], { encoding: "utf8" }); return r.stderr; };
  const p = /average:([\d.inf]+)/.exec(run("psnr")); const s = /All:([\d.]+)/.exec(run("ssim")); return { psnr: p ? Number(p[1]) : NaN, ssim: s ? Number(s[1]) : NaN }; }
(async () => {
  await new Promise((r) => srv.listen(8140, r)); const b = await chromium.launch({ executablePath: process.env.CHROME, args: JSON.parse(process.env.CHROME_ARGS || '["--no-sandbox"]') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); } catch {} });
  const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto("http://localhost:8140/index.html#/editor"); await pg.waitForSelector("text=Media");
  const png = await pg.evaluate(async ({ W, H, PATCHES }) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const x = c.getContext("2d"); x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
    PATCHES.forEach((p, i) => { x.fillStyle = `rgb(${p[1]},${p[2]},${p[3]})`; x.fillRect((i % 4) * W / 4, Math.floor(i / 4) * H / 4, W / 4, H / 4); });
    const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, "#000"); g.addColorStop(1, "#fff"); x.fillStyle = g; x.fillRect(0, H / 2, W, H / 4);
    const g2 = x.createLinearGradient(0, 0, W, 0); g2.addColorStop(0, "#ff0000"); g2.addColorStop(0.5, "#00ff00"); g2.addColorStop(1, "#0000ff"); x.fillStyle = g2; x.fillRect(0, 3 * H / 4, W, H / 4);
    const blob = await new Promise((r) => c.toBlob(r, "image/png")); return Array.from(new Uint8Array(await blob.arrayBuffer())); }, { W, H, PATCHES });
  fs.writeFileSync("/tmp/patches.png", Buffer.from(png));
  const src = process.env.VIDEO ? { name: path.basename(process.env.VIDEO), type: process.env.VIDEO.endsWith(".mp4") ? "video/mp4" : "video/webm", bytes: Array.from(fs.readFileSync(process.env.VIDEO)) } : { name: "patches.png", type: "image/png", bytes: png };
  await pg.evaluate(async (s) => { const inp = document.querySelector("input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(s.bytes)], s.name, { type: s.type })); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); }, src);
  await pg.waitForSelector(".clip", { timeout: 15000 }); await pg.waitForTimeout(1500);
  if (process.env.FX) { await pg.evaluate((f) => window.__loupe.setFiltersAll(f), JSON.parse(process.env.FX)); await pg.waitForTimeout(500); console.log("effects on:", process.env.FX); }
  const size = await pg.evaluate(() => window.__loupe.docSize()); const dur = await pg.evaluate(() => window.__loupe.duration()); console.log("source:", process.env.VIDEO || "image", "| project", size.w + "x" + size.h, "duration", dur.toFixed(2), "s");
  check("project canvas is 1280x720 so export needs no scaling", size.w === W && size.h === H);
  if (process.env.VIDEO) { await pg.evaluate((t) => window.__loupe.setTime(t), T); await pg.waitForTimeout(1500); }
  const pv = await pg.evaluate((t) => window.__loupe.previewFrame(t), T); const rgba = Buffer.from(pv.rgba, "base64"); const prev = Buffer.alloc(W * H * 3); for (let i = 0, o = 0; i < W * H; i++) { prev[o++] = rgba[i * 4]; prev[o++] = rgba[i * 4 + 1]; prev[o++] = rgba[i * 4 + 2]; } fs.writeFileSync("/tmp/vc-prev.rgb", prev);
  const srcMetrics = PATCHES.map((p, i) => { const cx = Math.floor((i % 4) * W / 4 + W / 8), cy = Math.floor(Math.floor(i / 4) * (H / 2) * 0.5 + H / 8); const o = (cy * W + cx) * 3; return `${p[0]}:${prev[o]},${prev[o + 1]},${prev[o + 2]}`; }).join(" "); console.log("preview patch centres:", srcMetrics);
  const open = async () => { await pg.getByRole("button", { name: "Export" }).dispatchEvent("click"); await pg.getByRole("menuitem", { name: /Export video/ }).dispatchEvent("click"); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 20000 }); await pg.waitForTimeout(400); };
  const exportWith = async ({ fmt, quality, preset = "720p 30" }) => { await open(); const dlg = pg.getByRole("dialog"); await dlg.getByRole("button", { name: "Frame-accurate", exact: true }).click(); await pg.waitForTimeout(400);
    const sel = dlg.locator("select").first(); const o = (await sel.locator("option").allTextContents()).find((x) => fmt.test(x)); if (!o) { await pg.keyboard.press("Escape"); return { missing: true }; } await sel.selectOption({ label: o }); await pg.waitForTimeout(600);
    await dlg.locator(".chip", { hasText: preset }).click(); await dlg.getByRole("button", { name: quality, exact: true }).click(); await pg.waitForTimeout(200);
    const dl = pg.waitForEvent("download", { timeout: 180000 }).catch(() => null); await dlg.getByRole("button", { name: "Export", exact: true }).click(); const d = await dl; if (!d) return { failed: await pg.locator(".notice").allTextContents() };
    const copy = `/tmp/vc-${Date.now()}.${d.suggestedFilename().split(".").pop()}`; fs.copyFileSync(await d.path(), copy); await pg.waitForTimeout(500); return { path: copy }; };
  const table = [];
  for (const [label, fmt] of [["WebM VP9", /^WebM$/], ["MP4 H.264", /^MP4$/]]) for (const quality of (process.env.QUALITIES ? process.env.QUALITIES.split(",") : ["Low", "Medium", "High"])) {
    const r = await exportWith({ fmt, quality }); if (!r.path) { check(`${label} ${quality}: export produced a file`, false, JSON.stringify(r)); continue; }
    const st = J(["-show_streams", "-show_format", r.path]); const v = st.streams.find((s) => s.codec_type === "video"); const frames = Number(cp.execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", r.path]).toString().trim());
    const kbps = Math.round(Number(st.format.size) * 8 / Number(st.format.duration) / 1000); const raw = cp.execFileSync("ffmpeg", ["-v", "error", "-ss", String(T), "-i", r.path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 }); fs.writeFileSync("/tmp/vc-out.rgb", raw);
    const m = metrics(prev, raw); const q = psnrSsim("/tmp/vc-prev.rgb", "/tmp/vc-out.rgb"); const N = Math.ceil(dur * 30 - 1e-9);
    table.push({ label, quality, res: `${v.width}x${v.height}`, fps: v.r_frame_rate, frames: `${frames}/${N}`, kbps, tags: [v.color_range, v.color_space, v.color_transfer, v.color_primaries].join("/"), max: m.max, mean: m.mean.toFixed(2), patchMax: m.pmax, psnr: q.psnr.toFixed(1), ssim: q.ssim.toFixed(4) });
    check(`${label} ${quality}: ${v.width}x${v.height}, ${v.r_frame_rate} fps, frame count`, v.width === W && v.height === H && v.r_frame_rate === "30/1" && frames === N, `${frames}/${N}`);
    check(`${label} ${quality}: flat patches match the preview (max diff <= ${TOL.patchMax})`, m.pmax <= TOL.patchMax, m.rows.join(" "));
    check(`${label} ${quality}: whole frame mean diff <= ${TOL.meanAll} and PSNR >= ${TOL.psnr} dB`, m.mean <= TOL.meanAll && q.psnr >= TOL.psnr, `mean ${m.mean.toFixed(2)} psnr ${q.psnr.toFixed(1)}`);
  }
  console.log("\nRESULTS TABLE"); console.table(table); fs.writeFileSync("/tmp/vc-table.json", JSON.stringify(table, null, 1));
  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | ")); await b.close(); srv.close(); console.log(`\n${ok.filter(Boolean).length}/${ok.length} checks passed`); process.exit(ok.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
