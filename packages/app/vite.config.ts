import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Node IncomingMessage 를 Hono fetch 로 넘긴다.
 * Vite 와 게이트웨이를 한 오리진에 붙여서 브라우저가 5173 만 보면 되게 한다.
 */
function mountGateway() {
  return {
    name: "vnmaker-gateway",
    async configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      const { createApp } = await import("../gateway/src/app.ts");
      const { createFileStore } = await import("../gateway/src/auth/credentials.ts");
      const app = createApp({ store: createFileStore() });
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith("/api")) {
          next();
          return;
        }
        void (async () => {
          const chunks: Buffer[] = [];
          if (req.method !== "GET" && req.method !== "HEAD") {
            for await (const chunk of req) chunks.push(Buffer.from(chunk));
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
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mountGateway()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: { target: "es2022", assetsInlineLimit: 0 },
});
