const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs"), cp = require("child_process"), os = require("os");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync(process.env.BUNDLE_DIR + "/" + f)); } catch { r.statusCode = 404; r.end(); } });
const ff = (...a) => cp.execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const src = (name, w, h, sec) => { const p = `/tmp/verify-src-${name}.webm`; if (!fs.existsSync(p)) ff("-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=30:duration=${sec}`, "-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${sec}`, "-c:v", "libvpx-vp9", "-b:v", "6M", "-g", "30", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", "-c:a", "libopus", p); return p; };
const probe = (p) => JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-count_packets", p]).toString());
const decodeErrors = (p) => { try { return cp.execFileSync("ffmpeg", ["-v", "error", "-i", p, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim(); } catch (e) { return String(e.stderr || e.message).trim() || "decode failed"; } };
const rgbAt = (p, t) => { const b = cp.execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", p, "-frames:v", "1", "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]); return [b[0], b[1], b[2]]; };
const small = (p, t) => cp.execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", p, "-frames:v", "1", "-vf", "scale=160:90:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
const frameDiff = (p, q, t) => { const a = small(p, t), b = small(q, t); let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const cpuTicks = () => { let s = 0; for (const d of fs.readdirSync("/proc")) if (/^\d+$/.test(d)) { try { const comm = fs.readFileSync(`/proc/${d}/comm`, "utf8"); if (/chrom|headless/i.test(comm)) { const f = fs.readFileSync(`/proc/${d}/stat`, "utf8").replace(/^.*\) /, "").split(" "); s += Number(f[11]) + Number(f[12]); } } catch {} } return s / 100; };
const CASES = [
  { id: "WebM 720p30 plain", src: "s720", fmt: "WebM", preset: "720p 30" },
  { id: "WebM 720p30 colour", src: "s720", fmt: "WebM", preset: "720p 30", fx: { brightness: 150, saturation: 160 }, compareTo: "WebM 720p30 plain" },
  { id: "WebM 720p30 effects", src: "s720", fmt: "WebM", preset: "720p 30", fx: { blur: 2, vignette: 30, glow: 20, sharpen: 30, film: 20 } },
  { id: "WebM 720p30 low", src: "s720", fmt: "WebM", preset: "720p 30", quality: "Low", bitrateGroup: 1 }, { id: "WebM 720p30 medium", src: "s720", fmt: "WebM", preset: "720p 30", quality: "Medium", bitrateGroup: 1 }, { id: "WebM 720p30 high", src: "s720", fmt: "WebM", preset: "720p 30", quality: "High", bitrateGroup: 1 },
  { id: "WebM VP8 720p30", src: "s720", fmt: "WebM", preset: "720p 30", codec: "VP8" },
  { id: "MP4 720p30", src: "s720", fmt: "MP4", preset: "720p 30" },
  { id: "MP4 1080p60", src: "s720", fmt: "MP4", preset: "1080p 60" },
  { id: "MP4 720p30 9:16 portrait", src: "s720", fmt: "MP4", preset: "1080p 30", aspect: "9:16" },
  { id: "WebM 4K60 high", src: "s4k", fmt: "WebM", preset: "4K 60", quality: "High", big: true }, { id: "MP4 4K60 high", src: "s4k", fmt: "MP4", preset: "4K 60", quality: "High", big: true },
];
(async () => {
  const only = process.env.CASES ? new RegExp(process.env.CASES) : null; const results = {}; const rows = [];
  await new Promise((r) => srv.listen(8190, r)); const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
  const env = `${os.cpus().length} core(s), ${os.cpus()[0].model}, ${Math.round(os.totalmem() / 1048576)} MB`; let ver = "";
  for (const c of CASES) {
    if (only && !only.test(c.id)) continue; if (c.big && !process.env.BIG) continue;
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); } catch {} });
    const pg = await ctx.newPage(); await pg.goto("http://localhost:8190/index.html#/editor"); await pg.waitForSelector("text=Media"); ver ||= await pg.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]);
    const sp = c.src === "s4k" ? src("s4k", 3840, 2160, 3) : src("s720", 1280, 720, 4); await pg.locator("input[type=file]").first().setInputFiles(sp); await pg.waitForSelector(".clip", { timeout: 30000 }); await pg.waitForTimeout(c.src === "s4k" ? 6000 : 2500);
    if (c.fx) await pg.evaluate((f) => window.__loupe.setFiltersAll(f), c.fx); const dur = await pg.evaluate(() => window.__loupe.duration());
    await pg.getByRole("button", { name: "Export" }).dispatchEvent("click"); await pg.getByRole("menuitem", { name: /Export video/ }).dispatchEvent("click"); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 30000 }); await pg.waitForTimeout(400);
    const dlg = pg.getByRole("dialog"); const sel = dlg.locator("select").first(); const opts = await sel.locator("option").allTextContents();
    if (!opts.includes(c.fmt)) { rows.push({ id: c.id, skipped: `format ${c.fmt} not offered by this browser (offered: ${opts.join(", ")})` }); await ctx.close(); continue; }
    await sel.selectOption({ label: c.fmt }); await pg.waitForTimeout(500);
    if (c.codec) { const adv = dlg.locator("details.adv"); if (!(await adv.count())) { rows.push({ id: c.id, skipped: "no codec choice offered" }); await ctx.close(); continue; } await adv.locator("summary").click(); await adv.locator("select").selectOption({ label: c.codec }); await pg.waitForTimeout(300); }
    if (c.aspect) await dlg.getByRole("button", { name: c.aspect, exact: true }).click(); await pg.waitForTimeout(300);
    const chip = dlg.locator(".chip", { hasText: c.preset }); if (await chip.isDisabled()) { rows.push({ id: c.id, skipped: `preset ${c.preset} unavailable in this browser` }); await ctx.close(); continue; } await chip.click();
    if (c.quality) await dlg.getByRole("button", { name: c.quality, exact: true }).click();
    const summary = await dlg.locator(".sum").innerText(); const cpu0 = cpuTicks(); const t0 = Date.now(); const dl = pg.waitForEvent("download", { timeout: 900000 }).catch(() => null);
    await dlg.getByRole("button", { name: "Export", exact: true }).click(); const d = await dl; const wall = (Date.now() - t0) / 1000; const cpu = cpuTicks() - cpu0; await pg.waitForTimeout(500);
    if (!d) { rows.push({ id: c.id, failed: "no file produced" }); await ctx.close(); continue; }
    const path = `/tmp/verify-out-${c.id.replace(/\W+/g, "_")}.${d.suggestedFilename().split(".").pop()}`; await d.saveAs(path); const st = await pg.evaluate(() => window.__loupe.offlineStats()); const j = probe(path);
    const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio"); const head = fs.readFileSync(path).subarray(0, 12); const isEbml = head.readUInt32BE(0) === 0x1a45dfa3, isMp4 = head.subarray(4, 8).toString() === "ftyp";
    const [wantW, wantH] = (summary.match(/(\d+)×(\d+)/) || []).slice(1).map(Number); const wantFps = Number((summary.match(/(\d+) fps/) || [])[1]);
    const nb = Number(v.nb_read_packets), fps = eval(v.avg_frame_rate), expect = Math.ceil(dur * wantFps - 1e-9); const row = { id: c.id, file: d.suggestedFilename(), container: j.format.format_name, magicBytes: isEbml ? "EBML(WebM)" : isMp4 ? "ftyp(MP4)" : "?", video: `${v.codec_name} ${v.width}x${v.height}`, requested: `${wantW}x${wantH}@${wantFps}`, fpsMeasured: +fps.toFixed(2), frames: `${nb}/${expect}`, durationS: +Number(j.format.duration).toFixed(3), timelineS: +dur.toFixed(3), audio: a ? `${a.codec_name} ${a.sample_rate} Hz` : "none", kbps: Math.round(Number(j.format.bit_rate) / 1000), MB: +(fs.statSync(path).size / 1e6).toFixed(2), exportS: +(st.totalMs / 1000).toFixed(1), wallS: +wall.toFixed(1), cpuS: +cpu.toFixed(1), decode: decodeErrors(path) || "clean" };
    row.pass = { containerMatchesChoice: c.fmt === "MP4" ? isMp4 && !isEbml && /mp4/.test(j.format.format_name) && /\.mp4$/.test(row.file) : isEbml && /webm/.test(j.format.format_name) && /\.webm$/.test(row.file), sizeMatches: v.width === wantW && v.height === wantH, frameRateMatches: Math.abs(fps - wantFps) < 0.05, frameCount: nb === expect, durationMatches: Math.abs(Number(j.format.duration) - dur) < 0.12, audioPresent: !!a, decodes: row.decode === "clean", codecOk: c.fmt === "MP4" ? v.codec_name === "h264" : (c.codec === "VP8" ? v.codec_name === "vp8" : v.codec_name === "vp9") };
    if (c.aspect === "9:16") row.pass.portrait = v.height > v.width;
    if (c.fx && !c.compareTo && false) {} results[c.id] = { row, path }; rows.push(row); console.log(JSON.stringify(row)); await ctx.close();
  }
  const xs = []; const g = Object.values(results).filter((r) => /^WebM 720p30 (low|medium|high)$/.test(r.row.id)).sort((p, q) => ["low", "medium", "high"].indexOf(p.row.id.split(" ").pop()) - ["low", "medium", "high"].indexOf(q.row.id.split(" ").pop()));
  if (g.length === 3) xs.push({ check: "quality setting changes the real bitrate (low < medium < high)", values: g.map((x) => `${x.row.id.split(" ").pop()}=${x.row.kbps} kbps`), pass: g[0].row.kbps < g[1].row.kbps && g[1].row.kbps < g[2].row.kbps });
  if (results["WebM 720p30 plain"] && results["WebM 720p30 colour"]) { const dd = frameDiff(results["WebM 720p30 plain"].path, results["WebM 720p30 colour"].path, 1); xs.push({ check: "colour adjustments (brightness 150, saturation 160) are in the exported pixels", values: [`mean per-pixel difference from the plain export: ${dd.toFixed(1)} of 255`], pass: dd > 3 }); }
  if (results["WebM 720p30 plain"] && results["WebM 720p30 effects"]) { const dd = frameDiff(results["WebM 720p30 plain"].path, results["WebM 720p30 effects"].path, 1); xs.push({ check: "multi-effect stack (blur, vignette, glow, sharpen, grain) is in the exported pixels", values: [`mean per-pixel difference from the plain export: ${dd.toFixed(1)} of 255`], pass: dd > 3 }); }
  if (results["WebM 720p30 plain"] && results["WebM 720p30 medium"]) { const dd = frameDiff(results["WebM 720p30 plain"].path, results["WebM 720p30 medium"].path, 1); xs.push({ check: "control: two exports with identical settings differ only by encoder noise (the floor the thresholds above sit well over)", values: [`mean per-pixel difference ${dd.toFixed(2)} of 255`], pass: dd < 1 }); }
  xs.forEach((x) => console.log("CROSS", JSON.stringify(x))); let bad = 0; for (const r of rows) if (r.pass) for (const [k, ok] of Object.entries(r.pass)) if (!ok) { bad++; console.log(`FAIL ${r.id}: ${k}`); } for (const x of xs) if (!x.pass) { bad++; console.log(`FAIL ${x.check}`); }
  console.log(`\nENV ${env}; ${ver}; software rendering (no GPU)\n${bad ? bad + " check(s) failed" : "all checks passed"} for ${rows.filter((r) => r.pass).length} exported file(s)${rows.some((r) => r.skipped) ? "; skipped: " + rows.filter((r) => r.skipped).map((r) => r.id + " (" + r.skipped + ")").join("; ") : ""}`);
  fs.writeFileSync(`/tmp/verify-formats-${process.env.LABEL || "run"}.json`, JSON.stringify({ env, ver, rows, xs }, null, 1)); await b.close(); srv.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("HARNESS ERROR", e.stack.slice(0, 600)); process.exit(2); });
