import assert, { AssertionError } from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { assertNever, canonicalHash } from "@vnmaker/harness";
import { generateMedium } from "../../tests/fixtures/harness/medium.js";
import { mediaInventory } from "../../tests/fixtures/harness/media.js";
import { routeOracle } from "../../tests/fixtures/harness/oracle.js";
import { assertInventory, assertRoute } from "../../tests/fixtures/harness/verify.js";
import { createSandbox, evidencePath } from "../../tests/fixtures/harness/sandbox.js";
import { exerciseInfrastructure } from "../../tests/fixtures/harness/infrastructure.js";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { case: { type: "string" }, out: { type: "string" } }, strict: true, allowPositionals: false });
  const caseName = values.case;
  assert.ok(caseName === "medium-oracle" || caseName === "injected-failure", "CLI_CASE");
  assert.ok(values.out, "CLI_OUT_REQUIRED");
  const out = evidencePath(values.out);
  await mkdir(out, { recursive: true });
  const evidence = await mkdtemp(join(out, "run-"));
  const script = generateMedium();
  let tested = script;
  switch (caseName) {
    case "medium-oracle": break;
    case "injected-failure":
      tested = { ...script, scenes: script.scenes.map(scene => scene.id === "s078"
        ? { ...scene, ending: "intentionally-wrong-ending" } : scene) };
      break;
    default: assertNever(caseName);
  }
  const oracle = routeOracle();
  const sandbox = await createSandbox(evidence);
  const observed: ReturnType<typeof assertRoute>[] = [];
  let infrastructure: Awaited<ReturnType<typeof exerciseInfrastructure>> | null = null;
  let inventory: Awaited<ReturnType<typeof assertInventory>> | null = null;
  let failure: { readonly name: string; readonly message: string; readonly code: string; readonly actual?: unknown; readonly expected?: unknown } | null = null;
  try {
    await using runtime = sandbox;
    inventory = await assertInventory(script);
    assert.equal(await canonicalHash(generateMedium()), inventory.scriptHash, "DETERMINISTIC_SCRIPT_HASH");
    assert.equal(oracle.length, 8, "ORACLE_ROUTE_COUNT");
    assert.equal(new Set(oracle.map(route => route.id)).size, 8, "UNIQUE_ROUTE_VECTORS");
    await writeFile(join(runtime.root, "project.json"), JSON.stringify(tested));
    for (const media of mediaInventory()) {
      const path = join(runtime.root, media.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, media.bytes);
    }
    infrastructure = await exerciseInfrastructure(runtime);
    for (const expected of oracle) observed.push(assertRoute(tested, expected));
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    failure = { name: error.name, message: error.message, code: error instanceof AssertionError ? error.code : "QA_RUNTIME_ERROR",
      ...(error instanceof AssertionError ? { actual: error.actual, expected: error.expected } : {}) };
  }
  const report = {
    schemaVersion: 1, synthetic: true, liveProviderCalls: 0, case: caseName,
    status: failure ? "failed" : "passed", exitCode: failure ? 1 : 0,
    inventory, testedScriptHash: await canonicalHash(tested), oracleHash: await canonicalHash(oracle),
    expected: oracle.map(({ historyIds, ...route }) => ({ ...route, historyCount: historyIds.length })),
    observed, failure, infrastructure, cleanup: sandbox.receipt,
  };
  const resultPath = join(evidence, "result.json");
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(evidence, "cleanup.json"), `${JSON.stringify({ sandbox: sandbox.receipt, infrastructure: infrastructure?.cleanup ?? null }, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, resultPath, exitCode: report.exitCode }));
  if (failure) console.error(JSON.stringify(failure));
  process.exitCode = report.exitCode;
}

try { await main(); }
catch (error: unknown) {
  if (!(error instanceof Error)) throw error;
  console.error(JSON.stringify({ status: "failed", name: error.name, message: error.message }));
  process.exitCode = 1;
}
