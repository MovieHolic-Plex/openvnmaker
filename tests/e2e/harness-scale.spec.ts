import { expect, test, type Page } from "@playwright/test";
import type { VnScript } from "../../packages/content/src/index.js";
import { generateMedium } from "../fixtures/harness/medium.js";
import { armWindowPromise, bootStudio, createDirectorRun, openWorkspace, takeWindowPromise } from "./helpers/harness-ui.ts";

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? Number.POSITIVE_INFINITY;
}

async function seedMedium(page: Page, script: VnScript) {
  await page.route("**/storage-seed", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Storage seed</title>" }));
  await page.goto("/storage-seed");
  await page.evaluate(async next => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vnmaker.projects", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put({ id: "legacy", updatedAt: 42, script: next });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    localStorage.setItem("vnmaker.studio.active-project.v1", "legacy");
    localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(next));
  }, script);
}

async function hostInfo(page: Page) {
  return page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    innerWidth, innerHeight,
  }));
}

function firstLineOps(script: VnScript, count: number) {
  const operations: { sceneId: string; lineIndex: number; text: string }[] = [];
  for (const scene of script.scenes) {
    for (let index = 0; index < scene.lines.length; index++) {
      if (operations.length >= count) return operations;
      operations.push({ sceneId: scene.id, lineIndex: index, text: `patched ${operations.length + 1}` });
    }
  }
  return operations;
}

test("medium-editor-interactions", async ({ page }, info) => {
  const script = generateMedium();
  await seedMedium(page, script);
  await page.addInitScript(() => { performance.mark("harness-boot-start"); });
  await bootStudio(page);
  await openWorkspace(page);
  await page.getByTestId("harness-tab-work").click();
  await expect(page.getByTestId("harness-scene-unit-list")).toBeVisible();
  const ready = await page.evaluate(() => {
    performance.mark("harness-edit-ready");
    performance.measure("edit-ready", "harness-boot-start", "harness-edit-ready");
    return performance.getEntriesByName("edit-ready").at(-1)?.duration ?? -1;
  });
  expect(ready).toBeLessThanOrEqual(5000);
  const sceneSamples: number[] = [];
  for (let index = 0; index < 20; index++) {
    const id = `s${String(index + 1).padStart(3, "0")}`;
    await page.getByTestId("harness-scene-window").evaluate((node, top) => {
      if (node instanceof HTMLElement) node.scrollTop = top;
    }, index * 40);
    await expect(page.getByTestId(`harness-scene-${id}`)).toBeVisible();
    sceneSamples.push(await page.evaluate(async sceneId => {
      performance.clearMarks("scene-select-start");
      performance.clearMarks("scene-select-end");
      performance.clearMeasures("scene-select");
      const button = document.querySelector(`[data-testid="harness-scene-${sceneId}"]`);
      if (!(button instanceof HTMLButtonElement)) throw new Error("missing scene");
      performance.mark("scene-select-start");
      button.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      performance.mark("scene-select-end");
      performance.measure("scene-select", "scene-select-start", "scene-select-end");
      const selected = document.querySelector("[data-testid='harness-scene-unit-list']")?.getAttribute("data-selected");
      if (selected !== sceneId) throw new Error("selection lost");
      return performance.getEntriesByName("scene-select").at(-1)?.duration ?? -1;
    }, id));
  }
  expect(percentile(sceneSamples, 95)).toBeLessThanOrEqual(250);
  const typeSamples: number[] = [];
  for (let index = 0; index < 20; index++) {
    await page.getByTestId("harness-context-search").fill("");
    typeSamples.push(await page.evaluate(async () => {
      const input = document.querySelector("[data-testid='harness-context-search']");
      if (!(input instanceof HTMLInputElement)) throw new Error("missing search");
      performance.clearMarks("type-start");
      performance.clearMarks("type-end");
      performance.clearMeasures("type-row");
      performance.mark("type-start");
      input.value = "s002 line 1.";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const row = document.querySelector("[data-testid='harness-search-hit']");
      performance.mark("type-end");
      performance.measure("type-row", "type-start", "type-end");
      if (!(row instanceof HTMLElement) || !row.textContent?.includes("s002")) throw new Error("row missing");
      return performance.getEntriesByName("type-row").at(-1)?.duration ?? -1;
    }));
  }
  expect(percentile(typeSamples, 95)).toBeLessThanOrEqual(100);
  await page.getByTestId("harness-context-search").fill("");
  const diffSamples: number[] = [];
  for (let index = 0; index < 20; index++) {
    await page.getByTestId("harness-tab-work").click();
    diffSamples.push(await page.evaluate(async () => {
      performance.clearMarks("diff-start");
      performance.clearMarks("diff-end");
      performance.clearMeasures("diff-first");
      const tab = document.querySelector("[data-testid='harness-tab-changes']");
      if (!(tab instanceof HTMLButtonElement)) throw new Error("missing tab");
      performance.mark("diff-start");
      tab.click();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const list = document.querySelector("[data-testid='harness-diff-list']");
      performance.mark("diff-end");
      performance.measure("diff-first", "diff-start", "diff-end");
      if (!(list instanceof HTMLElement)) throw new Error("diff missing");
      return performance.getEntriesByName("diff-first").at(-1)?.duration ?? -1;
    }));
  }
  expect(percentile(diffSamples, 95)).toBeLessThanOrEqual(250);
  const host = await hostInfo(page);
  await info.attach("medium-editor-samples", {
    body: JSON.stringify({ host, ready, sceneSamples, typeSamples, diffSamples, sceneP95: percentile(sceneSamples, 95), typeP95: percentile(typeSamples, 95), diffP95: percentile(diffSamples, 95) }, null, 2),
    contentType: "application/json",
  });
});

