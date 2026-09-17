import { Hono } from "hono";
import { auditScript, parseScript } from "@vnmaker/content";
import { compileGraph, parseNode, type StoryEdge, type StoryNode } from "@vnmaker/ir";
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

  /**
   * 그래프 전체를 VnScript 로 컴파일한다 — 스튜디오 미리보기와 외부 도구가 읽는다.
   * 깨진 노드 파일은 건너뛰지 않는다: 조용히 빠진 장면은 dangling 엣지로 이어져
   * 오히려 더 이상한 컴파일 오류를 낸다.
   */
  routes.get("/project/script", async (c) => {
    try {
      const nodes = (await project.listNodes()).map((raw) => parseNode(raw)) as StoryNode[];
      if (nodes.length === 0) return c.json({ error: "노드가 없다 — upsert_beats 로 첫 노드를 만들어라" }, 400);
      const edges = (await project.readEdges()) as StoryEdge[];
      const characters = (await project.readCharacters?.()) ?? [];
      const meta = (await project.readMeta?.()) ?? {};
      const compiled = compileGraph(nodes, edges, characters);
      // 서빙 전에 원고 계약으로 다시 검증한다 — 잘못된 배경 id·화자·플래그는 여기서 잡힌다.
      const script = parseScript({ ...compiled, ...meta });
      return c.json({ script, issues: auditScript(script) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  /**
   * 엣지 목록을 통째로 바꾼다 — 양 끝 노드가 있어야 하고 조건은 구조화 규칙을 따른다.
   * 모호한 그래프(무조건 출구 둘)는 저장해두고 컴파일 시점에 거부한다 — 작업 중간 상태를 허용한다.
   */
  routes.put("/project/edges", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON 본문이 필요하다" }, 400);
    }
    const rows = (body as { edges?: unknown })?.edges;
    if (!Array.isArray(rows)) return c.json({ error: "edges 배열이 필요하다" }, 400);
    try {
      const known = new Set((await project.listNodes()).map((node) => node.id));
      for (const row of rows) {
        const edge = row as { from?: unknown; to?: unknown };
        if (typeof edge.from !== "string" || typeof edge.to !== "string" || !known.has(edge.from) || !known.has(edge.to)) {
          return c.json({ error: "엣지가 없는 노드를 가리킨다" }, 400);
        }
      }
      const saved = await project.writeEdges(rows as { from: string; to: string }[]);
      return c.json({ ok: true, path: saved.path, count: rows.length });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  return routes;
}
