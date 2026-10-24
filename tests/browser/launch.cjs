let pw; try { pw = require("playwright"); } catch { pw = require("playwright-core"); }
const kind = process.env.BROWSER || "chromium";
const type = pw[kind];
if (!type) { console.error(`Unknown BROWSER=${kind}`); process.exit(2); }
const chromium = {
  async launch(opts = {}) {
    const o = { ...opts }; delete o.executablePath;
    if (kind === "chromium") { if (process.env.CHROME) o.executablePath = process.env.CHROME; o.args = [...(opts.args || []), ...(process.env.GPU ? ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy", "--use-angle=default"] : [])]; }
    else { o.args = (opts.args || []).filter((a) => !a.startsWith("--no-sandbox") && !a.startsWith("--autoplay")); if (process.env.BROWSER_PATH) o.executablePath = process.env.BROWSER_PATH; if (kind === "firefox") o.firefoxUserPrefs = { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 }; }
    if (process.env.HEADED) o.headless = false;
    try { return await type.launch(o); } catch (e) { console.error(`Could not launch ${kind}: ${String(e.message).split("\n")[0]}`); process.exit(2); }
  },
};
module.exports = { chromium, kind };
