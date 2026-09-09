import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

async function openFirstChapterPreview(page: import("@playwright/test").Page) {
  await seedV1(page);
  await bootStudio(page);
  const sourceBefore = await page.getByLabel("작품 제목").inputValue();
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByTestId("harness-tab-work").click();
  await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
  await page.getByTestId("harness-first-chapter").click();
  await takeWindowPromise(page, "qaCandidate");
  await armWindowPromise(page, "qaPreview", "vnmaker:harness-preview");
  await page.getByTestId("harness-play-candidate").click();
  await takeWindowPromise(page, "qaPreview");
  return sourceBefore;
}

test("first-chapter-before-rest", async ({ page }) => {
  const sourceBefore = await openFirstChapterPreview(page);
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
  expect(await page.getByLabel("작품 제목").inputValue()).toBe(sourceBefore);
});

test("unwritten-choice-has-no-side-effects", async ({ page }) => {
  await openFirstChapterPreview(page);
  await page.getByTestId("advance-button").click();
  await page.getByTestId("advance-button").click();
  await page.getByTestId("advance-button").click();
  const before = await page.evaluate(() => window.__vn?.flags ?? {});
  await armWindowPromise(page, "qaBoundary", "vnmaker:harness-boundary");
  await page.getByTestId("choice-0").click();
  await takeWindowPromise(page, "qaBoundary");
  const blocked = await page.evaluate(() => window.__vn?.flags ?? {});
  expect(blocked).toEqual(before);
  await page.getByTestId("harness-boundary-back").click();
  await expect(page.getByTestId("choice-menu")).toBeVisible();
  const restored = await page.evaluate(() => window.__vn?.flags ?? {});
  expect(restored).toEqual(before);
});

test("auto-and-skip-stop-at-boundary", async ({ page }) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByTestId("harness-tab-work").click();
  await armWindowPromise(page, "qaCandidate", "vnmaker:harness-candidate");
  await page.getByTestId("harness-unwritten-next").click();
  await takeWindowPromise(page, "qaCandidate");
  await armWindowPromise(page, "qaPreview", "vnmaker:harness-preview");
  await page.getByTestId("harness-play-candidate").click();
  await takeWindowPromise(page, "qaPreview");
  await armWindowPromise(page, "qaSkipBoundary", "vnmaker:harness-boundary");
  await page.getByTestId("skip-button").click();
  await takeWindowPromise(page, "qaSkipBoundary");
  await expect(page.getByTestId("harness-preview-boundary")).toBeVisible();
  await page.getByTestId("harness-boundary-back").click();
  await armWindowPromise(page, "qaAutoBoundary", "vnmaker:harness-boundary");
  await page.getByTestId("auto-button").click();
  await takeWindowPromise(page, "qaAutoBoundary");
  await expect(page.getByTestId("harness-preview-boundary")).toBeVisible();
  expect(await page.locator("[data-testid='ending-title']").count()).toBe(0);
});

test("preview-save-isolation", async ({ page }) => {
  await openFirstChapterPreview(page);
  await page.getByTestId("save-button").click();
  const keys = await page.evaluate(() => Object.keys(localStorage).sort());
  expect(keys.some(key => key.includes("candidate:"))).toBe(true);
  expect(keys.some(key => key === "vnmaker:save" || key.startsWith("vnmaker:save:preview"))).toBe(false);
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
});

test("new-candidate-does-not-mutate-open-preview", async ({ page }) => {
  await openFirstChapterPreview(page);
  const openHash = await page.getByTestId("harness-candidate-preview").getAttribute("data-hash");
  const openRev = await page.getByTestId("harness-preview-revision").textContent();
  await armWindowPromise(page, "qaMutate", "vnmaker:harness-candidate");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("vnmaker:harness-patch-candidate-title", { detail: "Mutated candidate" })));
  await takeWindowPromise(page, "qaMutate");
  expect(await page.getByTestId("harness-candidate-preview").getAttribute("data-hash")).toBe(openHash);
  expect(await page.getByTestId("harness-preview-revision").textContent()).toBe(openRev);
});

test("reject-preview-export", async ({ page }) => {
  await openFirstChapterPreview(page);
  await page.getByTestId("harness-preview-export").click();
  await expect(page.getByTestId("harness-preview-export-error")).toHaveAttribute("data-code", "PREVIEW_NOT_RELEASE");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Legacy manuscript");
});
