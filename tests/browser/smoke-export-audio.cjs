const { chromium } = require("./launch.cjs");
const http = require("http"), fs = require("fs"), cp = require("child_process");
const srv = http.createServer((q, r) => { const f = q.url.split("?")[0] === "/" ? "index.html" : q.url.slice(1); try { r.setHeader("content-type", f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "text/html"); r.end(fs.readFileSync((process.env.BUNDLE_DIR || "dist") + "/" + f)); } catch { r.statusCode = 404; r.end(); } });
const res = []; const check = (n, ok, x = "") => { res.push(ok); console.log(ok ? "PASS" : "FAIL", n, x); };
const rate = (path) => { const pts = cp.execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]).toString().trim().split("\n").map((l) => Number(l.split(",")[0])).filter((n) => Number.isFinite(n)); const dur = pts.length ? Math.max(...pts) - Math.min(...pts) : 0; return { n: pts.length, dur, fps: pts.length / Math.max(dur, 0.001) }; };
const probe = (p) => { try { return JSON.parse(cp.execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", p]).toString()).streams; } catch (e) { return []; } };
(async () => {
  await new Promise((r) => srv.listen(8127, r));
  const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const errs = [];
  const c0 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p0 = await c0.newPage(); p0.on("pageerror", (e) => errs.push(e.message));
  await p0.goto("http://localhost:8127/index.html"); await p0.waitForSelector("text=Open Editor");
  check("landing: single primary CTA 'Open Editor'", await p0.getByRole("link", { name: "Open Editor" }).count() === 1);
  await p0.getByRole("link", { name: "Open Editor" }).click(); await p0.waitForSelector("[role=dialog]");
  check("Open Editor leads to Start dialog (New Video / New Photo / Open existing)", await p0.getByRole("button", { name: /Video project/ }).count() === 1 && await p0.getByRole("button", { name: /Photo project/ }).count() === 1 && await p0.getByRole("button", { name: /Open existing/ }).count() === 1);
  await p0.getByRole("button", { name: /Photo project/ }).click(); await p0.waitForTimeout(300);
  check("choosing Photo project asks for size and background first", await p0.getByRole("dialog", { name: "New photo project" }).count() === 1);
  await p0.getByRole("button", { name: "Create" }).click(); await p0.waitForTimeout(300);
  check("creating the photo project opens the photo workspace and closes the dialog", await p0.locator("[role=dialog]").count() === 0 && (await p0.getByRole("tab", { name: "photo" }).getAttribute("aria-selected")) === "true");
  await c0.close();

  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true }); await ctx.addInitScript(() => { try { sessionStorage.setItem("loupe.started", "1"); } catch {} });
  const pg = await ctx.newPage(); pg.on("pageerror", (e) => errs.push(e.message)); const click = (l) => l.dispatchEvent("click");
  await pg.goto("http://localhost:8127/index.html#/editor"); await pg.waitForSelector("text=Media");
  const bytes = await pg.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 320; c.height = 180; const x = c.getContext("2d"); const st = c.captureStream(30);
    const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start(); d.stream.getAudioTracks().forEach((t) => st.addTrack(t));
    const rec = new MediaRecorder(st, { mimeType: "video/webm;codecs=vp8,opus" }); const ch = []; rec.ondataavailable = (e) => e.data.size && ch.push(e.data); rec.start(100);
    const t0 = performance.now(); await new Promise((r) => { const f = () => { const t = (performance.now() - t0) / 1000; x.fillStyle = `hsl(${t * 120},70%,45%)`; x.fillRect(0, 0, 320, 180); if (t < 2.5) requestAnimationFrame(f); else r(); }; f(); });
    rec.stop(); await new Promise((r) => (rec.onstop = r)); o.stop(); return Array.from(new Uint8Array(await new Blob(ch, { type: "video/webm" }).arrayBuffer()));
  });
  await pg.evaluate(async (bytes) => { const inp = document.querySelector("input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "av.webm", { type: "video/webm" })); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); }, bytes);
  const clips = () => pg.locator("[aria-label^='av.webm, ']"); await pg.waitForSelector("[aria-label^='av.webm, ']", { timeout: 10000 }); await pg.waitForTimeout(2000);
  check("video imported as one linked clip", await clips().count() === 1);
  await clips().first().click({ button: "right" }); check("context menu offers Detach audio", await pg.getByRole("menuitem", { name: "Detach audio" }).count() === 1);
  await pg.getByRole("menuitem", { name: "Detach audio" }).click(); await pg.waitForTimeout(300);
  check("detach creates an independent audio clip", await clips().count() === 2);
  const ys = await clips().evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)); const vIdx = ys[0] < ys[1] ? 0 : 1;
  await clips().nth(vIdx).click(); await pg.keyboard.press("Delete"); await pg.waitForTimeout(200);
  check("deleting the video leaves the detached audio", await clips().count() === 1);
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(200); check("undo restores the video (history entry)", await clips().count() === 2);
  const ys2 = await clips().evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)); const aIdx = ys2[0] < ys2[1] ? 1 : 0;
  await clips().nth(aIdx).click(); await pg.keyboard.press("Delete"); await pg.waitForTimeout(200); check("deleting the audio leaves the video", await clips().count() === 1);
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(200);
  const ys3 = await clips().evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top)); const aIdx3 = ys3[0] < ys3[1] ? 1 : 0;
  await clips().nth(aIdx3).click({ button: "right" }); check("audio clip offers Link audio & video", await pg.getByRole("menuitem", { name: "Link audio & video" }).count() === 1);
  await pg.getByRole("menuitem", { name: "Link audio & video" }).click(); await pg.waitForTimeout(300); check("link merges them back into one clip", await clips().count() === 1);
  await pg.keyboard.press("Control+z"); await pg.waitForTimeout(200); check("undo of link restores two clips", await clips().count() === 2);
  await click(pg.getByRole("button", { name: "Export" })); await click(pg.getByRole("menuitem", { name: /Export video/ })); await pg.waitForSelector("[role=dialog]");
  await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 8000 }); { const rtb = pg.getByRole("dialog").getByRole("button", { name: "Real-time", exact: true }); if (await rtb.count()) { await rtb.click(); await pg.waitForTimeout(500); } }
  const presets = await pg.locator("[role=dialog] .chip").evaluateAll((els) => els.map((e) => [e.textContent, !e.disabled]));
  check("8 presets listed (720p..4K at 30/60)", presets.length === 8, JSON.stringify(presets));
  const labels = ["Format", "Aspect ratio", "Resolution", "Frame rate", "Quality", "Audio", "Target size"]; const miss = []; for (const t of labels) if (!(await pg.getByRole("dialog").getByText(t, { exact: false }).count())) miss.push(t);
  check("dialog has format, aspect, resolution, frame rate, quality, audio and size estimate", miss.length === 0, miss.join(","));
  check("MOV limitation is stated, no MOV option", await pg.getByRole("dialog").getByText("MOV is not offered").count() === 1 && await pg.getByRole("dialog").locator("option", { hasText: /mov/i }).count() === 0);
  await pg.getByRole("dialog").locator(".chip", { hasText: "720p 30" }).click(); const aspect916 = pg.getByRole("dialog").getByRole("button", { name: "9:16" }); if (await aspect916.count()) { await aspect916.click(); await pg.waitForTimeout(300); await pg.getByRole("dialog").getByRole("button", { name: "Original" }).first().click(); }
  await pg.waitForTimeout(300);
  const dl = pg.waitForEvent("download", { timeout: 40000 }).catch(() => null);
  await pg.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click(); await pg.waitForSelector(".notice.busy", { timeout: 5000 });
  check("progress notice appears while exporting", true);
  await pg.waitForTimeout(600);
  await click(pg.getByRole("tab", { name: "photo" })); await pg.waitForTimeout(200);
  check("switching workspace during an export is refused (the recording keeps running)", (await pg.getByRole("tab", { name: "video" }).getAttribute("aria-selected")) === "true" && await pg.locator(".notice.busy").count() === 1);
  const prog1 = await pg.locator(".notice .bar i").evaluate((e) => parseFloat(e.style.width)); await pg.waitForTimeout(500); const prog2 = await pg.locator(".notice .bar i").evaluate((e) => parseFloat(e.style.width) || 0);
  check("export keeps progressing after the switch attempt", prog2 >= prog1, `${prog1}% -> ${prog2}%`);
  const d = await dl; check("export finishes and downloads a file", !!d, d ? d.suggestedFilename() : "none");
  await pg.waitForTimeout(300); check("completed state replaces the progress bar (no stale 'Exporting')", await pg.locator(".notice.busy").count() === 0 && await pg.getByText(/Exporting/).count() === 0);
  if (d) { const path = await d.path(); const st = probe(path); const v = st.find((s) => s.codec_type === "video"), a = st.find((s) => s.codec_type === "audio");
    check("exported video is 1280x720", !!v && v.width === 1280 && v.height === 720, v ? `${v.width}x${v.height}` : "no stream"); { const r = rate(path); console.log("INFO 720p30 export measured:", r.n, "frames /", r.dur.toFixed(2), "s =", r.fps.toFixed(1), "fps (software-rendered sandbox)"); }
    check("exported file contains an audio stream (detached audio exported)", !!a, a ? a.codec_name : "none"); }
  await pg.waitForTimeout(3800); check("completed notice clears itself", await pg.locator(".notice").count() === 0);
  await click(pg.getByRole("button", { name: "Export" })); await click(pg.getByRole("menuitem", { name: /Export video/ })); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 8000 }); { const rtb = pg.getByRole("dialog").getByRole("button", { name: "Real-time", exact: true }); if (await rtb.count()) { await rtb.click(); await pg.waitForTimeout(500); } }
  await pg.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click(); await pg.waitForSelector(".notice.busy"); await pg.waitForTimeout(500);
  await pg.getByRole("button", { name: "Cancel" }).first().click(); await pg.waitForTimeout(400);
  check("cancel resets the export UI (no progress bar, no 'Exporting')", await pg.locator(".notice .bar").count() === 0 && await pg.getByText(/Exporting/).count() === 0);
  await click(pg.getByRole("tab", { name: "photo" })); await pg.waitForTimeout(300);
  check("Photo workspace shows no export UI after a cancelled video export", (await pg.getByRole("tab", { name: "photo" }).getAttribute("aria-selected")) === "true" && await pg.locator(".notice.busy").count() === 0);
  await pg.waitForTimeout(2600); check("cancelled notice clears itself", await pg.locator(".notice").count() === 0);
  await click(pg.getByRole("tab", { name: "video" })); await pg.waitForTimeout(300);
  await click(pg.getByRole("button", { name: "Export" })); await click(pg.getByRole("menuitem", { name: /Export video/ })); await pg.waitForFunction(() => document.querySelectorAll("[role=dialog] .chip:not(:disabled)").length > 0, null, { timeout: 8000 }); { const rtb = pg.getByRole("dialog").getByRole("button", { name: "Real-time", exact: true }); if (await rtb.count()) { await rtb.click(); await pg.waitForTimeout(500); } }
  const sel = pg.getByRole("dialog").locator("select").first(); const opts = await sel.locator("option").allTextContents(); check("format list only contains formats MediaRecorder can write", opts.length > 0 && opts.every((o) => /MP4|WebM/.test(o)), opts.join(" | "));
  const mp4 = opts.find((o) => /MP4/.test(o)); if (mp4) await sel.selectOption({ label: mp4 }); await pg.waitForTimeout(500);
  const toggleDisabled = await pg.getByRole("dialog").getByLabel("Include audio").isDisabled();
  await pg.getByRole("dialog").locator(".chip", { hasText: "720p 60" }).click();
  const dl60 = pg.waitForEvent("download", { timeout: 40000 }).catch(() => null); await pg.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click(); const d60 = await dl60;
  if (d60) { const path = await d60.path(); fs.copyFileSync(path, "/tmp/e60.webm"); const st = probe(path); const v = st.find((s) => s.codec_type === "video"); const pts = cp.execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]).toString().trim().split("\n").map((l) => Number(l.split(",")[0])).filter((n) => Number.isFinite(n)); const nb = pts.length, dur = pts.length ? Math.max(...pts) - Math.min(...pts) : 0;
    check(`${mp4 ? "MP4" : "WebM"} 720p60 export: real container/codec`, !!v && (mp4 ? /\.mp4$/.test(d60.suggestedFilename()) && v.codec_name === "h264" : /\.webm$/.test(d60.suggestedFilename())), `${d60.suggestedFilename()} ${v && v.codec_name} ${v && v.width}x${v && v.height}`);
    { const lab = mp4 || opts[0] || ""; const want = /no audio/.test(lab) ? "none" : /AAC/.test(lab) ? "aac" : "opus"; const got = (st.find((x) => x.codec_type === "audio") || {}).codec_name || "none";
      check(`exported audio matches what the dialog promised (${lab}: ${want})`, got === want, `got ${got}`);
      if (want === "none") check("audio toggle is disabled when the format cannot carry audio", toggleDisabled); }
    check("60 FPS export produced frames (rate measured, machine-dependent)", nb > 5 && dur > 1, `${nb} frames over ${dur.toFixed(2)} s = ${(nb / Math.max(dur, 0.001)).toFixed(1)} fps; formats offered: ${opts.join(" | ")}`); } else check("60 FPS export produced a file", false, "no download");
  await pg.waitForTimeout(3800); await click(pg.getByRole("tab", { name: "photo" })); await pg.waitForTimeout(300);
  const png = await pg.evaluate(async () => { const c = document.createElement("canvas"); c.width = 400; c.height = 200; const x = c.getContext("2d"); x.fillStyle = "#2a6"; x.fillRect(0, 0, 400, 200); const b = await new Promise((r) => c.toBlob(r)); return Array.from(new Uint8Array(await b.arrayBuffer())); });
  await pg.evaluate(async (bytes) => { const inp = document.querySelector("input[type=file]"); const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], "p.png", { type: "image/png" })); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); }, png);
  await pg.waitForTimeout(1200);
  await click(pg.getByRole("button", { name: "Export" })); await click(pg.getByRole("menuitem", { name: /Export image/ })); await pg.waitForSelector("[role=dialog]");
  check("photo export opens a dialog (format, dimensions, quality) instead of saving immediately", await pg.getByRole("dialog").getByText("Dimensions").count() === 1 && await pg.getByRole("dialog").getByRole("button", { name: "JPEG" }).count() === 1);
  await pg.getByRole("dialog").getByRole("button", { name: "JPEG" }).click(); const wIn = pg.getByRole("dialog").locator("input").first(); await wIn.fill("200"); await wIn.press("Enter"); await pg.waitForTimeout(200);
  const dim = await pg.getByRole("dialog").locator(".facts dd").first().textContent(); check("changing width updates height proportionally", /200×100/.test(dim || ""), dim);
  const dp = pg.waitForEvent("download", { timeout: 10000 }).catch(() => null); await pg.getByRole("dialog").getByRole("button", { name: "Export", exact: true }).click(); const f = await dp;
  if (f) { const st = probe(await f.path()); check("JPEG export has chosen size and extension", st[0] && st[0].width === 200 && st[0].height === 100 && /\.jpg$/.test(f.suggestedFilename()), f.suggestedFilename() + " " + (st[0] ? `${st[0].width}x${st[0].height}` : "")); } else check("JPEG export has chosen size and extension", false, "no download");
  check("no page errors", errs.length === 0, errs.join(" | "));
  console.log(`\n${res.filter(Boolean).length}/${res.length} passed`); await b.close(); srv.close(); process.exit(res.every(Boolean) ? 0 : 1);
})().catch((e) => { console.log("HARNESS ERROR", e.message.slice(0, 500)); process.exit(2); });
