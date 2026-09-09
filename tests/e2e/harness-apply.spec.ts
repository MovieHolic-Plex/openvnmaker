import { test, expect, type Page } from "@playwright/test";

test.setTimeout(60_000);

const legacy = { title: "Legacy manuscript", subtitle: "", start: "start", characters: [], scenes: [{ id: "start", background: "title", lines: [{ speaker: null, text: "Unnumbered original" }], ending: "End" }] };
const UUID = {
  proposal: "00000000-0000-4000-8000-000000000013",
  run: "00000000-0000-4000-8000-000000000012",
} as const;

async function seedV1(page: Page) {
  await page.route("**/storage-seed", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Storage seed</title>" }));
  await page.goto("/storage-seed");
  await page.evaluate(async script => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vnmaker.projects", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put({ id: "legacy", updatedAt: 42, script });
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
    localStorage.setItem("vnmaker.studio.active-project.v1", "legacy");
    localStorage.setItem("vnmaker.studio.project.v1", JSON.stringify(script));
  }, legacy);
}

async function databaseState(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vnmaker.projects");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<{ records: unknown[]; heads: unknown[]; decisions: unknown[] }>((resolve, reject) => {
        const stores = Array.from(db.objectStoreNames);
        const tx = db.transaction(stores);
        const records = tx.objectStore("projects").getAll();
        const heads = stores.includes("project-heads") ? tx.objectStore("project-heads").getAll() : null;
        const decisions = stores.includes("proposal-decisions") ? tx.objectStore("proposal-decisions").getAll() : null;
        tx.oncomplete = () => resolve({ records: records.result, heads: heads?.result ?? [], decisions: decisions?.result ?? [] });
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  });
}

async function armWindowPromise(page: Page, key: string, event: string, phase?: string) {
  await page.evaluate(({ key, event, phase }) => {
    const pending = Promise.withResolvers<unknown>();
    Object.assign(window, { [key]: pending.promise });
    window.addEventListener(event, function receive(raw: Event) {
      if (phase !== undefined) {
        if (!(raw instanceof CustomEvent)) return;
        const detail: unknown = raw.detail;
        if (typeof detail !== "object" || detail === null || !("phase" in detail) || detail.phase !== phase) return;
        window.removeEventListener(event, receive);
        pending.resolve(detail);
        return;
      }
      window.removeEventListener(event, receive);
      pending.resolve(true);
    });
  }, { key, event, phase });
}

function takeWindowPromise(page: Page, key: string) {
  return page.evaluate(key => {
    const value: unknown = Reflect.get(window, key);
    if (value instanceof Promise) return value;
    throw new Error(`${key} was not armed`);
  }, key);
}

async function stageProposal(page: Page, title: string, subtitle: string) {
  await armWindowPromise(page, "qaStaged", "vnmaker:proposal-staged");
  await page.evaluate(async ({ title, subtitle, proposalId, runId }) => {
    const repoMod: typeof import("../../packages/app/src/studio/projectRepository.js") = await import("/src/studio/projectRepository.ts");
    const applyMod: typeof import("../../packages/app/src/studio/harness/applyProposal.js") = await import("/src/studio/harness/applyProposal.ts");
    const repository = repoMod.projectRepository.current();
    const snapshot = repository.snapshot;
    const script = { ...snapshot.script, title, subtitle };
    const body = {
      id: proposalId, runId, baseHead: snapshot.head, operations: [],
      requiredAssetHashes: [], contextManifestHash: await applyMod.canonicalHash("fixture-context"),
      validation: { schema: true, graph: true, assets: true, runtime: true, requiredAssetsMissing: [], issues: [], reviewIds: [] },
    };
    applyMod.stageReviewedProposal({
      proposal: applyMod.parseProposal({ ...body, digest: await applyMod.canonicalHash(body) }),
      script, productionDocument: snapshot.productionDocument, contextHead: snapshot.head, assets: [],
    });
  }, { title, subtitle, proposalId: UUID.proposal, runId: UUID.run });
  await takeWindowPromise(page, "qaStaged");
}

