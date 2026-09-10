import {
  canonicalHash, parseToolEnvelope, sceneIdSchema, validationReportSchema,
} from "../src/index.js";
import type { PreparedCandidateValidation } from "../src/operations-validation.js";
import { projectFixture } from "./operations-project-fixture.js";

export async function validationFixture() {
  const f = await projectFixture();
  const candidate = f.input.candidate;
  const preparedValidation: PreparedCandidateValidation = {
    candidateRef: candidate.ref,
    candidateDigest: await canonicalHash({
      script: candidate.script, productionDocument: candidate.productionDocument,
    }),
    scope: { mode: "local", sceneIds: [sceneIdSchema.parse("start")] },
    report: validationReportSchema.parse({
      schema: true, graph: false, assets: false, runtime: false,
      requiredAssetsMissing: ["pending-art"], issues: [], reviewIds: [],
    }),
    readSet: [{
      kind: "entity", target: { kind: "project" },
      hash: await canonicalHash(candidate.script),
    }],
  };
  const envelope = parseToolEnvelope({
    ...f.common, tool: "validate_candidate",
    arguments: { mode: "local", sceneIds: ["start"] },
  });
  return {
    ...f, envelope, preparedValidation,
    input: { ...f.input, preparedValidation },
  };
}
