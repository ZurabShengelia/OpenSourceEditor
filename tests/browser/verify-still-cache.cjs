const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs"), cp = require("child_process"), crypto = require("crypto");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync(process.env.BUNDLE_DIR + "/" + f)); } catch { r.statusCode = 404; r.end(); } });
const PNG = "/tmp/verify-still.png"; if (!fs.existsSync(PNG)) cp.execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=1", "-frames:v", "1", PNG]);
const VID = "/tmp/verify-src-short.webm"; if (!fs.existsSync(VID)) cp.execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=1.5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1.5", "-c:v", "libvpx-vp9", "-b:v", "3M", "-g", "15", "-deadline", "realtime", "-cpu-used", "8", "-pix_fmt", "yuv420p", "-c:a", "libopus", VID]);
const FX = { brightness: 120, saturation: 130, vignette: 30, glow: 20, sharpen: 30, film: 20, blur: 1 }; const RES = process.env.RES || "1080p 30";
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16); const results = []; const check = (n, ok, x = "") => { results.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
(async () => {
  await new Promise((r) => srv.listen(8194, r)); const b = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
  const run = async (file, noCache) => {
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); } catch {} }); const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto("http://localhost:8194/index.html#/editor"); await pg.waitForSelector("text=Media"); await pg.locator("input[type=file]").first().setInputFiles(file); await pg.waitForSelector(".clip", { timeout: 30000 }); await pg.waitForTimeout(2000);
    await pg.evaluate((f) => window.__loupe.setFiltersAll(f), FX); if (noCache) await pg.evaluate(() => window.__loupe.setFault({ noFxCache: true })); const dur = await pg.evaluate(() => window.__loupe.duration()); await pg.waitForTimeout(500);
    await pg.getByRole("button", { name: "Export", exact: true }).dispatchEvent("click"); await pg.getByRole("menuitem", { name: /Export video/ }).dispatchEvent("click"); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 30000 }); await pg.waitForTimeout(300);
    const d = pg.getByRole("dialog"); await d.locator("select").first().selectOption({ label: "WebM" }); await pg.waitForTimeout(250); await d.locator(".chip", { hasText: RES }).click();
    const dl = pg.waitForEvent("download", { timeout: 600000 }); await d.getByRole("button", { name: "Export", exact: true }).click(); const f = await dl; await pg.waitForTimeout(400);
    const p = `/tmp/verify-still-${file.endsWith("png") ? "img" : "vid"}-${noCache ? "nocache" : "cache"}.webm`; await f.saveAs(p); const st = await pg.evaluate(() => ({ ...window.__loupe.offlineStats() })); await ctx.close(); return { p, st, errs, dur };
  };
  const on = await run(PNG, false), off = await run(PNG, true); const frames = Math.ceil(on.dur * 30);
  console.log(`still image, ${on.dur.toFixed(2)} s: cache ON  ${(on.st.totalMs / 1000).toFixed(1)} s (hits ${on.st.fxHits}, misses ${on.st.fxMisses}, render ${(on.st.render / 1000).toFixed(1)} s)\n                          cache OFF ${(off.st.totalMs / 1000).toFixed(1)} s (hits ${off.st.fxHits}, misses ${off.st.fxMisses}, render ${(off.st.render / 1000).toFixed(1)} s)`);
  check("with the cache on, the pixel passes ran once and every other frame reused the result", on.st.fxMisses === 1 && on.st.fxHits === frames - 1, `misses ${on.st.fxMisses}, hits ${on.st.fxHits}, frames ${frames}`); check("with the cache off, nothing was reused", off.st.fxHits === 0);
  check("cached and uncached exports are byte-for-byte identical", sha(on.p) === sha(off.p), `${sha(on.p)} vs ${sha(off.p)}, ${fs.statSync(on.p).size} bytes`);
  check("the output is decodable", (() => { try { cp.execFileSync("ffmpeg", ["-v", "error", "-i", on.p, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); return true; } catch { return false; } })());
  const v = await run(VID, false); check("a video clip with the same effects never hits the cache", v.st.fxHits === 0, `hits ${v.st.fxHits}, misses ${v.st.fxMisses}`);
  check("no page errors", [on, off, v].every((x) => x.errs.length === 0), [...on.errs, ...off.errs, ...v.errs].join(" | "));
  await b.close(); srv.close(); const bad = results.filter((x) => !x).length; console.log(`\n${bad ? bad + " failed" : "all passed"}: ${results.length} checks`); process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("HARNESS ERROR", e.stack.slice(0, 600)); process.exit(2); });
