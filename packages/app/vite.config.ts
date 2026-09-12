import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig,loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { exportRuntimePlugin } from "./export-runtime-plugin.js";
import {nativeBuildPlugin} from "./native-build-plugin.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Node IncomingMessage 를 Hono fetch 로 넘긴다.
 * Vite 와 게이트웨이를 한 오리진에 붙여서 브라우저가 5173 만 보면 되게 한다.
 */
function mountGateway() {
  type App = { fetch: (req: Request) => Promise<Response> | Response };
  let appPromise: Promise<App> | undefined;
  let bodyMax = 4 * 1024 * 1024;
  const getApp = () =>
    (appPromise ??= (async () => {
      const { createApp } = await import("../gateway/src/app.ts");
      const { createFileStore } = await import("../gateway/src/auth/credentials.ts");
      const { API_BODY_MAX } = await import("../gateway/src/config.ts");
      bodyMax = API_BODY_MAX;
      return createApp({ store: createFileStore() });
    })());
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api")) {
      next();
      return;
    }
    void (async () => {
      const chunks: Buffer[] = [];
      if (req.method !== "GET" && req.method !== "HEAD") {
        // 버퍼링 단계에서도 같은 상한을 둔다 — 다 읽고 나서 자르면 이미 늦다.
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > bodyMax) {
            res.statusCode = 413;
            res.end(JSON.stringify({ error: "본문이 너무 크다" }));
            req.destroy();
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
      }
      const host = req.headers.host ?? "127.0.0.1:5173";
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      const app = await getApp();
      const request = new Request(`http://${host}${url}`, {
        method: req.method,
        headers,
        body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
      });
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch((err: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end(String(err instanceof Error ? err.message : err));
      }
    });
  };
  type Middlewares = { middlewares: { use: (fn: typeof middleware) => void } };
  return {
    name: "vnmaker-gateway",
    // CORS 가 4173 을 허용하는데 preview 서버에 /api 가 없으면 허용 목록이 무의미하다 — 둘 다 단다.
    configureServer(server: Middlewares) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: Middlewares) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({mode})=>({
  plugins: [react(), nativeBuildPlugin(here,process.env.VNMAKER_RENPY_SDK??loadEnv(mode,here,"VNMAKER_").VNMAKER_RENPY_SDK),mountGateway(), exportRuntimePlugin(here)],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    target: "es2022",
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: resolve(here, "index.html"),
        studio: resolve(here, "studio.html"),
      },
    },
  },
}));
