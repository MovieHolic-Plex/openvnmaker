import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { fetchAvailableModels } from "../cca/client.js";

export function modelRoutes({ store }: GatewayDeps): Hono {
  const routes = new Hono();

  /**
   * 모델 카탈로그 프록시. quotaInfo 를 그대로 노출한다 —
   * 이 카운터는 계정+프로젝트 단위 서버 값이고 Antigravity 데스크톱 앱과 같은 통이다.
   */
  routes.get("/models", async (c) => {
    let access: string;
    try {
      const fresh = await ensureFreshAccess(store);
      if (!fresh) return c.json({ error: "로그인이 필요하다" }, 401);
      access = fresh.credentials.access;
    } catch (err) {
      return c.json({ error: `토큰 갱신 실패: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    try {
      const { models, host } = await fetchAvailableModels(access);
      return c.json({ models, host, count: models.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
