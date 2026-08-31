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
  const graph = await executeTool(opts.project, "list_graph", {});
  const selected = opts.nodeId ? await executeTool(opts.project, "read_node", { id: opts.nodeId }) : null;
  const prompt = packAgentPrompt(opts.message, graph.data ?? { nodes: [], edges: [] }, selected?.data ?? null);

  const history: { call: ToolCall; result: ToolResult }[] = [];
  const diffs: { tool: string; summary: string }[] = [];
  let playFrom: string | null = opts.nodeId ?? null;
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

  return {
    text: text || (diffs.length > 0 ? "그래프를 고쳤다." : "도구를 부르지 않았다."),
    diffs,
    playFrom,
    node,
    calls,
  };
}
