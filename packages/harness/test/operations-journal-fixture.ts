import assert from "node:assert/strict";
import { parseToolEnvelope, writeSetSchema } from "../src/index.js";
import { applyCandidateTool } from "../src/operations.js";
import { projectFixture } from "./operations-project-fixture.js";

export async function journalFixture() {
  const f = await projectFixture();
  const entry = {
    clientKey: "owned-key",
    value: { speaker: null, text: "Generated line" },
  } as const;
  const input = {
    ...f.input,
    authorizedWriteSet: writeSetSchema.parse([
      ...f.input.authorizedWriteSet,
      { target: { kind: "scene", sceneId: "start" }, fields: ["lines", "choices"] },
      { target: { kind: "scene", sceneId: "end" }, fields: ["lines"] },
    ]),
  };
  const envelope = parseToolEnvelope({
    ...f.common, tool: "patch_lines",
    arguments: { sceneId: "start", operations: [{
      kind: "insert", gap: { leftId: "l-a", rightId: null }, lines: [entry],
    }] },
  });
  return { ...f, input, entry, envelope };
}

export async function seededInsertion() {
  const f = await journalFixture();
  const first = await applyCandidateTool({ ...f.input, envelope: f.envelope });
  assert.equal(first.result.ok, true);
  return { ...f, first };
}
