import { expect, test } from "@playwright/test";
import {
  armWindowPromise, bootStudio, createDirectorRun, openWorkspace, seedV1, takeWindowPromise,
} from "./helpers/harness-ui.ts";

const outline = (title: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  title, subtitle: "sub", bible: `${title} bible`, start: "s0",
  scenes: [
    { id: "s0", chapter: "1", title: "s0", summary: "Beat summary.", artDirection: "Direction.", targetMinutes: 3, background: "title", next: "s1" },
    { id: "s1", chapter: "1", title: "s1", summary: "Beat summary.", artDirection: "Direction.", targetMinutes: 3, background: "title", ending: "End" },
  ],
  ...extra,
});

test("project-scoped-plan-and-context", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await page.getByTestId("harness-brief").fill("alpha-brief");
  await page.getByTestId("harness-plan-outline").fill(outline("Plan A"));
  await page.getByTestId("harness-plan-canon-id").fill("world-a");
  await page.getByTestId("harness-plan-canon-text").fill("Project A world fact");
  await page.getByTestId("harness-plan-canon-scenes").fill("s0");
  await page.getByTestId("harness-plan-canon-add").click();
  await page.getByTestId("harness-plan-save").click();
  await expect(page.getByTestId("harness-plan-source-world-a")).toBeVisible();
  const sourceIds = await page.getByTestId("harness-plan-context-sources").innerText();
  expect(sourceIds).toContain("world-a");
  expect(sourceIds).toContain("s0");
  const projectA = await page.getByTestId("harness-plan-editor").getAttribute("data-project-id");
  await page.getByTestId("project-library").click();
  await page.getByLabel("새 작품 이름").fill("Project B");
  await page.getByTestId("project-create").click();
  await expect(page.getByLabel("작품 제목")).toHaveValue("Project B");
  await openWorkspace(page);
  await page.getByTestId("harness-brief").fill("beta-brief");
  await page.getByTestId("harness-plan-outline").fill(outline("Plan B"));
  await page.getByTestId("harness-plan-canon-id").fill("world-b");
  await page.getByTestId("harness-plan-canon-text").fill("Project B world fact");
  await page.getByTestId("harness-plan-canon-add").click();
  await page.getByTestId("harness-plan-save").click();
  await expect(page.getByTestId("harness-plan-source-world-b")).toBeVisible();
  expect(await page.getByTestId("harness-plan-editor").getAttribute("data-project-id")).not.toBe(projectA);
  await page.getByTestId("project-library").click();
  await page.getByRole("article").filter({ hasText: "Legacy manuscript" }).getByRole("button", { name: "열기" }).click();
  await openWorkspace(page);
  expect(await page.getByTestId("harness-plan-editor").getAttribute("data-project-id")).toBe(projectA);
  await expect(page.getByTestId("harness-plan-source-world-a")).toBeVisible();
  expect(await page.getByTestId("harness-plan-context-sources").innerText()).toBe(sourceIds);
  await expect(page.getByTestId("harness-brief")).toHaveValue("alpha-brief");
  await info.attach("project-scoped-plan-and-context", {
    body: JSON.stringify({ projectA, sourceIds }), contentType: "application/json",
  });
});

test("canon-change-invalidates-drafts", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await armWindowPromise(page, "qaPlan", "vnmaker:harness-plan");
  await page.getByTestId("harness-approve-plan").click();
  await takeWindowPromise(page, "qaPlan");
  await page.getByTestId("harness-plan-scope-candidate").click();
  await page.getByTestId("harness-plan-outline").fill(outline("Plan C"));
  await page.getByTestId("harness-plan-canon-id").fill("world-1");
  await page.getByTestId("harness-plan-canon-text").fill("Original fact");
  await page.getByTestId("harness-plan-canon-scenes").fill("s1");
  await page.getByTestId("harness-plan-canon-add").click();
  await page.getByTestId("harness-plan-save").click();
  await page.getByTestId("harness-plan-canon-id").fill("world-1b");
  await page.getByTestId("harness-plan-canon-text").fill("Changed major fact");
  await page.getByTestId("harness-plan-canon-scenes").fill("s1");
  await page.getByTestId("harness-plan-canon-add").click();
  await page.getByTestId("harness-plan-save").click();
  await expect(page.getByTestId("harness-plan-affected-units")).toHaveAttribute("data-scenes", /s1/);
  await page.getByTestId("harness-plan-outline").fill(JSON.stringify({
    title: "Bad", subtitle: "sub", bible: "bible", start: "s0",
    scenes: [{ id: "s0", chapter: "1", title: "s0", summary: "Beat summary.", artDirection: "Direction.", targetMinutes: 3, background: "title", next: "missing" }],
  }));
  await page.getByTestId("harness-plan-save").click();
  await expect(page.getByTestId("harness-plan-error")).toContainText("잘못된 분기");
  await page.getByTestId("harness-approve-plan").click();
  await expect(page.getByTestId("harness-plan-error")).toContainText("잘못된 분기");
  await page.getByTestId("harness-plan-outline").fill(JSON.stringify({
    title: "Unreachable", subtitle: "sub", bible: "bible", start: "s0",
    scenes: [
      { id: "s0", chapter: "1", title: "s0", summary: "Beat summary.", artDirection: "Direction.", targetMinutes: 3, background: "title", ending: "Reachable" },
      { id: "s1", chapter: "1", title: "s1", summary: "Beat summary.", artDirection: "Direction.", targetMinutes: 3, background: "title", ending: "Unreachable" },
    ],
  }));
  await page.getByTestId("harness-plan-save").click();
  await expect(page.getByTestId("harness-plan-error")).toContainText("도달할 수 없는");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("canon-change-1440x1000.png") });
  await info.attach("canon-change-invalidates-drafts", {
    body: JSON.stringify({ scenes: await page.getByTestId("harness-plan-affected-units").getAttribute("data-scenes") }),
    contentType: "application/json",
  });
});

test("candidate-plan-approval-keeps-source-head", async ({ page }, info) => {
  await seedV1(page);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  const before = await page.getByTestId("harness-source-scope").getAttribute("data-revision");
  await armWindowPromise(page, "qaPlan", "vnmaker:harness-plan");
  await page.getByTestId("harness-approve-plan").click();
  await takeWindowPromise(page, "qaPlan");
  expect(await page.getByTestId("harness-source-scope").getAttribute("data-revision")).toBe(before);
  expect(await page.getByTestId("harness-plan-editor").getAttribute("data-plan-approved")).toBe("true");
  await info.attach("candidate-plan-approval-keeps-source-head", {
    body: JSON.stringify({ sourceRevision: before }), contentType: "application/json",
  });
});
