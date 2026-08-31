import { Hono } from "hono";
import { cors } from "hono/cors";
import { GATEWAY_VERSION } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { modelRoutes } from "./routes/models.js";
import { imageRoutes } from "./routes/images.js";
import type { CredentialStore } from "./auth/credentials.js";

export interface GatewayDeps {
  readonly store: CredentialStore;
}

/**
 * 라우터를 조립한다. store 를 주입받으므로 테스트가 네트워크 없이 라우트를 검증할 수 있다.
 */
export function createApp(deps: GatewayDeps): Hono {
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: GATEWAY_VERSION }));
  app.route("/api/auth", authRoutes(deps));
  app.route("/api", modelRoutes(deps));
  app.route("/api", imageRoutes(deps));

  return app;
}
