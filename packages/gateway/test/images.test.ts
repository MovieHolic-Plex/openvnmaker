import assert from "node:assert/strict";
import { test } from "node:test";
import { buildImageRequest, collectImages, parseSseChunks } from "../src/cca/images.js";
import { extensionFor, sanitizeName } from "../src/images/store.js";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";

// 이 파일은 agy 경로를 검증한다 — 기본 백엔드(codex)와 분리해서 본다.
process.env.VNMAKER_IMAGE_BACKEND = "agy";

test("봉투는 project, responseModalities:[IMAGE], requestType:agent 을 갖는다", () => {
  const body = buildImageRequest({ prompt: "여름 캠퍼스 수채화", projectId: "aicode-consumers", model: "m" }) as Record<
    string,
    any
  >;
  assert.equal(body["project"], "aicode-consumers");
  assert.equal(body["model"], "m");
  assert.equal(body["requestType"], "agent");
  assert.equal(body["userAgent"], "antigravity");
  assert.deepEqual(body["request"].generationConfig.responseModalities, ["IMAGE"]);
  assert.equal(body["request"].generationConfig.candidateCount, 1);
  assert.equal(body["request"].contents[0].parts[0].text, "여름 캠퍼스 수채화");
  assert.equal(body["request"].safetySettings.length, 5);
});

test("aspectRatio 가 없으면 imageConfig 를 아예 넣지 않는다", () => {
  const bare = buildImageRequest({ prompt: "p", projectId: "x" }) as Record<string, any>;
  assert.equal("imageConfig" in bare["request"].generationConfig, false);
  const sized = buildImageRequest({ prompt: "p", projectId: "x", aspectRatio: "16:9" }) as Record<string, any>;
  assert.deepEqual(sized["request"].generationConfig.imageConfig, { aspectRatio: "16:9" });
});

test("requestId 는 요청마다 다르다", () => {
  const a = buildImageRequest({ prompt: "p", projectId: "x" }) as Record<string, unknown>;
  const b = buildImageRequest({ prompt: "p", projectId: "x" }) as Record<string, unknown>;
  assert.notEqual(a["requestId"], b["requestId"]);
});

const sse = [
  `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "그리는 중" }] } }] } })}`,
  "",
  `data: ${JSON.stringify({
    response: {
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAB" } }] } }],
      usageMetadata: { totalTokenCount: 12 },
    },
  })}`,
  "",
  "data: [DONE]",
  "",
  `data: ${JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: "무시된다" }] } }] } })}`,
  "",
].join("\n");

test("SSE 는 [DONE] 에서 멈추고 잘린 이벤트를 버린다", () => {
  const chunks = parseSseChunks(`${sse}\ndata: {"response":`);
  assert.equal(chunks.length, 2);
});

test("이미지와 텍스트, usage 를 걷어낸다", () => {
  const parsed = collectImages(parseSseChunks(sse));
  assert.equal(parsed.images.length, 1);
  assert.equal(parsed.images[0]?.mimeType, "image/png");
  assert.equal(parsed.images[0]?.data, "AAAB");
  assert.deepEqual(parsed.text, ["그리는 중"]);
  assert.equal(parsed.usage?.["totalTokenCount"], 12);
});

test("blockReason 을 올려 보낸다", () => {
  const blocked = collectImages(parseSseChunks(`data: ${JSON.stringify({ response: { promptFeedback: { blockReason: "SAFETY" } } })}\n\n`));
  assert.equal(blocked.blockReason, "SAFETY");
  assert.equal(blocked.images.length, 0);
});

test("파일명은 한 조각으로 좁혀지고 상위 참조가 살아남지 않는다", () => {
  assert.equal(sanitizeName("../../etc/passwd"), "passwd");
  assert.equal(sanitizeName("C:\\Windows\\System32\\evil.png"), "evil.png");
  assert.equal(sanitizeName("여름 캠퍼스.png"), "여름-캠퍼스.png");
  assert.equal(sanitizeName("..."), "");
  assert.equal(sanitizeName("bg\u0000/../x?.png"), "x.png");
  assert.equal(extensionFor("image/png"), "png");
  assert.equal(extensionFor("image/jpeg"), "jpg");
});

test("로그인 없이 image/generate 는 401", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "p" }),
  });
  assert.equal(res.status, 401);
});

test("prompt 가 없으면 400 이고 업스트림을 부르지 않는다", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
  });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "   " }),
  });
  assert.equal(res.status, 400);
});

test("허용하지 않는 aspectRatio 는 400", async () => {
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
  });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "p", aspectRatio: "21:9" }),
  });
  assert.equal(res.status, 400);
});

test("image/config 는 기본 모델과 공유 쿼터 경고를 준다", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const body = (await (await app.request("/api/image/config")).json()) as Record<string, unknown>;
  assert.equal(body["model"], "gemini-3.1-flash-image");
  assert.equal(body["quotaShared"], true);
  assert.equal(body["unofficial"], true);
});

test("없는 이미지 파일은 404", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/image/file/nope-does-not-exist.png");
  assert.equal(res.status, 404);
});

test("이미지 요청은 body.backend 로 codex/agy 를 고른다", async () => {
  let ran = false;
  const app = createApp({
    store: createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" }),
    codexImage: async () => { ran = true; return { images: [{ data: Buffer.from("x"), mimeType: "image/png" }], text: [], model: "codex", host: "local" }; },
  });
  // 기본(agy, 이 파일은 VNMAKER_IMAGE_BACKEND=agy) 이지만 backend:"codex" 를 주면 codex 로 간다.
  const res = await app.request("/api/image/generate", { method: "POST", headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" }, body: JSON.stringify({ prompt: "p", backend: "codex" }) });
  assert.equal(res.status, 200);
  assert.equal(ran, true);
  const json = await res.json() as { backend: string };
  assert.equal(json.backend, "codex");
});

test("/api/image/config 는 두 백엔드를 모두 알린다", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const res = await app.request("/api/image/config", { headers: { "X-VNMaker-Studio": "1" } });
  assert.equal(res.status, 200);
  const json = await res.json() as { backends: { id: string }[] };
  assert.deepEqual(json.backends.map(b => b.id).sort(), ["agy", "codex"]);
});
