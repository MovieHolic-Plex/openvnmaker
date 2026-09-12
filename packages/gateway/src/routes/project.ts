import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { createFileProjectStore } from "../project/store.js";

export function projectRoutes(deps: GatewayDeps): Hono {
  const project = deps.project ?? createFileProjectStore();
  const routes = new Hono();

  routes.get("/project", async (c) => {
    try {
      const nodes = await project.listNodes();
      const edges = await project.readEdges();
      return c.json({
        nodes: nodes.map((node) => ({ id: node.id, ...(node.label === undefined ? {} : { label: node.label }) })),
        edges,
      });
    } catch (err) {
      // 손상 파일은 없는 것으로 삼키지 않는다 — 눈에 보이는 500 으로 올린다.
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  routes.get("/project/nodes/:id", async (c) => {
    try {
      const node = await project.readNode(c.req.param("id"));
      if (!node) return c.json({ error: "노드가 없다" }, 404);
      return c.json({ node, path: `story/nodes/${node.id}.json` });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  /**
   * IR 노드를 디스크에 남긴다. Google 을 부르지 않는다 — 로컬 파일만.
   */
  routes.post("/project/nodes", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON 본문이 필요하다" }, 400);
    }
    try {
      const saved = await project.writeNode(body as { id: string; beats: readonly unknown[] });
      return c.json({ ok: true, ...saved });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return routes;
}
