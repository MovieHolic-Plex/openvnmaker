import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { GATEWAY_VERSION } from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { modelRoutes } from "./routes/models.js";
import { imageRoutes } from "./routes/images.js";
import { generateRoutes } from "./routes/generate.js";
import { projectRoutes } from "./routes/project.js";
import { agentRoutes } from "./routes/agent.js";
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
  const wired: GatewayDeps = {
    store: deps.store,
    project,
    ...(deps.harness ? { harness: deps.harness } : {}),
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
  // 하네스 라우터는 첫 요청에서 적재한다. app.ts 의 정적 import 그래프에 @vnmaker/harness
  // 가 들어가면 vite 설정 번들이 그 체인을 외부 모듈로 끌어와 Node 가 TS 진입점을 읽으려다
  // 실패한다. 지연 적재로 설정 로딩과 서버 동작을 분리한다.
  let harnessRouter: Promise<Hono> | null = null;
  const loadHarnessRouter = (): Promise<Hono> => {
    harnessRouter ??= (async () => {
      const [{ harnessRoutes }, { createDefaultHarnessService }] = await Promise.all([
        import("./routes/harness.js"),
        import("./harness/runtime.js"),
      ]);
      return harnessRoutes({
        ...wired,
        harness: wired.harness ?? await createDefaultHarnessService({ credentialStore: wired.store }),
      });
    })();
    return harnessRouter;
  };
  const harnessHandler = async (c: Context): Promise<Response> => {
    const router = await loadHarnessRouter();
    const url = new URL(c.req.url);
    url.pathname = url.pathname.slice("/api/harness".length) || "/";
    return router.fetch(new Request(url, c.req.raw));
  };
  app.all("/api/harness", harnessHandler);
  app.all("/api/harness/*", harnessHandler);

  return app;
}
