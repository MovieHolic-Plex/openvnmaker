import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { credentialsFromToken, ensureFreshAccess, exchangeCode, fetchEmail } from "../auth/tokens.js";
import { waitForCallback } from "../auth/oauth.js";
import { discoverProject } from "../cca/client.js";
import { FREE_TIER_ID } from "../config.js";

export function authRoutes({ store }: GatewayDeps): Hono {
  const routes = new Hono();

  /** 자격증명이 없거나 깨져도 200 을 준다. UI 가 상태를 그리기 위한 표면이다. */
  routes.get("/status", async (c) => {
    const creds = await store.read();
    if (!creds) return c.json({ authenticated: false });
    return c.json({
      authenticated: true,
      provider: "google-antigravity",
      email: creds.email ?? null,
      projectId: creds.projectId,
      expires: creds.expires,
      expiresInSeconds: Math.round((creds.expires - Date.now()) / 1000),
      tier: FREE_TIER_ID,
      unofficial: true,
    });
  });

  routes.post("/refresh", async (c) => {
    const before = await store.read();
    if (!before) return c.json({ error: "저장된 refresh_token 이 없다" }, 401);
    try {
      const result = await ensureFreshAccess(store);
      if (!result) return c.json({ error: "자격증명을 읽을 수 없다" }, 401);
      return c.json({ refreshed: result.refreshed, expires: result.credentials.expires });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /** 브라우저 동의 → 토큰 교환 → 프로젝트 발견 → 저장. 콜백 서버는 이 프로세스가 연다. */
  routes.post("/login", async (c) => {
    try {
      const previous = await store.read();
      const { code, redirectUri } = await waitForCallback((url) => {
        console.log(`[auth] 동의 URL: ${url}`);
      });
      const token = await exchangeCode(code, redirectUri);
      const email = await fetchEmail(token.access_token);
      const projectId = await discoverProject(token.access_token);
      const creds = credentialsFromToken(token, projectId, email, previous?.refresh);
      await store.write(creds);
      return c.json({ authenticated: true, email: creds.email ?? null, projectId: creds.projectId });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
