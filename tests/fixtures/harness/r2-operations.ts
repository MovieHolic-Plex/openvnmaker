import { canonicalHash, parseToolEnvelope, sceneSchema } from "@vnmaker/harness";
import { FIXTURE_IDS } from "./heads.js";

export async function scopedOperationFixtures() {
  const left = { id: "l-a", speaker: null, text: "Synthetic original scoped line" };
  const right = { id: "l-b", speaker: null, text: "Synthetic anchor" };
  const inserted = { id: "l-x", speaker: null, text: "Synthetic concurrent insertion" };
  const baseline = sceneSchema.parse({ id: "ch01-lab", background: "title", lines: [left, right], ending: "synthetic" });
  const otherScene = sceneSchema.parse({ ...baseline, id: "ch02-lab", lines: [{ ...left, text: "Synthetic other-scene value" }] });
  const staleGap = sceneSchema.parse({ ...baseline, lines: [left, inserted, right] });
  const missingTarget = sceneSchema.parse({ ...baseline, lines: [right] });
  const common = { callId: FIXTURE_IDS.call, candidateId: FIXTURE_IDS.candidate, expectedCandidateRevision: 4, tool: "patch_lines" };
  const insert = parseToolEnvelope({ ...common, arguments: { sceneId: baseline.id,
    operations: [{ kind: "insert", gap: { leftId: "l-a", rightId: "l-b" }, lines: [{ clientKey: "new-line", value: { speaker: null, text: "Synthetic candidate" } }] }] } });
  const update = parseToolEnvelope({ ...common, arguments: { sceneId: baseline.id,
    operations: [{ kind: "update", lineId: "l-a", expectedEntityHash: await canonicalHash(left), patch: { set: { text: "Synthetic repair" }, unset: [] } }] } });
  return { baseline, otherScene, staleGap, missingTarget, insert, update,
    expected: { staleGap: "STALE_GAP", missingTarget: "STALE_TARGET", retargets: 0, insertedLinesOnFailure: 0 } } as const;
}
