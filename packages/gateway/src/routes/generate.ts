import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { generateText } from "../cca/generate.js";
import { HELLO_PROMPT, TEXT_MODEL } from "../config.js";

interface GenerateBody {
  readonly prompt?: unknown;
  readonly model?: unknown;
}

export function generateRoutes({ store }: GatewayDeps): Hono {
  const routes = new Hono();

  routes.get("/generate/config", (c) =>
    c.json({ model: TEXT_MODEL, quotaShared: true, unofficial: true }),
  );

  /**
   * 텍스트 한 방. W1 완료 조건의 모델 쪽이다. prompt 가 비면 HELLO_PROMPT 를 쓴다.
   */
  routes.post("/generate", async (c) => {
    let body: GenerateBody = {};
    try {
      body = await c.req.json<GenerateBody>();
    } catch {
      body = {};
    }

    const prompt = typeof body.prompt === "string" && body.prompt.trim() !== "" ? body.prompt.trim() : HELLO_PROMPT;
    if (prompt.length > 2000) return c.json({ error: "prompt 가 너무 길다" }, 400);

    let access: string;
    let projectId: string;
    try {
      const fresh = await ensureFreshAccess(store);
      if (!fresh) return c.json({ error: "로그인이 필요하다" }, 401);
      access = fresh.credentials.access;
      projectId = fresh.credentials.projectId;
    } catch (err) {
      return c.json({ error: `토큰 갱신 실패: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    if (!projectId) return c.json({ error: "자격증명에 projectId 가 없다. 다시 로그인해라" }, 409);

    try {
      const result = await generateText(access, {
        prompt,
        projectId,
        ...(typeof body.model === "string" && body.model !== "" ? { model: body.model } : {}),
      });
      // #region agent log
      fetch("http://127.0.0.1:7330/ingest/088c962c-eab4-4360-b110-81b67b33fb9f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4259b0" },
        body: JSON.stringify({
          sessionId: "4259b0",
          runId: "w1",
          hypothesisId: "B",
          location: "packages/gateway/src/routes/generate.ts:POST /generate",
          message: "generate route ok",
          data: { model: result.model, host: result.host, textLength: result.text.length, preview: result.text.slice(0, 40) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return c.json({
        text: result.text,
        model: result.model,
        host: result.host,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        quotaShared: true,
        unofficial: true,
      });
    } catch (err) {
      // #region agent log
      fetch("http://127.0.0.1:7330/ingest/088c962c-eab4-4360-b110-81b67b33fb9f", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "4259b0" },
        body: JSON.stringify({
          sessionId: "4259b0",
          runId: "w1",
          hypothesisId: "A",
          location: "packages/gateway/src/routes/generate.ts:POST /generate",
          message: "generate route error",
          data: { error: err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240) },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
