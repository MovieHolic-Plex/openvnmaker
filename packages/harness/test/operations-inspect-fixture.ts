import { z } from "zod";
import {
  approvedArtBindingSchema, candidateRefSchema, canonEntrySchema,
  canonSectionSchema, canonicalHash, canonicalJson, hashSchema, parseProductionDocument,
  parseProjectHead, projectHeadSchema, scriptSchema,
} from "../src/index.js";
import type { ApprovedArtBinding, ReadSet } from "../src/index.js";
import { head } from "./fixtures.js";
import { projectFixture } from "./operations-project-fixture.js";

export const secondCallId = "00000000-0000-4000-8000-000000000002";

export async function inspectFixture() {
  const f = await projectFixture();
  const extraScenes = Array.from({ length: 40 }, (_, index) => ({
    id: `extra-${index}`, chapter: "Second chapter", background: "title",
    lines: [{ id: "l-a", speaker: null, text: `Private manuscript ${index}` }],
    ending: `Ending ${index}`,
  }));
  const script = scriptSchema.parse({
    ...f.input.candidate.script,
    characters: [{ id: "hero", name: "Hero", color: "#ffffff", bio: "Fixture lead" }],
    scenes: [...f.input.candidate.script.scenes, ...extraScenes],
  });
  const fact = canonEntrySchema.parse({
    id: "conditional-belief", category: "branch-fact", text: "The door is safe.",
    characterIds: ["hero"], sceneIds: ["start"], relatedEntryIds: [],
    applicability: { anyOf: [{ all: ["ready"] }] },
    truth: { kind: "belief", holderCharacterId: "hero" },
  });
  const world = canonEntrySchema.parse({
    id: "world-one", category: "world-fact", text: "The door is locked.",
    characterIds: [], sceneIds: [], relatedEntryIds: [], truth: { kind: "world" },
  });
  const binding = approvedArtBindingSchema.parse({
    assetId: "hero-reference", originalHash: "c".repeat(64),
    deliveryHash: "d".repeat(64), referenceVersionIds: ["hero-v2"],
    role: "reference", target: { kind: "character", characterId: "hero" },
  });
  // Same asset, distinct role; also same composite identity with different metadata.
  const bindings = [binding,
    approvedArtBindingSchema.parse({ ...binding, role: "pose" }),
    approvedArtBindingSchema.parse({ ...binding, deliveryHash: "e".repeat(64), referenceVersionIds: ["hero-v3"] }),
  ];
  const productionDocument = parseProductionDocument({
    ...f.input.candidate.productionDocument,
    branchFacts: [fact], worldTimeline: [world], referenceBindings: bindings,
    artDirection: [{ ...world, id: "visual-one", category: "visual-rule" }],
    outline: {
      title: "Approved plan", subtitle: "Plan subtitle", bible: "Plan bible", start: "start",
      scenes: script.scenes.map(scene => ({
        id: scene.id, chapter: scene.chapter ?? "First chapter", title: `Beat ${scene.id}`,
        summary: `Approved summary ${scene.id}`, artDirection: "Muted light",
        targetMinutes: 5, background: scene.background,
        ...(scene.next === undefined ? {} : { next: scene.next }),
        ...(scene.choices === undefined ? {} : { choices: scene.choices }),
        ...(scene.ending === undefined ? {} : { ending: scene.ending }),
      })),
    },
  });
  const candidate = { ...f.input.candidate, script, productionDocument };
  // Run origin deliberately differs from the candidate. Readers must not forge a new head.
  const sourceHead = parseProjectHead(head);
  return {
    ...f, fact, world, binding, bindings,
    input: { ...f.input, candidate, sourceHead, authorizedWriteSet: [] },
  };
}

export const overviewDataSchema = z.object({
  sourceHead: projectHeadSchema, candidateRef: candidateRefSchema,
  metadata: z.object({
    title: z.string(), subtitle: z.string().optional(), start: z.string(),
    artDirection: z.string().optional(), musicFadeSeconds: z.number().optional(),
    credits: z.array(z.object({ role: z.string(), names: z.string() })).optional(),
  }),
  graph: z.array(z.object({
    sceneId: z.string(), targetSceneIds: z.array(z.string()), materialized: z.boolean(),
  })),
  scenes: z.array(z.object({
    sceneId: z.string(), chapter: z.string(), title: z.string(), summary: z.string(),
    lineCount: z.number().int().nonnegative(), choiceCount: z.number().int().nonnegative(),
    materialized: z.boolean(),
  })),
  canonVersions: z.array(z.object({ sectionId: z.string(), hash: hashSchema })),
  assetVersions: z.array(z.object({ binding: approvedArtBindingSchema, hash: hashSchema })),
  nextCursor: z.string().nullable(),
});

export const canonDataSchema = z.object({
  sourceHead: projectHeadSchema, candidateRef: candidateRefSchema,
  sections: z.array(z.object({ sectionId: z.string(), value: canonSectionSchema, sourceHash: hashSchema })),
  facts: z.array(z.object({
    sectionId: z.string(), entry: canonEntrySchema, sourceHead: projectHeadSchema, sourceHash: hashSchema,
  })),
  referenceBindings: z.array(approvedArtBindingSchema),
});

export async function branchSectionHash(f: Awaited<ReturnType<typeof inspectFixture>>) {
  return canonicalHash({ kind: "entries", entries: f.input.candidate.productionDocument.branchFacts });
}

/** Independent oracle for the operation-owned machine-consumed query recipe. */
export async function expectedBindingCatalogRead(
  bindings: readonly ApprovedArtBinding[],
): Promise<Extract<ReadSet[number], { readonly kind: "query" }>> {
  const query = canonicalJson({ kind: "inspection-approved-binding-catalog", version: 1 });
  const scope: Extract<ReadSet[number], { readonly kind: "query" }>["scope"] = [{ kind: "project" }];
  const results = await Promise.all(bindings.map(async binding => ({
    id: canonicalJson({ assetId: binding.assetId, role: binding.role, target: binding.target }),
    hash: await canonicalHash(binding),
  })));
  return { kind: "query", query, scope, resultIds: results.map(row => row.id),
    hash: await canonicalHash({ query, scope, results }) };
}
