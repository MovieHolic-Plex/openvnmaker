import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig,loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { exportRuntimePlugin } from "./export-runtime-plugin.js";
import {nativeBuildPlugin} from "./native-build-plugin.js";
// 게이트웨이는 config 로딩 시점에 함께 올린다 — vite 8의 runner 로더는 config 평가 뒤
// 모듈 러너를 닫으므로, 요청 시점의 lazy import 는 "module runner has been closed" 로 깨진다.
import { createApp } from "../gateway/src/app.ts";
import { createFileStore } from "../gateway/src/auth/credentials.ts";
import { API_BODY_MAX, LOSIA_UPLOAD_PATHS } from "../gateway/src/config.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Node IncomingMessage 를 Hono fetch 로 넘긴다.
 * Vite 와 게이트웨이를 한 오리진에 붙여서 브라우저가 5173 만 보면 되게 한다.
 */
function mountGateway() {
  type App = { fetch: (req: Request) => Promise<Response> | Response };
  let appPromise: Promise<App> | undefined;
  const bodyMax = API_BODY_MAX;
  const uploadPaths: ReadonlySet<string> = LOSIA_UPLOAD_PATHS;
  const getApp = () =>
    (appPromise ??= Promise.resolve(createApp({ store: createFileStore() })));
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api")) {
      next();
      return;
    }
    void (async () => {
      const app = await getApp();
      // losia 업로드는 수백 MB 가 될 수 있다 — 버퍼링 상한 대신 본문을 스트림으로 흘린다(상한은 게이트웨이 라우트가 강제).
      const streamUpload = uploadPaths.has(url.split("?")[0] ?? "") && req.method === "POST";
      const chunks: Buffer[] = [];
      if (req.method !== "GET" && req.method !== "HEAD" && !streamUpload) {
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
      const request = new Request(`http://${host}${url}`, {
        method: req.method,
        headers,
        ...(streamUpload
          ? { body: Readable.toWeb(req) as ReadableStream, duplex: "half" }
          : chunks.length > 0 ? { body: Buffer.concat(chunks) } : {}),
      } as RequestInit);
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
