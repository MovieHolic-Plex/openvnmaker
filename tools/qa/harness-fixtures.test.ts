import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNever } from "@vnmaker/harness";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSandbox, WORKTREE } from "../../tests/fixtures/harness/sandbox.js";

function runCli(caseName: string, out: string) {
  return new Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
    execFile(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./harness-fixtures.ts", import.meta.url)), "--case", caseName, "--out", out],
      { cwd: WORKTREE, timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (!error) { resolve({ code: 0, stdout, stderr }); return; }
        if (typeof error.code !== "number") { reject(error); return; }
        resolve({ code: error.code, stdout, stderr });
      });
  });
}

for (const [caseName, code, status] of [["medium-oracle", 0, "passed"], ["injected-failure", 1, "failed"]] as const) {
  test(`returns ${code} when the real CLI executes ${caseName}`, { timeout: 40000 }, async () => {
    // Given
    await using output = await createSandbox();
    // When
    const result = await runCli(caseName, output.root);
    // Then: machine-consumed report fields, never CLI prose.
    assert.equal(result.code, code, result.stderr);
    const receipt: unknown = JSON.parse(result.stdout.trim());
    assert.ok(receipt && typeof receipt === "object" && "resultPath" in receipt && typeof receipt.resultPath === "string");
    const report: unknown = JSON.parse(await readFile(receipt.resultPath, "utf8"));
    assert.ok(report && typeof report === "object" && "status" in report && "cleanup" in report && "failure" in report);
    assert.equal(report.status, status);
    assert.ok(report.cleanup && typeof report.cleanup === "object" && "removed" in report.cleanup);
    assert.equal(report.cleanup.removed, true);
    switch (caseName) {
      case "medium-oracle": assert.equal(report.failure, null); break;
      case "injected-failure":
        assert.ok(report.failure && typeof report.failure === "object" && "code" in report.failure && "message" in report.failure);
        assert.equal(report.failure.code, "ERR_ASSERTION");
        assert.equal(typeof report.failure.message, "string");
        assert.match(String(report.failure.message), /^ROUTE_ENDING:000/);
        break;
      default: assertNever(caseName);
    }
  });
}
