import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

test("director-workflow", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await armWindowPromise(page, "qaPlan", "vnmaker:harness-plan");
  await page.getByTestId("harness-approve-plan").click();
  await takeWindowPromise(page, "qaPlan");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
  await page.getByTestId("harness-tab-work").click();
  await page.getByTestId("harness-instruction").fill("Candidate draft");
  await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
  await page.getByTestId("harness-patch-candidate").click();
  await takeWindowPromise(page, "qaCandidate");
  expect(await page.getByTestId("harness-candidate-scope").getAttribute("data-title")).toBe("Candidate draft");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
  await page.getByTestId("harness-tab-changes").click();
  await expect(page.getByTestId("harness-diff-title-title")).toBeVisible();
  await page.getByTestId("harness-tab-review").click();
  await armWindowPromise(page, "qaStaged", "vnmaker:proposal-staged");
  await page.getByTestId("harness-stage-apply").click();
  await takeWindowPromise(page, "qaStaged");
  await armWindowPromise(page, "qaPublished", "vnmaker:harness-apply");
  await page.getByTestId("harness-apply").click();
  await takeWindowPromise(page, "qaPublished");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Candidate draft");
  await info.attach("director-workflow", { body: JSON.stringify({ candidate: "Candidate draft", sourceAfter: "Candidate draft" }), contentType: "application/json" });
});

test("conflict-and-reconnect", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  const runId = await page.getByTestId("harness-workspace").getAttribute("data-run-id");
  expect(runId).toBeTruthy();
  await page.getByTestId("harness-tab-work").click();
  await page.getByTestId("harness-instruction").fill("Kept candidate");
  await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
  await page.getByTestId("harness-patch-candidate").click();
  await takeWindowPromise(page, "qaCandidate");
  await armWindowPromise(page, "qaConflict", "vnmaker:harness-conflict");
  await page.getByLabel("작품 제목").fill("Edited source");
  await page.evaluate(async () => {
    const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    await repoMod.projectRepository.current().flushCurrent();
  });
  await takeWindowPromise(page, "qaConflict");
  await expect(page.getByTestId("harness-conflict")).toBeVisible();
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Edited source");
  expect(await page.getByTestId("harness-candidate-scope").getAttribute("data-title")).toBe("Kept candidate");
  await armWindowPromise(page, "qaDisconnected", "vnmaker:harness-disconnected");
  await page.evaluate(() => window.dispatchEvent(new Event("vnmaker:harness-disconnect-request")));
  await takeWindowPromise(page, "qaDisconnected");
  await expect(page.getByTestId("harness-disconnected")).toBeVisible();
  await expect(page.getByTestId("harness-reconnect")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("conflict-1440x1000.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("conflict-390x844.png") });
  const overflow = await page.getByTestId("harness-workspace").evaluate(node => ({
    client: node.clientWidth, scroll: node.scrollWidth, status: node.querySelector("[role='status']") !== null,
  }));
  expect(overflow.status).toBe(true);
  await page.addInitScript(() => {
    const pending = Promise.withResolvers<unknown>();
    Object.assign(window, { qaReadyReload: pending.promise });
    window.addEventListener("vnmaker:harness-workspace-ready", function receive(raw: Event) {
      window.removeEventListener("vnmaker:harness-workspace-ready", receive);
      pending.resolve(raw instanceof CustomEvent ? raw.detail : true);
    });
  });
  await page.reload();
  await takeWindowPromise(page, "qaReadyReload");
  expect(await page.getByTestId("harness-workspace").getAttribute("data-run-id")).toBe(runId);
  await info.attach("action-log", { body: JSON.stringify({ runId, overflow, source: "Edited source", candidate: "Kept candidate" }, null, 2), contentType: "application/json" });
});