test("apply-once-undo-and-redelivery", async ({ page }, info) => {
  await seedV1(page);
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await stageProposal(page, "Applied manuscript", "");
  await armWindowPromise(page, "qaPublished", "vnmaker:harness-apply", "published");
  await page.getByTestId("harness-apply").click();
  const published = await takeWindowPromise(page, "qaPublished");
  expect(page.getByLabel("작품 제목")).toBeTruthy();
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Applied manuscript");
  expect(await page.getByTestId("studio-undo").isEnabled()).toBe(true);
  const afterApply = await databaseState(page);
  expect(afterApply.heads).toEqual([expect.objectContaining({ projectId: "legacy", revision: 1 })]);
  expect(afterApply.records).toContainEqual(expect.objectContaining({ id: "legacy", script: expect.objectContaining({ title: "Applied manuscript" }) }));
  expect(afterApply.decisions).toHaveLength(1);
  const stored = afterApply.decisions[0];
  expect(stored).toEqual(expect.objectContaining({
    proposalId: UUID.proposal, ackStatus: expect.stringMatching(/pending|acked/),
    receipt: expect.objectContaining({ kind: "applied", proposalId: UUID.proposal, resultHead: expect.objectContaining({ revision: 1 }) }),
  }));
  await page.getByTestId("studio-undo").click();
  expect(await page.getByLabel("작품 제목").inputValue()).toBe(legacy.title);
  expect(await page.getByTestId("studio-undo").isEnabled()).toBe(false);
  await armWindowPromise(page, "qaDuplicate", "vnmaker:harness-apply", "duplicate");
  await page.getByTestId("harness-apply").click();
  await takeWindowPromise(page, "qaDuplicate");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe(legacy.title);
  expect(await page.getByTestId("studio-undo").isEnabled()).toBe(false);
  const afterRedelivery = await databaseState(page);
  expect(afterRedelivery.decisions).toHaveLength(1);
  expect(afterRedelivery.decisions[0]).toEqual(stored);
  expect(afterRedelivery.heads).toEqual([expect.objectContaining({ projectId: "legacy", revision: 1 })]);
  await info.attach("apply-once", { body: JSON.stringify({ published, afterApply, afterRedelivery }, null, 2), contentType: "application/json" });
  await page.screenshot({ path: info.outputPath("apply-once-undo-and-redelivery.png") });
});

test("commit-barriers-and-stale-human-edit", async ({ page, context }, info) => {
  await seedV1(page);
  await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await stageProposal(page, "Applied manuscript", "");
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, { qaOriginalPut: put });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === "proposal-decisions") throw new DOMException("Injected quota failure", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  await armWindowPromise(page, "qaFailed", "vnmaker:harness-apply", "failed");
  await page.getByTestId("harness-apply").click();
  await takeWindowPromise(page, "qaFailed");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe(legacy.title);
  const afterFailure = await databaseState(page);
  expect(afterFailure.decisions).toEqual([]);
  expect(afterFailure.heads).toEqual([expect.objectContaining({ revision: 0 })]);
  await page.evaluate(() => {
    const original = Reflect.get(window, "qaOriginalPut");
    if (typeof original !== "function") throw new Error("missing original put");
    Object.defineProperty(IDBObjectStore.prototype, "put", { configurable: true, writable: true, value: original });
  });
  await page.evaluate(async () => {
    const path = "/src/studio/projectRepository.ts";
    const { projectRepository }: typeof import("../../packages/app/src/studio/projectRepository.js") = await import(path);
    const repository = projectRepository.current();
    const pending = Promise.withResolvers<void>();
    Object.assign(window, { qaDirty: pending.promise });
    const unsub = repository.subscribe(() => {
      if (repository.dirty) { unsub(); pending.resolve(); }
    });
    if (repository.dirty) { unsub(); pending.resolve(); }
  });
  await page.getByLabel("작품 제목").fill("Human edit survives");
  await takeWindowPromise(page, "qaDirty");
  await armWindowPromise(page, "qaStale", "vnmaker:harness-apply", "failed");
  await page.getByTestId("harness-apply").click();
  await takeWindowPromise(page, "qaStale");
  expect(await page.getByLabel("작품 제목").inputValue()).toBe("Human edit survives");
  const afterHuman = await databaseState(page);
  expect(afterHuman.decisions).toEqual([]);
  expect(afterHuman.records).toContainEqual(expect.objectContaining({ id: "legacy", script: expect.objectContaining({ title: "Human edit survives" }) }));
  await stageProposal(page, "Human edit survives", "Accepted proposal");
  await page.evaluate(async () => {
    const { armAfterCommitBarrier }: typeof import("../../packages/app/src/studio/harness/applyProposal.js") = await import("/src/studio/harness/applyProposal.ts");
    const barrier = armAfterCommitBarrier();
    Object.assign(window, { qaApplyArrived: barrier.arrived.then(() => "arrived"), qaApplyRelease: barrier.release });
  });
  const waiting = await context.newPage();
  await waiting.goto("/studio.html");
  await expect(waiting.getByRole("heading", { name: "다른 탭에서 편집 중입니다" })).toBeVisible();
  await page.getByTestId("harness-apply").click();
  expect(await takeWindowPromise(page, "qaApplyArrived")).toBe("arrived");
  const committed = await databaseState(page);
  expect(committed.decisions).toEqual([expect.objectContaining({ receipt: expect.objectContaining({ kind: "applied" }) })]);
  const session = await context.newCDPSession(page);
  const crashed = page.waitForEvent("crash");
  const command = session.send("Page.crash").catch(() => {});
  await crashed;
  await expect(waiting.getByLabel("작품 제목")).toHaveValue("Human edit survives");
  const recovered = await databaseState(waiting);
  expect(recovered.records).toContainEqual(expect.objectContaining({
    id: "legacy", script: expect.objectContaining({ title: "Human edit survives", subtitle: "Accepted proposal" }),
  }));
  expect(recovered.decisions).toHaveLength(1);
  expect(recovered.heads).toEqual([expect.objectContaining({ revision: expect.any(Number) })]);
  await info.attach("barriers", { body: JSON.stringify({ afterFailure, afterHuman, committed, recovered }, null, 2), contentType: "application/json" });
  await waiting.screenshot({ path: info.outputPath("commit-barriers-and-stale-human-edit.png") });
  await page.close();
  await command;
});
