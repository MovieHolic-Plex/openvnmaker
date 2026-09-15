import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { API_BODY_MAX, GATEWAY_VERSION } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { modelRoutes } from "./routes/models.js";
import { imageRoutes } from "./routes/images.js";
import { generateRoutes } from "./routes/generate.js";
import { projectRoutes } from "./routes/project.js";
import { agentRoutes } from "./routes/agent.js";
import { storeRoutes } from "./routes/store.js";
import { reviewRoutes } from "./routes/review.js";
import type { generateText } from "./cca/generate.js";
import type { CredentialStore } from "./auth/credentials.js";
import { createFileProjectStore, type ProjectStore } from "./project/store.js";
import type { AgentModel } from "./agent/run.js";
import type { CodexImageParams } from "./codex/images.js";
import type { ImageResult } from "./cca/images.js";

export interface GatewayDeps {
  readonly store: CredentialStore;
  readonly project?: ProjectStore;
  readonly agentModel?: AgentModel;
  /** 테스트가 codex 프로세스를 띄우지 않고 이미지 경로를 검증하는 주입구. */
  readonly codexImage?: (params: CodexImageParams) => Promise<ImageResult>;
  /** 테스트가 losia.online 없이 스토어 프록시를 검증하는 주입구. */
  readonly losiaFetch?: typeof fetch;
  /** 테스트가 agy 없이 스토리 점검 라우트를 검증하는 주입구. */
  readonly reviewModel?: typeof generateText;
}

/**
 * 라우터를 조립한다. store 를 주입받으므로 테스트가 네트워크 없이 라우트를 검증할 수 있다.
 */
export function createApp(deps: GatewayDeps): Hono {
  const project = deps.project ?? createFileProjectStore();
  const wired: GatewayDeps = {
    store: deps.store,
    project,
    ...(deps.agentModel ? { agentModel: deps.agentModel } : {}),
    ...(deps.codexImage ? { codexImage: deps.codexImage } : {}),
    ...(deps.losiaFetch ? { losiaFetch: deps.losiaFetch } : {}),
    ...(deps.reviewModel ? { reviewModel: deps.reviewModel } : {}),
  };
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:4173", "http://localhost:4173"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  /**
   * 본문을 안 읽는 POST(/api/auth/login 등)는 simple request 로 브라우저 밖 사이트에서도
   * preflight 없이 날릴 수 있다 — 커스텀 헤더를 요구해 preflight 를 강제한다.
   * 허용 오리진이 아니면 preflight 에서 끊기므로 부수효과가 실행되지 않는다.
   * GET/HEAD/OPTIONS 는 읽기라 열어둔다(<img> 의 image/file 은 헤더를 못 붙인다).
   * bodyLimit 보다 먼저 둬서 허가 없는 요청의 바디는 아예 읽지 않는다.
   */
  app.use("/api/*", async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && c.req.header("x-vnmaker-studio") !== "1") {
      return c.json({ error: "편집기 요청 헤더가 필요하다" }, 403);
    }
    await next();
  });

  // 로컬 프로세스가 수 GB 바디로 이 프로세스를 OOM 시키지 못하게 상한을 둔다.
  app.use("/api/*", bodyLimit({ maxSize: API_BODY_MAX, onError: (c) => c.json({ error: "본문이 너무 크다" }, 413) }));

  app.get("/api/health", (c) => c.json({ ok: true, version: GATEWAY_VERSION }));
  app.route("/api/auth", authRoutes(wired));
  app.route("/api", modelRoutes(wired));
  app.route("/api", imageRoutes(wired));
  app.route("/api", generateRoutes(wired));
  app.route("/api", projectRoutes(wired));
  app.route("/api", agentRoutes(wired));
  app.route("/api", storeRoutes(wired));
  app.route("/api", reviewRoutes(wired));

  return app;
}
