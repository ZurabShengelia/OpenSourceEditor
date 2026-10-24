const { chromium } = require("./launch.cjs"); const { createRequire } = require("module"); const path = require("path");
const esbuild = createRequire(process.env.ESBUILD_FROM || path.join(process.cwd(), "package.json"))("esbuild");
const bundle = (entry) => esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: "iife", globalName: "M", platform: "browser", target: "es2022", logLevel: "silent" }).outputFiles[0].text;
const root = path.join(__dirname, "..", ".."); const cur = bundle(path.join(root, "src/render/pixelEffects.ts")), orig = bundle(path.join(root, ""+(process.env.BEFORE||"tests/helpers/pixelEffectsOriginal.ts")+"")); const defs = bundle(path.join(root, "src/editor/effects.ts"));
(async () => {
  const b = await chromium.launch({ args: ["--no-sandbox"] }); const p = await b.newPage(); await p.setContent("<canvas id=c></canvas>");
  const r = await p.evaluate(({ cur, orig, defs }) => {
    const load = (code) => { const f = new Function(code + ";return M;"); return f(); }; const C = load(cur), O = load(orig), E = load(defs); const W = 1280, H = 720, WARM = 10, N = 60;
    const cv = new OffscreenCanvas(W, H), x = cv.getContext("2d", { willReadFrequently: true }); const base = (() => { const c = new OffscreenCanvas(W, H), g = c.getContext("2d"); const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "#d33"); gr.addColorStop(0.5, "#3a6"); gr.addColorStop(1, "#36d"); g.fillStyle = gr; g.fillRect(0, 0, W, H); g.fillStyle = "#fff"; for (let i = 0; i < 400; i++) g.fillRect((i * 97) % W, (i * 53) % H, 6, 6); return c; })();
    const f = (o) => ({ ...E.DEFAULT_FILTERS, ...o });
    const cases = { "distortion": f({ distortion: 30 }), "film grain": f({ film: 40 }), "vignette": f({ vignette: 50 }), "sharpen": f({ sharpen: 60 }), "chromatic": f({ chromatic: 60 }), "tone+temp": f({ highlights: 30, shadows: 20, temperature: 15 }),
      "vintage+vignette+grain": f({ vintage: 60, vignette: 40, film: 30 }), "all together": f({ distortion: 30, chromatic: 60, sharpen: 60, highlights: 30, shadows: 20, temperature: 15, vintage: 60, vignette: 40, film: 30 }) };
    const time = (M, fl) => { const t = []; for (let n = 0; n < WARM + N; n++) { x.clearRect(0, 0, W, H); x.drawImage(base, 0, 0); const t0 = performance.now(); M.applyPixelEffects(cv, fl); if (n >= WARM) t.push(performance.now() - t0); } t.sort((a, b) => a - b); return { mean: t.reduce((a, b) => a + b, 0) / t.length, med: t[t.length >> 1] }; };
    const out = {}; for (const [k, fl] of Object.entries(cases)) { const a = time(O, fl), c = time(C, fl);
      x.clearRect(0, 0, W, H); x.drawImage(base, 0, 0); O.applyPixelEffects(cv, fl); const da = x.getImageData(0, 0, W, H).data.slice(); x.clearRect(0, 0, W, H); x.drawImage(base, 0, 0); C.applyPixelEffects(cv, fl); const db = x.getImageData(0, 0, W, H).data; let same = true; for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) { same = false; break; }
      out[k] = { before: a.mean, after: c.mean, same }; }
    return out;
  }, { cur, orig, defs });
  console.log("720p in Chromium (software canvas, 1 core), 60 frames per case, includes getImageData/putImageData\n");
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(26), `before ${v.before.toFixed(1).padStart(6)} ms  after ${v.after.toFixed(1).padStart(6)} ms  (${(v.before / v.after).toFixed(2)}x)  ${(1000 / v.after).toFixed(0).padStart(3)} fps  pixels ${v.same ? "identical" : "DIFFERENT"}`);
  await b.close(); process.exit(Object.values(r).every((v) => v.same) ? 0 : 1);
})();
