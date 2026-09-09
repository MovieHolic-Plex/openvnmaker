import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

const HASH = "a".repeat(64);
const seeded = {
  title: "Asset manuscript", subtitle: "", start: "lab",
  characters: [{ id: "seorin", name: "서린", color: "#88aaff", bio: "painter" }],
  scenes: [{
    id: "lab", background: "title", chapter: "1",
    lines: [{ speaker: "seorin", text: "Studio lights." }],
    sprites: [{ slot: "center", character: "seorin", expression: "neutral" }],
    ending: "End",
  }],
  assets: [{ id: "keep-bg", name: "Keep", kind: "background", url: "/assets/art/nocturne-atrium.png" }],
};

const pending = {
  assetId: "expr-seorin-smile", name: "서린 미소", role: "expression",
  target: { kind: "character", characterId: "seorin" }, characterId: "seorin", expression: "smile",
  originalHash: HASH, deliveryHash: HASH, referenceHash: HASH, compositing: "alpha",
  url: "/assets/sprite/seorin-smile.png", registered: true, outcome: "succeeded", pixelKind: "decoded",
};

async function openAssets(page: Parameters<typeof bootStudio>[0]) {
  await page.getByTestId("harness-tab-assets").click();
  await expect(page.getByTestId("harness-asset-review")).toBeVisible();
}

test("reference-generate-review-attach", async ({ page }, info) => {
  await seedV1(page, seeded);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page, "Asset brief");
  await armWindowPromise(page, "qaPlan", "vnmaker:harness-plan");
  await page.getByTestId("harness-approve-plan").click();
  await takeWindowPromise(page, "qaPlan");
  await openAssets(page);
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("vnmaker:harness-asset-fixture", { detail })), {
    kind: "capabilities", imageOutputStatus: "ready", imageReferenceStatus: "ready",
    imageModelId: "gemini-3.1-flash-image", textModelId: "gemini-3.8-flash-high",
  });
  await expect(page.getByTestId("harness-asset-image-model")).toHaveText("gemini-3.1-flash-image");
  await expect(page.getByTestId("harness-asset-text-model")).toHaveText("gemini-3.8-flash-high");
  await expect(page.getByTestId("harness-asset-image-limit")).toHaveText("72");
  await page.getByTestId("harness-reference-hash").fill(HASH);
  await page.getByTestId("harness-reference-character").selectOption("seorin");
  await armWindowPromise(page, "qaAssetRef", "vnmaker:harness-asset");
  await page.getByTestId("harness-approve-reference").click();
  await takeWindowPromise(page, "qaAssetRef");
  await page.evaluate(asset => { window.__harnessAssetFixture = asset; }, pending);
  await armWindowPromise(page, "qaGenerated", "vnmaker:harness-asset");
  await page.getByTestId("harness-generate-asset").click();
  await takeWindowPromise(page, "qaGenerated");
  await page.getByTestId("harness-compare-original").click();
  await page.getByTestId("harness-compare-delivery").click();
  await page.getByTestId("harness-compare-reference").click();
  await page.getByTestId("harness-inspect-checkerboard").click();
  await page.getByTestId("harness-inspect-white").click();
  await page.getByTestId("harness-inspect-black").click();
  await page.getByTestId("harness-inspect-stage").click();
  await expect(page.getByTestId("harness-asset-inspect")).toHaveAttribute("data-bg", "stage");
  await page.getByTestId("harness-role-notes").click();
  await armWindowPromise(page, "qaAdopt", "vnmaker:harness-asset");
  await page.getByTestId("harness-adopt-asset").click();
  await takeWindowPromise(page, "qaAdopt");
  await expect(page.getByTestId("harness-adopted-ids")).toHaveAttribute("data-ids", /expr-seorin-smile/);
  await page.getByTestId("harness-attach-scene").selectOption("lab");
  await page.getByTestId("harness-attach-asset-id").selectOption("expr-seorin-smile");
  await page.getByTestId("harness-attach-role").selectOption("expression");
  await armWindowPromise(page, "qaAttach", "vnmaker:harness-asset");
  await page.getByTestId("harness-attach-asset").click();
  await takeWindowPromise(page, "qaAttach");
  await expect(page.getByTestId("harness-attached-id")).toHaveAttribute("data-id", "expr-seorin-smile");
  await expect(page.getByTestId("art-library")).toBeVisible();
  await page.addInitScript(() => {
    const pendingReady = Promise.withResolvers<unknown>();
    Object.assign(window, { qaReadyReload: pendingReady.promise });
    window.addEventListener("vnmaker:harness-workspace-ready", function receive(raw: Event) {
      window.removeEventListener("vnmaker:harness-workspace-ready", receive);
      pendingReady.resolve(raw instanceof CustomEvent ? raw.detail : true);
    });
  });
  await page.reload();
  await takeWindowPromise(page, "qaReadyReload");
  await openAssets(page);
  await expect(page.getByTestId("harness-adopted-ids")).toHaveAttribute("data-ids", /expr-seorin-smile/);
  await expect(page.getByTestId("harness-attached-id")).toHaveAttribute("data-id", "expr-seorin-smile");
  await info.attach("reference-generate-review-attach", {
    body: JSON.stringify({ adopted: "expr-seorin-smile", scene: "lab" }), contentType: "application/json",
  });
});

test("missing-capability-and-unknown-effect", async ({ page }, info) => {
  await seedV1(page, seeded);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page, "Asset brief");
  await openAssets(page);
  await expect(page.getByTestId("art-card-keep-bg")).toBeVisible();
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("vnmaker:harness-asset-fixture", { detail })), {
    kind: "capabilities", imageOutputStatus: "ready", imageReferenceStatus: "blocked",
    imageModelId: "gemini-3.1-flash-image", textModelId: "gemini-3.8-flash-high",
  });
  await expect(page.getByTestId("harness-asset-image-reference")).toHaveAttribute("data-status", "blocked");
  await armWindowPromise(page, "qaBlocked", "vnmaker:harness-asset");
  await page.getByTestId("harness-generate-asset").click();
  await takeWindowPromise(page, "qaBlocked");
  await expect(page.getByTestId("harness-asset-error")).toHaveText("CAPABILITY_REQUIRED");
  await expect(page.getByTestId("art-card-keep-bg")).toBeVisible();
  await page.evaluate(detail => window.dispatchEvent(new CustomEvent("vnmaker:harness-asset-fixture", { detail })), {
    kind: "unknown-effect", effectId: "00000000-0000-4000-8000-000000000018", payloadHash: HASH,
  });
  await expect(page.getByTestId("harness-retry-effect")).toBeDisabled();
  await page.getByTestId("harness-authorize-replacement").check();
  await expect(page.getByTestId("harness-retry-effect")).toBeEnabled();
  await armWindowPromise(page, "qaRetry", "vnmaker:harness-asset");
  await page.getByTestId("harness-retry-effect").click();
  await takeWindowPromise(page, "qaRetry");
  await expect(page.getByTestId("harness-asset-review")).toHaveAttribute("data-retry-authorized", "true");
  await expect(page.getByTestId("art-card-keep-bg")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("assets-1440x1000.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("assets-390x844.png") });
  await info.attach("missing-capability-and-unknown-effect", {
    body: JSON.stringify({ blocked: "CAPABILITY_REQUIRED", retry: true, kept: "keep-bg" }), contentType: "application/json",
  });
});
