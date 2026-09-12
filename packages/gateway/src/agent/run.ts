import { AGENT_MAX_TOOL_CALLS } from "../config.js";
import type { ProjectStore } from "../project/store.js";
import { executeTool, type ToolCall, type ToolResult } from "./tools.js";
import { parseNode, type StoryNode } from "@vnmaker/ir";

export interface AgentModelInput {
  readonly prompt: string;
  readonly history: readonly { call: ToolCall; result: ToolResult }[];
}

export interface AgentModelOutput {
  readonly text?: string;
  readonly calls: readonly ToolCall[];
}

export type AgentModel = (input: AgentModelInput) => Promise<AgentModelOutput>;

export interface AgentTurnResult {
  readonly text: string;
  readonly diffs: readonly { tool: string; summary: string }[];
  /** 실패한 도구 호출. 숨기면 "고쳤다" 는 말이 거짓이 된다. */
  readonly failures: readonly { tool: string; error: string }[];
  readonly playFrom: string | null;
  readonly node: StoryNode | null;
  readonly calls: number;
}

export function packAgentPrompt(message: string, graph: unknown, selected: unknown): string {
  return [
    "너는 vnmaker 에이전트다. 닫힌 도구만 쓴다. 소설을 본문으로 쓰지 마라.",
    "성인 대학생 세계. 교복과 미성년은 등장시키지 마라.",
    "노드를 고치면 마지막에 play_from 을 불러라.",
    `그래프: ${JSON.stringify(graph)}`,
    `선택 노드: ${selected === null ? "없음" : JSON.stringify(selected)}`,
    `지시: ${message.trim()}`,
  ].join("\n");
}

export async function runAgentTurn(opts: {
  readonly message: string;
  readonly nodeId?: string;
  readonly project: ProjectStore;
  readonly model: AgentModel;
  readonly maxCalls?: number;
}): Promise<AgentTurnResult> {
  const maxCalls = opts.maxCalls ?? AGENT_MAX_TOOL_CALLS;
  const failures: { tool: string; error: string }[] = [];
  const graph = await executeTool(opts.project, "list_graph", {});
  if (!graph.ok) {
    // 그래프를 못 읽었는데 빈 프로젝트로 착각하게 두면 모델이 덮어쓴다 — 즉시 보고한다.
    const error = graph.error ?? "알 수 없는 오류";
    return { text: `그래프를 읽지 못했다: ${error}`, diffs: [], failures: [{ tool: "list_graph", error }], playFrom: null, node: null, calls: 0 };
  }
  const selected = opts.nodeId ? await executeTool(opts.project, "read_node", { id: opts.nodeId }) : null;
  if (selected && !selected.ok) {
    failures.push({ tool: "read_node", error: `선택 노드를 읽지 못했다: ${selected.error ?? "알 수 없는 오류"}` });
  }
  const prompt = packAgentPrompt(opts.message, graph.data ?? { nodes: [], edges: [] }, selected?.data ?? null);

  const history: { call: ToolCall; result: ToolResult }[] = [];
  const diffs: { tool: string; summary: string }[] = [];
  // play_from 을 실제로 불러야만 미리보기 커서가 생긴다 — 선택 노드로 미리 채우지 않는다.
  let playFrom: string | null = null;
  let text = "";
  let calls = 0;

  while (calls < maxCalls) {
    const output = await opts.model({ prompt, history });
    if (output.text && output.text.trim() !== "") text = output.text.trim();
    if (output.calls.length === 0) break;

    for (const call of output.calls) {
      if (calls >= maxCalls) break;
      const result = await executeTool(opts.project, call.name, call.args);
      history.push({ call, result });
      calls += 1;
      if (result.diff) diffs.push({ tool: result.tool, summary: result.diff });
      if (result.playFrom) playFrom = result.playFrom;
      if (!result.ok) failures.push({ tool: result.tool, error: result.error ?? "알 수 없는 실패" });
    }
  }

  let node: StoryNode | null = null;
  if (playFrom) {
    const raw = await opts.project.readNode(playFrom);
    if (raw) {
      try {
        node = parseNode(raw);
      } catch {
        node = null;
      }
    }
  }

  const fallback =
    failures.length > 0
      ? diffs.length > 0
        ? `일부는 고쳤지만 도구 ${failures.length}건이 실패했다.`
        : "도구 실행이 전부 실패했다."
      : diffs.length > 0
        ? "그래프를 고쳤다."
        : "도구를 부르지 않았다.";

  return {
    text: text || fallback,
    diffs,
    failures,
    playFrom,
    node,
    calls,
  };
}
