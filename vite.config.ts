import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { CONTENT_SECURITY_POLICY } from "./scripts/csp";

const contentSecurityPolicy: Plugin = {
  name: "content-security-policy", apply: "build",
  transformIndexHtml: (html) => html.replace("</title>", `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`),
};

export default defineConfig(({ mode }) => ({ plugins: [react(), tailwindcss(), contentSecurityPolicy], define: { __LOUPE_TEST__: mode === "test" } }));
