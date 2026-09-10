import { expect, type Page } from "@playwright/test";

export const legacyScript = {
  title: "Legacy manuscript", subtitle: "", start: "start", characters: [],
  scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Unnumbered original" }], ending: "End" }],
};

export async function seedV1(page: Page, script: typeof legacyScript = legacyScript) {
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

export async function armWindowPromise(page: Page, key: string, event: string) {
  await page.evaluate(({ key, event }) => {
    const pending = Promise.withResolvers<unknown>();
    Object.assign(window, { [key]: pending.promise });
    window.addEventListener(event, function receive(raw: Event) {
      window.removeEventListener(event, receive);
      pending.resolve(raw instanceof CustomEvent ? raw.detail : true);
    });
  }, { key, event });
}

export function takeWindowPromise(page: Page, key: string) {
  return page.evaluate(key => {
    const value: unknown = Reflect.get(window, key);
    if (value instanceof Promise) return value;
    throw new Error(`${key} was not armed`);
  }, key);
}

export async function bootStudio(page: Page) {
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
}

export async function openWorkspace(page: Page) {
  await armWindowPromise(page, "qaWorkspaceReady", "vnmaker:harness-workspace-ready");
  await page.getByTestId("workspace-workspace").click();
  await takeWindowPromise(page, "qaWorkspaceReady");
}

export async function createDirectorRun(page: Page, brief = "Director brief") {
  await page.getByTestId("harness-tab-planning").click();
  await page.getByTestId("harness-brief").fill(brief);
  await armWindowPromise(page, "qaRun", "vnmaker:harness-run");
  await page.getByTestId("harness-create-run").click();
  await takeWindowPromise(page, "qaRun");
}
