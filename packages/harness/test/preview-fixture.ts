import {
  candidateRefSchema, parseProductionDocument, scriptSchema,
} from "../src/index.js";
import type { PreviewRequest, PreviewSource } from "../src/preview.js";
import { productionDocument } from "./fixtures.js";
import { partialChapterFixture } from "../../../tests/fixtures/harness/r1-preview.js";

export async function previewFixture() {
  const fixture = await partialChapterFixture();
  const source: PreviewSource = {
    missingAssets: [],
    sourceHead: fixture.preview.sourceHead,
    runId: fixture.preview.runId,
    includedUnitHashes: fixture.preview.includedUnitHashes,
    candidate: {
      ref: candidateRefSchema.parse({
        candidateId: fixture.preview.candidateId,
        revision: fixture.preview.candidateRevision,
      }),
      script: scriptSchema.parse({
        title: fixture.outline.title, subtitle: fixture.outline.subtitle,
        start: fixture.outline.start, characters: [],
        flags: fixture.preview.initialFlags,
        scenes: fixture.preview.materializedScenes,
      }),
      productionDocument: parseProductionDocument({
        ...productionDocument, outline: fixture.outline,
      }),
    },
  };
  const request: PreviewRequest = {
    allowMissingAssetPlaceholders: false,
    previewId: fixture.preview.previewId,
    expectedCandidateRevision: source.candidate.ref.revision,
    entry: fixture.preview.entry,
  };
  return { fixture, source, request };
}
