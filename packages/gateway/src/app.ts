import { Hono } from "hono";
import { cors } from "hono/cors";
import { GATEWAY_VERSION } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { modelRoutes } from "./routes/models.js";
import { imageRoutes } from "./routes/images.js";
import { generateRoutes } from "./routes/generate.js";
import { projectRoutes } from "./routes/project.js";
import { agentRoutes } from "./routes/agent.js";
import { harnessRoutes } from "./routes/harness.js";
import { createDefaultHarnessService } from "./harness/runtime.js";
import type { HarnessService } from "./harness/service.js";
import type { CredentialStore } from "./auth/credentials.js";
import { createFileProjectStore, type ProjectStore } from "./project/store.js";
import type { AgentModel } from "./agent/run.js";

export interface GatewayDeps {
  readonly store: CredentialStore;
  readonly project?: ProjectStore;
  readonly agentModel?: AgentModel;
  readonly harness?: HarnessService;
}

/**
 * 라우터를 조립한다. store 를 주입받으므로 테스트가 네트워크 없이 라우트를 검증할 수 있다.
 */
export function createApp(deps: GatewayDeps): Hono {
  const project = deps.project ?? createFileProjectStore();
  const harness = deps.harness ?? createDefaultHarnessService();
  const wired: GatewayDeps = {
    store: deps.store,
    project,
    harness,
    ...(deps.agentModel ? { agentModel: deps.agentModel } : {}),
  };
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "X-VNMaker-Studio"],
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, version: GATEWAY_VERSION }));
  app.route("/api/auth", authRoutes(wired));
  app.route("/api", modelRoutes(wired));
  app.route("/api", imageRoutes(wired));
  app.route("/api", generateRoutes(wired));
  app.route("/api", projectRoutes(wired));
  app.route("/api", agentRoutes(wired));
  app.route("/api/harness", harnessRoutes(wired));

  return app;
}
