import { canonicalHash } from "../src/canonical.js";
import type { ContextSource } from "../src/context.js";
import {
  candidateRefSchema,
  projectHeadSchema,
} from "../src/primitives.js";
import {
  canonEntrySchema,
  productionDocumentSchema,
} from "../src/production-contracts.js";
import { scriptSchema } from "../src/script-contracts.js";
import { head, productionDocument, uuid } from "./fixtures.js";

export async function selectionSource(): Promise<ContextSource> {
  const script = scriptSchema.parse({
    title: "Selection", subtitle: "", start: "start",
    characters: [
      { id: "witness", name: "Witness", bio: "", color: "#112233" },
    ],
    scenes: [
      {
        id: "start", background: "title",
        lines: [
          { id: "l1", speaker: null, text: "Caf\u00e9 tower" },
          { id: "l2", speaker: null, text: "Second caf\u00e9" },
          { id: "l3", speaker: null, text: "Tail." },
        ],
        choices: [{ id: "c1", text: "Caf\u00e9 door", next: "other" }],
      },
      {
        id: "other", background: "title",
        lines: [
          { id: "l1", speaker: null, text: "Unrelated caf\u00e9" },
          { id: "other-only", speaker: null, text: "Other anchor." },
        ],
        ending: "End",
      },
    ],
  });
  const entry = canonEntrySchema.parse({
    id: "belief", category: "world-fact", text: "Caf\u00e9 tower",
    characterIds: ["witness"], sceneIds: ["start"], relatedEntryIds: [],
    truth: { kind: "belief", holderCharacterId: "witness" },
  });
  const document = productionDocumentSchema.parse({
    ...productionDocument, worldTimeline: [entry],
  });
  return {
    script, productionDocument: document,
    sourceHead: projectHeadSchema.parse({
      ...head,
      scriptHash: await canonicalHash(script),
      productionHash: await canonicalHash(document),
    }),
    candidateRef: candidateRefSchema.parse({
      candidateId: uuid, revision: 4,
    }),
  };
}
