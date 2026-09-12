import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { runAgentTurn } from "../agent/run.js";
import { runCcaAgentModel } from "../cca/agent.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { createFileProjectStore } from "../project/store.js";

interface AgentBody {
  readonly message?: unknown;
  readonly nodeId?: unknown;
}

export function agentRoutes(deps: GatewayDeps): Hono {
  const project = deps.project ?? createFileProjectStore();
  const routes = new Hono();

  routes.post("/agent/run", async (c) => {
    let body: AgentBody = {};
    try {
      body = await c.req.json<AgentBody>();
    } catch {
      body = {};
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (message === "") return c.json({ error: "지시가 비었다" }, 400);
    if (message.length > 2000) return c.json({ error: "지시가 너무 길다" }, 400);
    const nodeId = typeof body.nodeId === "string" && body.nodeId.trim() !== "" ? body.nodeId.trim() : undefined;

    let access: string;
    let projectId: string;
    try {
      const fresh = await ensureFreshAccess(deps.store);
      if (!fresh) return c.json({ error: "로그인이 필요하다" }, 401);
      access = fresh.credentials.access;
      projectId = fresh.credentials.projectId;
    } catch (err) {
      return c.json({ error: `토큰 갱신 실패: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    if (!projectId) return c.json({ error: "자격증명에 projectId 가 없다. 다시 로그인해라" }, 409);

    try {
      const result = await runAgentTurn({
        message,
        ...(nodeId === undefined ? {} : { nodeId }),
        project,
        model: deps.agentModel ?? ((input) => runCcaAgentModel(access, projectId, input)),
      });
      return c.json({
        text: result.text,
        diffs: result.diffs,
        failures: result.failures,
        playFrom: result.playFrom,
        node: result.node,
        calls: result.calls,
        quotaShared: true,
        unofficial: true,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  return routes;
}
