import assert from "node:assert/strict";
import {
  parseProductionDocument, scriptSchema, writeSetSchema,
} from "../src/index.js";
import { projectFixture } from "./operations-project-fixture.js";

export async function sceneFixture() {
  const f = await projectFixture();
  const original = f.input.candidate.script.scenes[0];
  assert.ok(original);
  const scene = { ...original, framing: "wide" as const, artBrief: "Scratch brief" };
  const spare = {
    id: "spare", background: "title", ending: "Spare ending",
    lines: [{ id: "l-a", speaker: null, text: "Spare scene" }],
  };
  const candidate = {
    ...f.input.candidate,
    script: scriptSchema.parse({
      ...f.input.candidate.script,
      scenes: [
        ...f.input.candidate.script.scenes.map(row => row.id === scene.id ? scene : row),
        spare,
      ],
    }),
    productionDocument: parseProductionDocument({
      ...f.input.candidate.productionDocument,
      outline: {
        ...f.input.candidate.productionDocument.outline,
        scenes: [{
          id: "future", chapter: "Next", title: "Future", summary: "Planned scene",
          artDirection: "Geometry", targetMinutes: 1, background: "title", ending: "Future end",
        }],
      },
    }),
  };
  const input = {
    ...f.input, candidate,
    authorizedWriteSet: writeSetSchema.parse([
      {
        target: { kind: "scene", sceneId: "start" },
        fields: ["create", "delete", "framing", "artBrief", "exit"],
      },
      ...["end", "spare", "missing", "future", "rogue"].map(sceneId => ({
        target: { kind: "scene", sceneId }, fields: ["create", "delete"],
      })),
    ]),
  };
  const creation = {
    sceneId: "future", planBeatId: "future", metadata: { background: "title" },
    lines: [{ clientKey: "draft-line", value: { speaker: null, text: "New scene" } }],
    exit: { kind: "ending", title: "Future end" },
  } as const;
  return { input, common: f.common, scene, spare, creation };
}
