import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { generateText } from "../cca/generate.js";
import { buildReviewPrompt, parseReviewFindings } from "../cca/review.js";
import { TEXT_MODEL } from "../config.js";

interface ReviewBody {
  readonly manuscript?: unknown;
  readonly focus?: unknown;
}

/**
 * agy 텍스트 모델로 원고 서사를 점검한다(연속성·개연성·인물·복선·페이싱·분기·톤).
 * 구조 검사(auditScript)와 달리 LLM 판단이라 로그인이 필요하고 같은 쿼터 통을 쓴다.
 */
export function reviewRoutes({ store, reviewModel }: GatewayDeps): Hono {
  const routes = new Hono();
  const runReview = reviewModel ?? ((access: string, params: Parameters<typeof generateText>[1]) => generateText(access, params));

  routes.get("/review/config", (c) => c.json({ model: TEXT_MODEL, quotaShared: true, unofficial: true, authRequired: true }));

  routes.post("/review", async (c) => {
    let body: ReviewBody;
    try { body = await c.req.json<ReviewBody>(); } catch { return c.json({ error: "JSON 본문이 필요하다" }, 400); }
    if (!body.manuscript || typeof body.manuscript !== "object") return c.json({ error: "manuscript 가 필요하다" }, 400);
    const focus = typeof body.focus === "string" && body.focus.trim() !== "" ? body.focus.trim().slice(0, 300) : undefined;
    const prompt = buildReviewPrompt(body.manuscript, focus);

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
      const result = await runReview(access, { prompt, projectId });
      const findings = parseReviewFindings(result.text);
      return c.json({ findings, model: result.model, quotaShared: true, unofficial: true, ...(result.usage === undefined ? {} : { usage: result.usage }) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
