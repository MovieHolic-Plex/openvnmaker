import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "./vite-api.ts";

/**
 * Test-only preview copy of packages/app/vite.config.ts mountGateway.
 * Dev-only configureServer is not active under vite preview.
 */
export function gatewayPreviewPlugin(): Plugin {
  return {
    name: "vnmaker-e2e-gateway",
    async configurePreviewServer(server) {
      const { createApp } = await import("../../../packages/gateway/src/app.ts");
      const { createFileStore } = await import("../../../packages/gateway/src/auth/credentials.ts");
      const app = createApp({ store: createFileStore() });
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
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
          const method = req.method ?? "GET";
          const request = new Request(`http://${host}${url}`, chunks.length > 0
            ? { method, headers, body: Buffer.concat(chunks) }
            : { method, headers });
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
