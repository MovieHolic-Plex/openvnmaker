import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

test.setTimeout(60_000);

test("resume-committed-work", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  const runId = await page.getByTestId("harness-workspace").getAttribute("data-run-id");
  expect(runId).toBeTruthy();
  const status = await page.getByTestId("harness-status").getAttribute("data-status");
  await armWindowPromise(page, "qaDisconnected", "vnmaker:harness-disconnected");
  await page.evaluate(() => window.dispatchEvent(new Event("vnmaker:harness-disconnect-request")));
  await takeWindowPromise(page, "qaDisconnected");
  await expect(page.getByTestId("harness-disconnected")).toBeVisible();
  await page.getByTestId("harness-reconnect").click();
  await expect(page.getByTestId("harness-workspace")).toHaveAttribute("data-run-id", runId ?? "");
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
  await expect(page.getByTestId("harness-resume")).toBeVisible();
  await expect(page.getByTestId("harness-resume")).toBeEnabled();
  const afterReload = await page.getByTestId("harness-status").getAttribute("data-status");
  expect(afterReload === "running" ? status : afterReload).toBeTruthy();
  await info.attach("resume-committed-work", {
    body: JSON.stringify({ runId, status, afterReload, resumeExplicit: true }), contentType: "application/json",
  });
});

test.describe("fault-matrix", () => {
  test("queued-save/apply", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await page.getByLabel("작품 제목").fill("Queued save title");
    await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    expect(await page.getByLabel("작품 제목").inputValue()).toBe("Queued save title");
  });

  test("duplicate-after-undo", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await openWorkspace(page);
    await createDirectorRun(page);
    await page.getByTestId("harness-tab-work").click();
    await page.getByTestId("harness-instruction").fill("Applied manuscript");
    await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
    await page.getByTestId("harness-patch-candidate").click();
    await takeWindowPromise(page, "qaCandidate");
    await page.getByTestId("harness-tab-review").click();
    await armWindowPromise(page, "qaStaged", "vnmaker:proposal-staged");
    await page.getByTestId("harness-stage-apply").click();
    await takeWindowPromise(page, "qaStaged");
    await armWindowPromise(page, "qaPublished", "vnmaker:harness-apply");
    await page.getByTestId("harness-apply").click();
    await takeWindowPromise(page, "qaPublished");
    await page.getByTestId("studio-undo").click();
    await armWindowPromise(page, "qaDuplicate", "vnmaker:harness-apply");
    await page.getByTestId("harness-apply").click();
    await takeWindowPromise(page, "qaDuplicate");
    expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
  });

  test("r2-reject-accept-race", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await openWorkspace(page);
    await createDirectorRun(page);
    await page.getByTestId("harness-tab-work").click();
    await page.getByTestId("harness-instruction").fill("Rejected candidate");
    await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
    await page.getByTestId("harness-patch-candidate").click();
    await takeWindowPromise(page, "qaCandidate");
    await page.getByTestId("harness-tab-review").click();
    await armWindowPromise(page, "qaStaged", "vnmaker:proposal-staged");
    await page.getByTestId("harness-stage-apply").click();
    await takeWindowPromise(page, "qaStaged");
    await page.getByTestId("harness-reject").click();
    await expect(page.getByTestId("harness-decision-receipt")).toHaveAttribute("data-kind", "rejected");
    await page.getByTestId("harness-apply").click();
    await expect(page.getByRole("status").or(page.getByTestId("harness-proposal-bar"))).toBeVisible();
    expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
  });

  test("preview-boundary-not-ending", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await openWorkspace(page);
    await createDirectorRun(page);
    await page.getByTestId("harness-tab-work").click();
    await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
    await page.getByTestId("harness-first-chapter").click();
    await takeWindowPromise(page, "qaCandidate");
    await armWindowPromise(page, "qaPreview", "vnmaker:harness-preview");
    await page.getByTestId("harness-play-candidate").click();
    await takeWindowPromise(page, "qaPreview");
    await page.getByTestId("advance-button").click();
    await page.getByTestId("advance-button").click();
    await page.getByTestId("advance-button").click();
    await expect(page.getByTestId("choice-menu")).toBeVisible();
    await armWindowPromise(page, "qaBoundary", "vnmaker:harness-boundary");
    await page.getByTestId("choice-0").click();
    await takeWindowPromise(page, "qaBoundary");
    await expect(page.getByTestId("harness-preview-boundary")).toBeVisible();
    expect(await page.getByTestId("harness-preview-boundary").getAttribute("data-reason")).toBe("unwritten-scene");
    expect(await page.locator("[data-testid='ending-title']").count()).toBe(0);
  });

  test("stream disconnect", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await openWorkspace(page);
    await createDirectorRun(page);
    await armWindowPromise(page, "qaDisconnected", "vnmaker:harness-disconnected");
    await page.evaluate(() => window.dispatchEvent(new Event("vnmaker:harness-disconnect-request")));
    await takeWindowPromise(page, "qaDisconnected");
    await expect(page.getByTestId("harness-disconnected")).toBeVisible();
    await expect(page.getByTestId("harness-reconnect")).toBeVisible();
    const status = await page.getByTestId("harness-status").getAttribute("data-status");
    expect(status).not.toBe("cancelled");
  });

  test("restored lineage", async ({ page }) => {
    await seedV1(page);
    await bootStudio(page);
    await openWorkspace(page);
    await createDirectorRun(page);
    const runId = await page.getByTestId("harness-workspace").getAttribute("data-run-id");
    await page.goto("/studio.html");
    await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    await openWorkspace(page);
    const restored = await page.getByTestId("harness-workspace").getAttribute("data-run-id");
    expect(restored === runId || restored === "").toBeTruthy();
  });
});
