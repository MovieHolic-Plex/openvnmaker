import type { VnScript } from "@vnmaker/content";
import { canonicalHash, parseProductionDocument, parseProjectHead } from "@vnmaker/harness";

export const FIXTURE_IDS = {
  lineage: "00000000-0000-4000-8000-000000000001",
  run: "00000000-0000-4000-8000-000000000002",
  candidate: "00000000-0000-4000-8000-000000000003",
  call: "00000000-0000-4000-8000-000000000004",
  preview: "00000000-0000-4000-8000-000000000005",
  budgetGroup: "00000000-0000-4000-8000-000000000006",
} as const;

export const syntheticDocument = parseProductionDocument({ version: 1, brief: "Synthetic fixture only",
  castCanon: [], worldTimeline: [], branchFacts: [], artDirection: [], referenceBindings: [],
  outline: { title: "Synthetic fixture", subtitle: "", bible: "", start: "s001", scenes: [] } });

export async function fixtureHead(script: VnScript, revision = 0) {
  return parseProjectHead({ projectId: "synthetic-project", lineageId: FIXTURE_IDS.lineage, revision,
    scriptHash: await canonicalHash(script), productionHash: await canonicalHash(syntheticDocument) });
}
