# Browser smoke tests
These drive the real UI in headless Chromium (Playwright). They were run during development against an esbuild bundle without Tailwind
CSS, so they use synthetic pointer events and are layout-independent.

    npm i -D playwright && npx playwright install chromium
    npx vite build            # or: esbuild src/main.tsx --bundle --outfile=dist/app.js --loader:.css=empty --jsx=automatic
    BUNDLE_DIR=dist CHROME=/path/to/chrome node tests/browser/smoke-ui.cjs
    BUNDLE_DIR=dist CHROME=/path/to/chrome node tests/browser/smoke-storage-audio.cjs

With a Vite build, serve `dist/index.html`; with the bare esbuild bundle, add an index.html that loads `app.js`.
(`render.entry.ts`/`pixels` check: bundle `render.entry.ts` and read `window.RESULT`.)
