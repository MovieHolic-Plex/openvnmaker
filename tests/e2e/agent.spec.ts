import { expect, test } from "@playwright/test";

test("지시하기가 도구 diff 후 PLAY 대사를 바꾼다", async ({ page }) => {
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
  await page.route("**/api/agent/run", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const sent = route.request().postDataJSON() as { message?: string };
    expect(sent.message).toContain("차갑");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        text: "선택 중인 말만 바꿨다.",
        diffs: [{ tool: "upsert_beats", summary: "hello: 따뜻하다 → 바람이 차갑다." }],
        playFrom: "hello",
        node: {
          id: "hello",
          label: "한 줄",
          beats: [
            { op: "scene", bg: "title", bgm: "main-theme", chapter: "HELLO" },
            { op: "say", who: null, text: "바람이 차갑다." },
          ],
        },
        unofficial: true,
        quotaShared: true,
      }),
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("agent-button")).toBeEnabled();
  await page.getByTestId("agent-input").fill("이 대사만 더 차갑게");
  await page.getByTestId("agent-button").click();
  await expect(page.getByTestId("stage")).toHaveAttribute("data-scene", "hello");
  await expect(page.getByTestId("agent-diff")).toContainText("차갑다");
  await expect(page.getByTestId("dialogue-text")).toContainText("바람이 차갑다", { timeout: 15_000 });
});
