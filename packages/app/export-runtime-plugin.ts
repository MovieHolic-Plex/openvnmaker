import { createHash } from "node:crypto";
import { runtimeNotices } from "./runtime-notices.js";
import { runtimeContentType, webFontNotices } from "./web-fonts.js";
import { resolve } from "node:path";
import { build, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Build the same player as a self-contained template, excluding the default novel. */
export function exportRuntimePlugin(appRoot: string): Plugin {
  const prefix = "/export-runtime/";
  const served = new Map<string, Uint8Array>();
  let pending: Promise<Map<string, Uint8Array>> | undefined;
  async function compile() {
    if (pending) return pending;
    pending = (async () => {
      const result = await build({
        configFile: false, root: appRoot, publicDir: false, base: "./", logLevel: "warn",
        plugins: [react()],
        resolve: { alias: { "@vnmaker/content": resolve(appRoot, "src/export/export-content.ts") } },
        build: {
          target: "es2022", write: false, emptyOutDir: false, cssCodeSplit: false,
          sourcemap: false, assetsInlineLimit: 0,
          rollupOptions: {
            input: resolve(appRoot, "src/export/export-player.tsx"),
            output: { entryFileNames: "player-[hash].js", assetFileNames: "[name]-[hash][extname]", inlineDynamicImports: true },
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const files = new Map<string, Uint8Array>();
      const moduleIds = new Set<string>();
      for (const output of outputs) {
        if (!("output" in output)) throw new Error("플레이어 빌드 결과를 읽을 수 없습니다.");
        for (const item of output.output) {
          files.set(item.fileName, Buffer.from(item.type === "chunk" ? item.code : item.source));
          if (item.type === "chunk") for (const id of item.moduleIds) moduleIds.add(id);
        }
      }
      for (const [name, bytes] of await runtimeNotices(appRoot, moduleIds)) files.set(name, bytes);
      for (const [name, bytes] of await webFontNotices(appRoot)) files.set(name, bytes);
      const entry = [...files.keys()].find(path => /^player-.*\.js$/.test(path));
      if (!entry) throw new Error("배포 플레이어가 없습니다.");
      const stylesheets = [...files.keys()].filter(path => path.endsWith(".css"));
      const manifest = { version: 1, entry, stylesheets, files: [...files].map(([path, bytes]) => ({ path, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") })) };
      files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
      for (const [path, bytes] of files) served.set(path, bytes);
      return files;
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  return {
    name: "vnmaker-export-runtime",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? "").split("?")[0]!;
        if (!pathname.startsWith(prefix)) return next();
        void (async () => {
          const path = pathname.slice(prefix.length);
          // Rebuild on each export so edits to the player cannot leave a stale dev template.
          if (path === "manifest.json" || !served.has(path)) await compile();
          const bytes = served.get(path);
          if (!bytes) { res.statusCode = 404; res.end("Runtime file not found"); return; }
          res.setHeader("Content-Type", runtimeContentType(path));
          res.setHeader("Cache-Control", "no-store");
          res.end(bytes);
        })().catch((error: unknown) => { res.statusCode = 500; res.end(error instanceof Error ? error.message : String(error)); });
      });
    },
    async generateBundle() {
      for (const [fileName, source] of await compile()) this.emitFile({ type: "asset", fileName: `export-runtime/${fileName}`, source });
    },
  };
}
