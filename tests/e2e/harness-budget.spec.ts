import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

async function openEnvironment(page: import("@playwright/test").Page) {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByTestId("harness-tab-environment").click();
}

test("bytes-are-not-tokens", async ({ page }) => {
  await openEnvironment(page);
  await armWindowPromise(page, "qaAdmission", "vnmaker:harness-admission");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("vnmaker:harness-publish-admission", {
    detail: {
      textContextBytes: 30000, countedInputTokens: 7000, tokenCheck: "pass", tokenWindowMode: "input-only",
      knownInputUsage: null, knownOutputUsage: null, policy: "exact-only", allowed: true, reason: null,
    },
  })));
  await takeWindowPromise(page, "qaAdmission");
  expect(await page.getByTestId("harness-text-context-bytes").textContent()).toBe("30000");
  expect(await page.getByTestId("harness-counted-input-tokens").textContent()).toBe("7000");
  expect(await page.getByTestId("harness-text-context-bytes").textContent()).not.toBe(await page.getByTestId("harness-counted-input-tokens").textContent());
});

test("unknown-token-check-is-not-pass", async ({ page }) => {
  await openEnvironment(page);
  expect(await page.getByTestId("harness-production-ready").getAttribute("data-kind")).not.toBe("success");
  expect(await page.getByTestId("harness-production-ready-flag").getAttribute("data-production-ready")).toBe("false");
  await armWindowPromise(page, "qaAdmission", "vnmaker:harness-admission");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("vnmaker:harness-publish-admission", {
    detail: {
      textContextBytes: 1000, countedInputTokens: null, tokenCheck: "unknown", tokenWindowMode: "unknown",
      knownInputUsage: null, knownOutputUsage: null, policy: "exact-only", allowed: false, reason: "TOKEN_UNKNOWN",
    },
  })));
  await takeWindowPromise(page, "qaAdmission");
  expect(await page.getByTestId("harness-token-check").getAttribute("data-token-check")).toBe("unknown");
  expect(await page.getByTestId("harness-token-check-badge").getAttribute("data-kind")).not.toBe("success");
  expect(await page.getByTestId("harness-known-input-usage").textContent()).toBe("null");
  expect(await page.getByTestId("harness-known-output-usage").textContent()).toBe("null");
  await page.getByTestId("harness-token-policy").selectOption("bounded-payload");
  await page.getByTestId("harness-bounded-confirm").check();
  expect(await page.getByTestId("harness-cancel-refund").getAttribute("data-refund")).toBe("false");
});
