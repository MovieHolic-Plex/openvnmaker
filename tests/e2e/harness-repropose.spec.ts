import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

test("unrelated-edit-keeps-candidate", async ({ page }) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByTestId("harness-tab-work").click();
  await page.getByTestId("harness-instruction").fill("Kept candidate");
  await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
  await page.getByTestId("harness-patch-candidate").click();
  await takeWindowPromise(page, "qaCandidate");
  await page.getByLabel("작품 제목").fill("Unrelated source");
  await page.evaluate(async () => {
    const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    await repoMod.projectRepository.current().flushCurrent();
  });
  expect(await page.getByTestId("harness-candidate-scope").getAttribute("data-title")).toBe("Kept candidate");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Unrelated source");
});

test("repropose-requires-new-approval", async ({ page }) => {
  const generateCalls: string[] = [];
  await page.route("**/api/generate**", route => {
    generateCalls.push(route.request().url());
    return route.abort();
  });
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByLabel("작품 제목").fill("New base");
  await page.evaluate(async () => {
    const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    await repoMod.projectRepository.current().flushCurrent();
  });
  await page.getByTestId("harness-tab-review").click();
  await armWindowPromise(page, "qaRepropose", "vnmaker:harness-repropose");
  await page.getByTestId("harness-repropose").click();
  await takeWindowPromise(page, "qaRepropose");
  expect(generateCalls).toEqual([]);
  const runId = await page.getByTestId("harness-workspace").getAttribute("data-run-id");
  expect(runId).toBeTruthy();
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("New base");
});

test("conflict-needs-resolution", async ({ page }) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await armWindowPromise(page, "qaConflict", "vnmaker:harness-conflict");
  await page.getByLabel("작품 제목").fill("Conflicted source");
  await page.evaluate(async () => {
    const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    await repoMod.projectRepository.current().flushCurrent();
  });
  await takeWindowPromise(page, "qaConflict");
  await expect(page.getByTestId("harness-conflict")).toHaveAttribute("data-kind", "warning");
  expect(await page.getByTestId("harness-conflict").getAttribute("data-kind")).not.toBe("success");
});
