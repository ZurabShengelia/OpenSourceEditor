const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs"), cp = require("child_process"), path = require("path");
const DIR = process.env.BUNDLE_DIR || "dist-test"; const W = 1280, H = 720, BPP = { Low: 0.05, Medium: 0.09, High: 0.16 };
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync(path.join(DIR, f))); } catch { r.statusCode = 404; r.end(); } });
const ok = []; const check = (n, v, x = "") => { ok.push(v); console.log(v ? "PASS" : "FAIL", n, x); };
(async () => {
  await new Promise((r) => srv.listen(8141, r)); const b = await chromium.launch({ executablePath: process.env.CHROME, args: JSON.parse(process.env.CHROME_ARGS || '["--no-sandbox"]') });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); } catch {} });
  const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message)); await pg.goto("http://localhost:8141/index.html#/editor"); await pg.waitForSelector("text=Media");
  const bytes = Array.from(fs.readFileSync(process.env.MOTION || "/tmp/motion.webm"));
  await pg.evaluate(async (bytes) => { const inp = document.querySelector("input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "motion.webm", { type: "video/webm" })); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); }, bytes);
  await pg.waitForSelector(".clip", { timeout: 20000 }); await pg.waitForTimeout(2500);
  const dur = await pg.evaluate(() => window.__loupe.duration()); const size = await pg.evaluate(() => window.__loupe.docSize()); console.log("project", size.w + "x" + size.h, "duration", dur.toFixed(2), "s");
  const open = async () => { await pg.getByRole("button", { name: "Export" }).dispatchEvent("click"); await pg.getByRole("menuitem", { name: /Export video/ }).dispatchEvent("click"); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 20000 }); await pg.waitForTimeout(400); };
  const exportWith = async ({ fmt, quality }) => { await open(); const dlg = pg.getByRole("dialog"); await dlg.getByRole("button", { name: "Frame-accurate", exact: true }).click(); await pg.waitForTimeout(400);
    const sel = dlg.locator("select").first(); const o = (await sel.locator("option").allTextContents()).find((x) => fmt.test(x)); if (!o) { await pg.keyboard.press("Escape"); return { missing: true }; } await sel.selectOption({ label: o }); await pg.waitForTimeout(600);
    await dlg.locator(".chip", { hasText: "720p 30" }).click(); await dlg.getByRole("button", { name: quality, exact: true }).click(); await pg.waitForTimeout(200);
    const dl = pg.waitForEvent("download", { timeout: 240000 }).catch(() => null); await dlg.getByRole("button", { name: "Export", exact: true }).click(); const d = await dl; if (!d) return { failed: await pg.locator(".notice").allTextContents() };
    const copy = `/tmp/vb-${Date.now()}.${d.suggestedFilename().split(".").pop()}`; fs.copyFileSync(await d.path(), copy); await pg.waitForTimeout(500); return { path: copy }; };
  const table = [];
  for (const [label, fmt] of [["WebM VP9", /^WebM$/], ["MP4 H.264", /^MP4$/]]) for (const quality of ["Low", "Medium", "High"]) {
    const r = await exportWith({ fmt, quality }); if (!r.path) { check(`${label} ${quality}: export produced a file`, false, JSON.stringify(r)); continue; }
    const v = JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-select_streams", "v:0", r.path]).toString()).streams[0];
    const pk = cp.execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size", "-of", "csv=p=0", r.path]).toString().trim().split("\n").map(Number); const bytesV = pk.reduce((a, c) => a + c, 0); const secs = pk.length / 30; const kbps = Math.round(bytesV * 8 / secs / 1000);
    const target = Math.round(W * H * 30 * BPP[quality] / 1000); const N = Math.ceil(dur * 30 - 1e-9);
    table.push({ label, quality, res: `${v.width}x${v.height}`, fps: v.r_frame_rate, frames: `${pk.length}/${N}`, targetKbps: target, measuredKbps: kbps, ratio: (kbps / target).toFixed(2), profile: v.profile });
    check(`${label} ${quality}: ${v.width}x${v.height} @ ${v.r_frame_rate}, ${pk.length}/${N} frames`, v.width === W && v.height === H && v.r_frame_rate === "30/1" && pk.length === N);
  }
  console.log("\nBITRATE TABLE"); console.table(table); fs.writeFileSync("/tmp/vb-table.json", JSON.stringify(table, null, 1));
  for (const l of ["WebM VP9", "MP4 H.264"]) { const k = (q) => table.find((t) => t.label === l && t.quality === q)?.measuredKbps; if (k("Low") && k("Medium") && k("High")) check(`${l}: Low < Medium < High measured bitrate`, k("Low") < k("Medium") && k("Medium") < k("High"), `${k("Low")} < ${k("Medium")} < ${k("High")} kbps`);
    for (const q of ["Low", "Medium", "High"]) { const t = table.find((x) => x.label === l && x.quality === q); if (t) check(`${l} ${q}: measured bitrate within 0.6x-1.4x of the target`, t.measuredKbps >= 0.6 * t.targetKbps && t.measuredKbps <= 1.4 * t.targetKbps, `${t.measuredKbps} vs ${t.targetKbps} kbps`); } }
  check("no page errors", errs.length === 0, errs.slice(0, 2).join(" | ")); await b.close(); srv.close(); console.log(`\n${ok.filter(Boolean).length}/${ok.length} checks passed`); process.exit(ok.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
