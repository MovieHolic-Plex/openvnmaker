import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";

test("자격증명이 없으면 status 는 200 authenticated:false", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/auth/status");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { authenticated: false });
});

test("자격증명이 있으면 status 가 provider 와 projectId 를 준다", async () => {
  const expires = Date.now() + 600_000;
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires, projectId: "aicode-consumers", email: "u@example.com" }),
  });
  const res = await app.request("/api/auth/status");
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body["authenticated"], true);
  assert.equal(body["provider"], "google-antigravity");
  assert.equal(body["projectId"], "aicode-consumers");
  assert.equal(body["tier"], "free-tier");
  assert.ok(typeof body["expiresInSeconds"] === "number" && (body["expiresInSeconds"] as number) > 0);
});

test("status 는 토큰 값을 노출하지 않는다", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "SECRET-REFRESH", access: "SECRET-ACCESS", expires: Date.now() + 1000, projectId: "p" }),
  });
  const text = await (await app.request("/api/auth/status")).text();
  assert.ok(!text.includes("SECRET-REFRESH"));
  assert.ok(!text.includes("SECRET-ACCESS"));
});

test("로그인 없이 models 는 401", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/models");
  assert.equal(res.status, 401);
});

test("health 는 200", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { ok: boolean }).ok, true);
});
