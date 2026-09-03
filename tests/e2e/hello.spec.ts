import { expect, test } from "@playwright/test";

test("한 줄 받기가 PLAY 에 모델 대사를 올린다", async ({ page }) => {
  await page.route("**/api/auth/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authenticated: true,
        provider: "google-antigravity",
        email: "qa@example.com",
        projectId: "aicode-consumers",
        unofficial: true,
      }),
    }),
  );
  await page.route("**/api/generate", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "은행나무 그늘 아래로 종강 바람이 스친다.",
        model: "gemini-3.7-flash",
        host: "mock",
        unofficial: true,
        quotaShared: true,
      }),
    }),
  );
  let saved: { id?: string; beats?: unknown[] } | null = null;
  await page.route("**/api/project/nodes", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    saved = route.request().postDataJSON() as { id?: string; beats?: unknown[] };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, path: "story/nodes/hello.json" }),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("title-screen")).toBeVisible();
  await expect(page.getByTestId("hello-button")).toBeEnabled();
  await page.getByTestId("hello-button").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "hello");
  await expect(page.getByTestId("dialogue-text")).toContainText("은행나무 그늘", { timeout: 15_000 });
  expect(saved?.id).toBe("hello");
  expect(JSON.stringify(saved?.beats ?? [])).toContain("은행나무 그늘");
});
