const { chromium } = require("./launch.cjs"); const http = require("http"), fs = require("fs"), cp = require("child_process"), os = require("os"), path = require("path");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync(process.env.BUNDLE_DIR + "/" + f)); } catch { r.statusCode = 404; r.end(); } });
const res = []; const check = (n, ok, x = "") => { res.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rot-")); const ff = (...a) => cp.execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
const cls = ([r, g, b]) => (r > 150 && b < 110 ? "red" : b > 150 && r < 110 ? "blue" : `other(${r},${g},${b})`);
const POINTS = { left: [0.25, 0.5], right: [0.75, 0.5], top: [0.5, 0.25], bottom: [0.5, 0.75] };
(async () => {
  await new Promise((r) => srv.listen(8181, r)); const b = await chromium.launch({ args: ["--no-sandbox"] });
  const probePg = await (await b.newContext()).newPage(); await probePg.goto("http://localhost:8181/index.html"); const canH264 = await probePg.evaluate(async () => { try { return !!window.VideoDecoder && (await VideoDecoder.isConfigSupported({ codec: "avc1.640028" })).supported === true; } catch { return false; } });
  if (!canH264) { console.log("INFO this browser cannot decode H.264: rotation checks skipped (run them with Chrome)"); await b.close(); srv.close(); return; }
  const base = path.join(tmp, "base.mp4"); ff("-f", "lavfi", "-i", "color=c=red:s=320x360:r=30:d=2", "-f", "lavfi", "-i", "color=c=blue:s=320x360:r=30:d=2", "-filter_complex", "hstack", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-bf", "0", base);
  const seen = {}; const errs = [];
  for (const [deg, direct] of [[0, true], [90, true], [180, true], [270, true], [90, false]]) {
    const file = path.join(tmp, `r${deg}.mp4`); ff("-display_rotation", String(deg), "-i", base, "-c", "copy", file);
    const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => sessionStorage.setItem("loupe.started", "1")); const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto("http://localhost:8181/index.html#/editor"); await pg.waitForSelector("text=Media"); if (!direct) await pg.evaluate(() => window.__loupe.setDirectDecoding(false));
    await pg.locator("input[type=file]").first().setInputFiles(file); await pg.waitForSelector(".clip", { timeout: 15000 }); await pg.waitForTimeout(1500); await pg.evaluate(() => window.__loupe.setTime(0.5)); await pg.waitForTimeout(700);
    const size = await pg.evaluate(() => window.__loupe.docSize());
    const prev = await pg.evaluate((P) => { const cv = document.querySelector(".center canvas"); const x = cv.getContext("2d", { willReadFrequently: true }); const out = {}; for (const [k, [fx, fy]] of Object.entries(P)) { const d = x.getImageData(Math.floor(fx * cv.width), Math.floor(fy * cv.height), 1, 1).data; out[k] = [d[0], d[1], d[2]]; } return out; }, POINTS);
    await pg.getByRole("button", { name: "Export" }).dispatchEvent("click"); await pg.getByRole("menuitem", { name: /Export video/ }).dispatchEvent("click"); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 20000 }); await pg.waitForTimeout(500);
    const dlg = pg.getByRole("dialog"); const sel = dlg.locator("select").first(); const opt = (await sel.locator("option").allTextContents()).find((o) => /^WebM$/.test(o)); await sel.selectOption({ label: opt }); await pg.waitForTimeout(500); await dlg.locator(".chip", { hasText: "720p 30" }).click();
    const dl = pg.waitForEvent("download", { timeout: 120000 }).catch(() => null); await dlg.getByRole("button", { name: "Export", exact: true }).click(); const d = await dl; const st = await pg.evaluate(() => window.__loupe.offlineStats());
    if (!d) { check(`rotate ${deg}${direct ? "" : " (seek fallback)"}: export produced a file`, false); await ctx.close(); continue; }
    const out = path.join(tmp, `o${deg}${direct ? "" : "s"}.webm`); fs.copyFileSync(await d.path(), out); const dims = JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", out]).toString()).streams[0];
    const raw = [...cp.execFileSync("ffmpeg", ["-v", "error", "-ss", "0.5", "-i", out, "-frames:v", "1", "-vf", "scale=8:8", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"])]; const at = ([fx, fy]) => { const i = (Math.floor(fy * 8) * 8 + Math.floor(fx * 8)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
    const pc = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, cls(v)])), ec = Object.fromEntries(Object.entries(POINTS).map(([k, p]) => [k, cls(at(p))])); const tag = `rotate ${deg}${direct ? "" : " (<video> seek fallback)"}`; seen[tag] = pc;
    check(`${tag}: preview and export show the same orientation`, JSON.stringify(pc) === JSON.stringify(ec), `preview ${JSON.stringify(pc)} export ${JSON.stringify(ec)}`);
    check(`${tag}: export dimensions follow the displayed shape (${size.w}x${size.h} project)`, (size.w > size.h) === (dims.width > dims.height), `${dims.width}x${dims.height}`);
    check(`${tag}: used the ${direct ? "direct WebCodecs path" : "<video> seeking path"}`, direct ? st.directClips > 0 && st.seekedClips === 0 : st.seekedClips > 0); await ctx.close();
  }
  const base0 = JSON.stringify(seen["rotate 0"]); check("the test discriminates: rotated sources really differ from the unrotated pattern in the preview", ["rotate 90", "rotate 180", "rotate 270"].every((k) => JSON.stringify(seen[k]) !== base0), JSON.stringify(seen));
  check("no page errors", errs.length === 0, errs.join(" | ")); console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log("HARNESS ERROR", e.message.slice(0, 600)); process.exit(2); });
