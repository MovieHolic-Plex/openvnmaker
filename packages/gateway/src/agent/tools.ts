import {
  assertSafeNodeId,
  connectEdges,
  diffBeats,
  listGraph,
  parseNode,
  type StoryEdge,
  type StoryNode,
  upsertBeats,
} from "@vnmaker/ir";
import type { ProjectStore } from "../project/store.js";

export const TOOL_NAMES = ["list_graph", "read_node", "upsert_beats", "connect", "play_from"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface ToolResult {
  readonly ok: boolean;
  readonly tool: string;
  readonly data?: unknown;
  readonly error?: string;
  readonly diff?: string;
  readonly playFrom?: string;
}

export const AGENT_DECLARATIONS: Record<string, unknown>[] = [
  {
    name: "list_graph",
    description: "노드 id/label 과 엣지만 본다. 비트 본문은 안 준다.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "read_node",
    description: "한 노드의 비트 전체.",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "upsert_beats",
    description: "노드 비트를 통째로 교체한다. say 가 하나 이상 있어야 한다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nodeId: { type: "string" },
        beats: { type: "array" },
      },
      required: ["nodeId", "beats"],
    },
  },
  {
    name: "connect",
    description: "두 노드를 엣지로 잇는다.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        when: { type: "string" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "play_from",
    description: "PLAY 커서를 이 노드로. 디스크에는 안 쓴다.",
    parametersJsonSchema: {
      type: "object",
      properties: { nodeId: { type: "string" } },
      required: ["nodeId"],
    },
  },
];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function asStoryNodes(project: ProjectStore): Promise<StoryNode[]> {
  const nodes: StoryNode[] = [];
  for (const raw of await project.listNodes()) {
    try {
      nodes.push(parseNode(raw));
    } catch {
      // 깨진 파일은 그래프에서 뺀다
    }
  }
  return nodes;
}

function summarizeDiff(before: StoryNode | null, after: StoryNode): string {
  if (!before) return `${after.id}: 새 노드`;
  const changed = diffBeats(before.beats, after.beats);
  if (changed.length === 0) return `${after.id}: 변화 없음`;
  const bits = changed.slice(0, 3).map((item) => {
    const prev = item.before && item.before.op === "say" ? item.before.text : JSON.stringify(item.before);
    const next = item.after && item.after.op === "say" ? item.after.text : JSON.stringify(item.after);
    return `${prev ?? "(없음)"} → ${next ?? "(삭제)"}`;
  });
  return `${after.id}: ${bits.join(" / ")}`;
}

export async function executeTool(project: ProjectStore, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    return { ok: false, tool: name, error: `없는 도구다: ${name}` };
  }

  try {
    if (name === "list_graph") {
      const nodes = await asStoryNodes(project);
      const edges = (await project.readEdges()) as StoryEdge[];
      return { ok: true, tool: name, data: listGraph(nodes, edges) };
    }

    if (name === "read_node") {
      const id = asString(args["id"] ?? args["nodeId"]);
      const raw = await project.readNode(id);
      if (!raw) return { ok: false, tool: name, error: "노드가 없다" };
      return { ok: true, tool: name, data: parseNode(raw) };
    }

    if (name === "upsert_beats") {
      const nodeId = assertSafeNodeId(asString(args["nodeId"] ?? args["id"]));
      const beats = args["beats"];
      if (!Array.isArray(beats)) throw new Error("노드 beats 가 없다");
      const raw = await project.readNode(nodeId);
      const before = raw ? parseNode(raw) : null;
      const base: StoryNode = before ?? { id: nodeId, beats: [] };
      const after = upsertBeats(base, beats);
      await project.writeNode(after);
      return { ok: true, tool: name, data: { id: after.id, path: `story/nodes/${after.id}.json` }, diff: summarizeDiff(before, after) };
    }

    if (name === "connect") {
      const from = asString(args["from"]);
      const to = asString(args["to"]);
      const when = asString(args["when"]);
      if (from === "" || to === "") return { ok: false, tool: name, error: "from/to 가 필요하다" };
      // dangling 엣지는 컴파일 시 missing scene 이 된다 — 양 끝 노드가 있어야 잇는다.
      for (const id of [from, to]) {
        if ((await project.readNode(id)) === null) return { ok: false, tool: name, error: `없는 노드다: ${id}` };
      }
      const saved = await project.updateEdges((current) => connectEdges(current, { from, to, ...(when === "" ? {} : { when }) }));
      return { ok: true, tool: name, data: { path: saved.path, edges: saved.edges }, diff: `${from} → ${to}` };
    }

    const nodeId = asString(args["nodeId"] ?? args["id"]);
    const raw = await project.readNode(nodeId);
    if (!raw) return { ok: false, tool: name, error: "노드가 없다" };
    return { ok: true, tool: name, playFrom: parseNode(raw).id, data: { id: nodeId } };
  } catch (err) {
    return { ok: false, tool: name, error: err instanceof Error ? err.message : String(err) };
  }
}
