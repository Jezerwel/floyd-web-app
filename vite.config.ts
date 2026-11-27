import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    {
      name: "floyd-offline-shell",
      apply: "build",
      generateBundle: {
        order: "post",
        handler(_, bundle) {
          const script = readFileSync(new URL("./public/sw.js", import.meta.url), "utf8");
          const assets = Object.keys(bundle).filter((file) => file.startsWith("assets/")).sort();
          const html = bundle["index.html"];
          const version = createHash("sha256")
            .update(script)
            .update(html?.type === "asset" ? html.source : "")
            .update(JSON.stringify(assets))
            .digest("hex")
            .slice(0, 16);
          this.emitFile({
            type: "asset",
            fileName: "sw.js",
            source: script
              .replace('const BUILD_VERSION = "dev"', `const BUILD_VERSION = "${version}"`)
              .replace("const BUILD_ASSETS = []", `const BUILD_ASSETS = ${JSON.stringify(assets.map((file) => `/${file}`))}`),
          });
        },
      },
    },
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