test("large-diff-keeps-focus-and-state", async ({ page }, info) => {
  const script = generateMedium();
  const operations = firstLineOps(script, 100);
  await seedMedium(page, script);
  await bootStudio(page);
  await openWorkspace(page);
  await createDirectorRun(page);
  await page.getByTestId("harness-tab-work").click();
  await page.getByTestId("harness-scene-s001").click();
  expect(await page.getByTestId("harness-scene-unit-list").getAttribute("data-selected")).toBe("s001");
  await armWindowPromise(page, "qaPatch", "vnmaker:harness-candidate");
  await page.evaluate(async ops => {
    const store: typeof import("../../packages/app/src/studio/harness/candidateStore.js") = await import("/src/studio/harness/candidateStore.ts");
    const workspace = store.getCandidateWorkspace();
    if (workspace === null) throw new Error("no candidate");
    const grouped = new Map<string, Map<number, string>>();
    for (const operation of ops) {
      const current = grouped.get(operation.sceneId) ?? new Map<number, string>();
      current.set(operation.lineIndex, operation.text);
      grouped.set(operation.sceneId, current);
    }
    store.patchCandidateScript({
      ...workspace.script,
      scenes: workspace.script.scenes.map(scene => {
        const sceneOps = grouped.get(scene.id);
        if (sceneOps === undefined) return scene;
        return {
          ...scene,
          lines: scene.lines.map((line, index) => {
            const text = sceneOps.get(index);
            return text === undefined ? line : { ...line, text };
          }),
        };
      }),
    });
  }, operations);
  await takeWindowPromise(page, "qaPatch");
  await page.getByTestId("harness-tab-changes").click();
  const diff = page.getByTestId("harness-diff-list");
  await expect(diff).toHaveAttribute("data-count", "100");
  await expect(diff).toHaveAttribute("data-cloned", "false");
  const windowed = await page.getByTestId("harness-diff-window").evaluate(node => ({
    visible: Number(node.getAttribute("data-visible")),
    total: Number(node.getAttribute("data-total")),
  }));
  expect(windowed.total).toBe(100);
  expect(windowed.visible).toBeLessThan(100);
  await page.getByTestId("harness-tab-work").click();
  expect(await page.getByTestId("harness-scene-unit-list").getAttribute("data-selected")).toBe("s001");
  const search = page.getByTestId("harness-context-search");
  await search.focus();
  await search.dispatchEvent("compositionstart");
  await search.dispatchEvent("compositionupdate", { eventInit: { data: "가" } });
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("harness-context-search");
  expect(await page.getByTestId("harness-scene-unit-list").getAttribute("data-selected")).toBe("s001");
  await search.dispatchEvent("keydown", { eventInit: { key: "ArrowDown", isComposing: true } });
  expect(await page.getByTestId("harness-scene-unit-list").getAttribute("data-selected")).toBe("s001");
  await search.dispatchEvent("compositionend", { eventInit: { data: "가" } });
  const title = page.getByLabel("작품 제목");
  const before = await title.inputValue();
  await title.fill("Edited during large diff");
  await page.getByTestId("studio-undo").click();
  await expect(title).toHaveValue(before);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath("large-diff-390x844.png") });
  const overflow = await page.getByTestId("harness-workspace").evaluate(node => ({
    client: node.clientWidth, scroll: node.scrollWidth, selected: node.querySelector("[data-testid='harness-scene-unit-list']")?.getAttribute("data-selected"),
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
  expect(overflow.selected).toBe("s001");
  await info.attach("large-diff-state", {
    body: JSON.stringify({ host: await hostInfo(page), windowed, overflow, operations: operations.length }, null, 2),
    contentType: "application/json",
  });
});
