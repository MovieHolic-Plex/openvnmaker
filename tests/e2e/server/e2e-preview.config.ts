import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "../../../packages/app/node_modules/@vitejs/plugin-react/dist/index.js";
import { exportRuntimePlugin } from "../../../packages/app/export-runtime-plugin.js";
import { nativeBuildPlugin } from "../../../packages/app/native-build-plugin.js";
import { compileFixtureBridge } from "./fixture-bridge.ts";
import { gatewayPreviewPlugin } from "./gateway-middleware.ts";
import { defineConfig, loadEnv, type Plugin } from "./vite-api.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const appRoot = resolve(repoRoot, "packages/app");
const previewOutDir = resolve(repoRoot, ".qa-tmp/e2e-preview");

function fixtureBridgePlugin(): Plugin {
  return {
    name: "vnmaker-e2e-fixture-bridge",
    async configurePreviewServer(server) {
      const files = await compileFixtureBridge(previewOutDir);
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        const body = files.get(path);
        if (!body) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/javascript; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: appRoot,
  appType: "mpa",
  preview: {
    host: "127.0.0.1",
    strictPort: true,
  },
  plugins: [
    react(),
    nativeBuildPlugin(appRoot, process.env.VNMAKER_RENPY_SDK ?? loadEnv(mode, appRoot, "VNMAKER_").VNMAKER_RENPY_SDK),
    exportRuntimePlugin(appRoot),
    gatewayPreviewPlugin(),
    fixtureBridgePlugin(),
  ],
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    outDir: previewOutDir,
    emptyOutDir: true,
    sourcemap: false,
    minify: false,
    manifest: true,
    rollupOptions: {
      preserveEntrySignatures: "strict",
      input: {
        main: resolve(appRoot, "index.html"),
        studio: resolve(appRoot, "studio.html"),
        projects: resolve(appRoot, "src/studio/projects.ts"),
        projectRepository: resolve(appRoot, "src/studio/projectRepository.ts"),
        applyProposal: resolve(appRoot, "src/studio/harness/applyProposal.ts"),
        exportBundle: resolve(appRoot, "src/studio/exportBundle.ts"),
        projectFolder: resolve(appRoot, "src/studio/projectFolder.ts"),
        projectAssets: resolve(appRoot, "src/storage/projectAssets.ts"),
      },
    },
  },
}));
