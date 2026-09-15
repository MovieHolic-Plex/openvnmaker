import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import type { ChildProcess } from "node:child_process";

// env 를 import 보다 먼저 세팅해야 한다 — 동적 import 가 필요한 이유다.
process.env.VNMAKER_IMAGE_BACKEND = "codex";

const { codexImagePrompt, parseCodexJsonl, collectNewImages, snapshotImages, codexGenerateImage } = await import("../src/codex/images.js");
const { createApp } = await import("../src/app.js");
const { createMemoryStore } = await import("../src/auth/credentials.js");

test("codex 프롬프트는 구도 힌트와 스킬 지시를 앞에 둔다", () => {
  const prompt = codexImagePrompt("비 내리는 골목", "9:16", "2K");
  assert.ok(prompt.startsWith("Create exactly one image with the image-generation skill, then stop."));
  assert.ok(prompt.includes("Portrait vertical 9:16 composition."));
  assert.ok(prompt.includes("High resolution."));
  assert.ok(prompt.endsWith("비 내리는 골목"));
  // 비율을 모르면 힌트 없이 본문만 간다
  assert.ok(!codexImagePrompt("p").includes("composition"));
});

test("parseCodexJsonl 은 세션 id·에이전트 문장·usage 를 걷어낸다", () => {
  const jsonl = [
    JSON.stringify({ type: "thread.started", thread_id: "sess-1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "그렸다" } }),
    JSON.stringify({ type: "turn.completed", usage: { output_tokens: 42 } }),
    "{잘린 줄",
    "",
  ].join("\n");
  const parsed = parseCodexJsonl(jsonl);
  assert.equal(parsed.sessionId, "sess-1");
  assert.deepEqual(parsed.text, ["그렸다"]);
  assert.equal(parsed.usage?.["output_tokens"], 42);
  assert.deepEqual(parseCodexJsonl("not json\n"), { text: [] });
});

test("collectNewImages 는 스냅샷 이후 새 파일만 찾는다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vnmaker-codex-img-"));
  try {
    await mkdir(join(dir, "old"), { recursive: true });
    await writeFile(join(dir, "old", "keep.png"), "old");
    const before = await snapshotImages(dir);
    await writeFile(join(dir, "old", "stray.png"), "stray");
    await mkdir(join(dir, "new-session"), { recursive: true });
    await writeFile(join(dir, "new-session", "exec-1.png"), "new");
    await writeFile(join(dir, "new-session", "notes.txt"), "ignore me");
    const found = await collectNewImages(dir, before);
    assert.deepEqual(found, [join(dir, "new-session", "exec-1.png"), join(dir, "old", "stray.png")]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** 가짜 ChildProcess — stdin 이 끝나면 stdout JSONL 을보내고 close 한다. */
function fakeCodex(stdout: string, code = 0, onStdin?: (prompt: string) => void): () => ChildProcess {
  return () => {
    const child = new EventEmitter() as ChildProcess;
    const out = new PassThrough();
    const err = new PassThrough();
    const input = new PassThrough();
    let received = "";
    input.on("data", (chunk) => {
      received += chunk.toString("utf8");
    });
    input.on("end", () => {
      // 이미지 쓰기 같은 비동기 부수효과가 끝난 뒤에 close 한다.
      void Promise.resolve(onStdin?.(received)).then(() => {
        out.end(stdout);
        err.end("");
        queueMicrotask(() => child.emit("close", code));
      });
    });
    Object.assign(child, { stdout: out, stderr: err, stdin: input, kill: () => true });
    return child;
  };
}

test("codexGenerateImage 는 세션 디렉터리의 새 PNG 를 수집한다", async () => {
  const imagesDir = await mkdtemp(join(tmpdir(), "vnmaker-codex-out-"));
  const workDir = await mkdtemp(join(tmpdir(), "vnmaker-codex-work-"));
  try {
    const sessionId = "test-session-1";
    const spawnFn = fakeCodex(
      [
        JSON.stringify({ type: "thread.started", thread_id: sessionId }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "완성" } }),
      ].join("\n"),
      0,
      async () => {
        // stdin 이 끝난 뒤(=프롬프트를 다 받은 뒤) 이미지가 떨어진다
        await mkdir(join(imagesDir, sessionId), { recursive: true });
        await writeFile(join(imagesDir, sessionId, "exec-1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      },
    );
    const result = await codexGenerateImage({ prompt: "test" }, { spawnFn, imagesDir, workDir, bin: "codex", timeoutMs: 30_000 });
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0]?.mimeType, "image/png");
    assert.equal(Buffer.from(result.images[0]!.data, "base64")[0], 0x89);
    assert.deepEqual(result.text, ["완성"]);
    assert.equal(result.host, "codex-cli");
  } finally {
    await rm(imagesDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
});

test("이미지가 안 떨어지면 stderr/에이전트 문장을 담아 실패한다", async () => {
  const imagesDir = await mkdtemp(join(tmpdir(), "vnmaker-codex-out-"));
  const workDir = await mkdtemp(join(tmpdir(), "vnmaker-codex-work-"));
  try {
    const spawnFn = fakeCodex(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "스킬을 못 찾았다" } }), 1);
    await assert.rejects(() => codexGenerateImage({ prompt: "p" }, { spawnFn, imagesDir, workDir, bin: "codex", timeoutMs: 30_000 }), /스킬을 못 찾았다|이미지를 만들지 않았다/);
  } finally {
    await rm(imagesDir, { recursive: true, force: true });
    await rm(workDir, { recursive: true, force: true });
  }
});

test("codex 백엔드는 로그인 없이 image/generate 를 받는다", async () => {
  // 생성 자체는 주입된 주자로 대체 — 실제 codex 를 띄우지 않는다.
  const saved: string[] = [];
  const app = createApp({
    store: createMemoryStore(null),
    codexImage: async () => ({
      images: [{ mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64") }],
      text: [],
      host: "codex-cli",
      model: "gpt-5.6-terra",
    }),
  });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "검증용", name: "codex-test-image" }),
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, any>;
  assert.equal(body["backend"], "codex");
  assert.equal(body["unofficial"], false);
  assert.equal(body["images"]?.[0]?.url.startsWith("/api/image/file/"), true);
  saved.push(body["images"]?.[0]?.name ?? "");
  // 저장소에 실제로 쓰였다가 지워지는지 — 뒷정리한다
  if (saved[0]) await rm(join(process.env.VNMAKER_IMAGE_DIR ?? join((await import("node:os")).homedir(), ".vnmaker", "images"), saved[0]), { force: true });
});

test("codex 백엔드에서 주자가 실패하면 502", async () => {
  const app = createApp({
    store: createMemoryStore(null),
    codexImage: async () => {
      throw new Error("codex 가 죽었다");
    },
  });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "p" }),
  });
  assert.equal(res.status, 502);
  const body = (await res.json()) as Record<string, unknown>;
  assert.match(String(body["error"]), /codex 가 죽었다/);
});

test("codex 백엔드 config 는 authRequired:false 와 backend 를 준다", async () => {
  const app = createApp({ store: createMemoryStore(null) });
  const body = (await (await app.request("/api/image/config")).json()) as Record<string, unknown>;
  assert.equal(body["backend"], "codex");
  assert.equal(body["authRequired"], false);
  assert.equal(typeof body["model"], "string");
});

test("codex 백엔드는 model 형태를 검증한다", async () => {
  const app = createApp({ store: createMemoryStore(null), codexImage: async () => ({ images: [], text: [], host: "codex-cli", model: "m" }) });
  const res = await app.request("/api/image/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-VNMaker-Studio": "1" },
    body: JSON.stringify({ prompt: "p", model: "bad model; rm -rf" }),
  });
  assert.equal(res.status, 400);
});
