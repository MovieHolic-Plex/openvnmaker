import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../src/canonical.js";
import { buildContextManifest } from "../src/context.js";
import type { ContextManifestInput } from "../src/context.js";
import {
  contextManifestSchema,
  contextWindowSchema,
  readDependencySchema,
} from "../src/context-contracts.js";
import { hashSchema, projectHeadSchema } from "../src/primitives.js";
import { hash, head, otherHash } from "./fixtures.js";

async function fixture() {
  const sourceHead = projectHeadSchema.parse(head);
  const sourceHash = hashSchema.parse(hash);
  const query = readDependencySchema.parse({
    kind: "query", query: "tower",
    scope: [{ kind: "canon", sectionId: "world" }],
    resultIds: ["common"], hash: await canonicalHash(["common"]),
  });
  const factContent = {
    factId: "common", sceneIds: [], lineIds: [], sourceHash,
  };
  const window = contextWindowSchema.parse({
    sceneId: "start", lineIds: ["l1"],
    hash: await canonicalHash([
      { id: "l1", speaker: null, text: "Original passage." },
    ]),
  });
  const content = {
    windows: [window], facts: [factContent], readSet: [query],
    referenceBindingHashes: [], excluded: [],
  };
  const input: ContextManifestInput = {
    ...content,
    sourceHead,
    facts: [{ ...factContent, sourceHead }],
  };
  // Independently construct the expected content hash from fixture inputs.
  // Authority heads are deliberately absent from this hash input.
  const expected = contextManifestSchema.parse({
    ...input, inputContentHash: await canonicalHash(content),
  });
  return { input, expected };
}

test("builds a manifest with original provenance and a content-only hash", async () => {
  // Given typed source dependencies with an independently computed hash.
  const { input, expected } = await fixture();
  // When the manifest is assembled.
  const result = await buildContextManifest(input);
  // Then all provenance is retained separately from content identity.
  assert.deepEqual(result, { kind: "ready", manifest: expected });
});

test("preserves content identity when only source revisions change", async () => {
  // Given unchanged content recorded at a later revision.
  const { input, expected } = await fixture();
  const sourceHead = projectHeadSchema.parse({ ...head, revision: 5 });
  const revised: ContextManifestInput = {
    ...input, sourceHead,
    facts: input.facts.map(fact => ({ ...fact, sourceHead })),
  };
  // When the earlier required context is checked against that content.
  const result = await buildContextManifest(revised, expected);
  // Then authority revision changes alone do not change content identity.
  assert.equal(result.kind, "ready");
  assert.equal(result.manifest.inputContentHash, expected.inputContentHash);
  assert.deepEqual(result.manifest.sourceHead, sourceHead);
});

test("required-context-does-not-fit blocks a changed required fact", async () => {
  // Given a required fact whose source content has changed.
  const { input, expected } = await fixture();
  const changed: ContextManifestInput = {
    ...input,
    facts: input.facts.map(fact => ({
      ...fact, sourceHash: hashSchema.parse(otherHash),
    })),
  };
  // When the old required context is checked against it.
  const result = await buildContextManifest(changed, expected);
  // Then stale required content is blocked rather than silently replaced.
  assert.deepEqual(result, {
    kind: "blocked", reason: "STALE_REQUIRED_CONTEXT",
  });
});

test("blocks changed query membership when existing fact hashes are unchanged", async () => {
  // Given the same query gaining a result while existing facts are unchanged.
  const { input, expected } = await fixture();
  const changedQuery = readDependencySchema.parse({
    kind: "query", query: "tower",
    scope: [{ kind: "canon", sectionId: "world" }],
    resultIds: ["common", "added"],
    hash: await canonicalHash(["common", "added"]),
  });
  const changed: ContextManifestInput = {
    ...input, readSet: [changedQuery],
  };
  // When the prior required context is checked against the new query result.
  const result = await buildContextManifest(changed, expected);
  // Then unchanged individual facts do not establish reusable context.
  assert.deepEqual(result, {
    kind: "blocked", reason: "STALE_REQUIRED_CONTEXT",
  });
});

test("blocks required context from another lineage despite matching content", async () => {
  // Given identical content under a different source lineage.
  const { input, expected } = await fixture();
  const changed: ContextManifestInput = {
    ...input,
    sourceHead: projectHeadSchema.parse({
      ...head, lineageId: "00000000-0000-4000-8000-000000000002",
    }),
  };
  // When the original lineage's required context is supplied.
  const result = await buildContextManifest(changed, expected);
  // Then content equality does not transfer source authority.
  assert.deepEqual(result, {
    kind: "blocked", reason: "STALE_REQUIRED_CONTEXT",
  });
});

test("blocks changed nonempty window content", async () => {
  // Given unchanged authority and selected IDs but changed passage content.
  const { input, expected } = await fixture();
  const changedHash = await canonicalHash([
    { id: "l1", speaker: null, text: "Changed passage." },
  ]);
  const changed: ContextManifestInput = {
    ...input,
    windows: input.windows.map(window => ({ ...window, hash: changedHash })),
  };
  // When the prior required context is checked.
  const result = await buildContextManifest(changed, expected);
  // Then changed passage content makes the required context stale.
  assert.deepEqual(result, {
    kind: "blocked", reason: "STALE_REQUIRED_CONTEXT",
  });
});
