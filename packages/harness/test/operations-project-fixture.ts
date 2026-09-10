import {
  candidateRefSchema, canonicalHash, parseProductionDocument,
  scriptSchema, unitIdSchema, writeSetSchema,
} from "../src/index.js";
import { productionDocument, uuid } from "./fixtures.js";
import { operationJournalSchema } from "../src/operations-receipts.js";

export async function projectFixture() {
  const metadata = {
    title: "Original title", subtitle: "Preserved subtitle", start: "start",
    artDirection: "Original direction", musicFadeSeconds: 0.75,
    credits: [{ role: "Writer", names: "Fixture author" }],
  };
  const flags = { ready: true, coins: 1, spare: false };
  const candidate = {
    ref: candidateRefSchema.parse({ candidateId: uuid, revision: 4 }),
    script: scriptSchema.parse({
      ...metadata, nativeSaveId: "0123456789abcdef", characters: [], flags,
      scenes: [
        {
          id: "start", background: "title",
          lines: [{ id: "l-a", speaker: null, text: "Start", when: { all: ["ready"] } }],
          choices: [{ id: "c-a", text: "Continue", next: "end", add: { coins: 1 } }],
        },
        {
          id: "end", background: "title", ending: "End",
          lines: [{ id: "l-a", speaker: null, text: "End" }],
        },
      ],
    }),
    productionDocument: parseProductionDocument(productionDocument),
  };
  const [metadataHash, stateHash] = await Promise.all([
    canonicalHash(metadata), canonicalHash(flags),
  ]);
  const input = {
    journal: operationJournalSchema.parse({
      candidateId: candidate.ref.candidateId, calls: [], allocations: [],
    }),
    unitId: unitIdSchema.parse(uuid), candidate,
    authorizedWriteSet: writeSetSchema.parse([
      { target: { kind: "project" }, fields: ["title", "artDirection"] },
      ...["ready", "coins", "spare", "added"].map(flagId => ({
        target: { kind: "state", flagId }, fields: ["value"],
      })),
    ]),
  };
  const common = { callId: uuid, candidateId: uuid, expectedCandidateRevision: 4 };
  return { input, common, metadata, flags, metadataHash, stateHash };
}
