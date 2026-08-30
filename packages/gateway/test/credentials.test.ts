import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createFileStore, type Credentials } from "../src/auth/credentials.js";

const dir = mkdtempSync(join(tmpdir(), "vnmaker-creds-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("파일이 없으면 null", async () => {
  const store = createFileStore(join(dir, "missing.json"));
  assert.equal(await store.read(), null);
});

test("JSON 이 깨져도 던지지 않고 null", async () => {
  const path = join(dir, "broken.json");
  writeFileSync(path, '{"google-antigravity": {"refresh":');
  assert.equal(await createFileStore(path).read(), null);
});

test("필수 필드가 빠지면 null", async () => {
  const path = join(dir, "partial.json");
  writeFileSync(path, JSON.stringify({ "google-antigravity": { access: "a", expires: 1 } }));
  assert.equal(await createFileStore(path).read(), null);
});

test("왕복하면 모든 필드가 보존된다", async () => {
  const path = join(dir, "round.json");
  const store = createFileStore(path);
  const creds: Credentials = { refresh: "r", access: "a", expires: 123, projectId: "p", email: "e@example.com" };
  await store.write(creds);
  assert.deepEqual(await store.read(), creds);
});

test("다른 provider 키를 덮어쓰지 않는다", async () => {
  const path = join(dir, "multi.json");
  writeFileSync(path, JSON.stringify({ other: { keep: true } }));
  const store = createFileStore(path);
  await store.write({ refresh: "r", access: "a", expires: 1, projectId: "p" });
  const raw = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(path, "utf8"))) as Record<string, unknown>;
  assert.deepEqual(raw["other"], { keep: true });
});
