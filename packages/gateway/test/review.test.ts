import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/app.js";
import { createMemoryStore } from "../src/auth/credentials.js";
import { buildReviewPrompt, compactManuscript, parseReviewFindings } from "../src/cca/review.js";

const MANUSCRIPT = {
  title: "비가 남긴 빈칸",
  subtitle: "마지막 밤",
  characters: [{ id: "seorin", name: "서린" }, { id: "me", name: "우진" }],
  scenes: [
    { id: "s01", chapter: "1장", next: "s02", lines: [{ speaker: null, text: "비가 내렸다." }, { speaker: "seorin", text: "왔구나." }] },
    { id: "s02", lines: [{ speaker: "me", text: "그림은?" }], choices: [{ text: "묻는다", next: "s03" }, { text: "기다린다", next: "s03", when: { all: ["patient"] } }] },
    { id: "s03", ending: "빈칸을 전시하다", lines: [{ speaker: null, text: "끝." }] },
  ],
};

const HEADERS = { "Content-Type": "application/json", "X-VNMaker-Studio": "1" };
const authed = () => createMemoryStore({ refresh: "r", access: "a", expires: Date.now() + 600_000, projectId: "p" });

test("compactManuscript 는 서사에 필요한 것만 남기고 잡필드를 버린다", () => {
  const c = compactManuscript({ ...MANUSCRIPT, scenes: [{ id: "s01", junk: 1, lines: [{ speaker: "x", text: "t", junk: 9 }] }] });
  assert.equal(c.title, "비가 남긴 빈칸");
  assert.equal(c.scenes[0]!.id, "s01");
  assert.equal((c.scenes[0]!.lines[0] as Record<string, unknown>)["junk"], undefined);
});

test("buildReviewPrompt 는 씬/인물/조건과 JSON 지시를 담고, focus 를 반영한다", () => {
  const prompt = buildReviewPrompt(MANUSCRIPT, "복선");
  assert.ok(prompt.includes("s01") && prompt.includes("서린") && prompt.includes("엔딩:빈칸을 전시하다"));
  assert.ok(prompt.includes("JSON 배열") && prompt.includes("집중해라: 복선"));
  assert.ok(prompt.includes("(조건)"), "조건부 선택지를 표시한다");
});

test("buildReviewPrompt 는 maxChars 를 넘기지 않고 뒤 씬을 자른다", () => {
  const big = { scenes: Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, lines: [{ speaker: null, text: "가".repeat(200) }] })) };
  const prompt = buildReviewPrompt(big, undefined, 1200);
  assert.ok(prompt.length <= 1200, `길이 ${prompt.length}`);
  assert.ok(prompt.includes("이후 씬 생략"));
});

test("parseReviewFindings 는 코드펜스·잡소리 속 JSON 배열을 꺼내 검증한다", () => {
  const text = "다음은 지적입니다:\n```json\n[{\"severity\":\"high\",\"category\":\"연속성\",\"sceneId\":\"s02\",\"summary\":\"우산 물기가 사라졌다\",\"suggestion\":\"s02 에 물기 묘사 유지\"},{\"severity\":\"bogus\",\"summary\":\"\"},{\"summary\":\"복선 미회수\"}]\n```";
  const findings = parseReviewFindings(text);
  assert.equal(findings.length, 2, "빈 summary 는 버리고, severity 불량은 medium 으로 살린다");
  assert.equal(findings[0]!.severity, "high");
  assert.equal(findings[0]!.sceneId, "s02");
  assert.equal(findings[1]!.severity, "medium");
});

test("parseReviewFindings 는 배열이 아니면 빈 배열", () => {
  assert.deepEqual(parseReviewFindings("문제 없습니다"), []);
  assert.deepEqual(parseReviewFindings("{\"a\":1}"), []);
});

test("POST /api/review 는 manuscript 가 없으면 400 이고 모델을 안 부른다", async () => {
  let called = false;
  const app = createApp({ store: authed(), reviewModel: async () => { called = true; return { text: "[]", host: "h", model: "m" }; } });
  const res = await app.request("/api/review", { method: "POST", headers: HEADERS, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
  assert.equal(called, false);
});

test("POST /api/review 는 로그인 없으면 401", async () => {
  const app = createApp({ store: createMemoryStore(null), reviewModel: async () => ({ text: "[]", host: "h", model: "m" }) });
  const res = await app.request("/api/review", { method: "POST", headers: HEADERS, body: JSON.stringify({ manuscript: MANUSCRIPT }) });
  assert.equal(res.status, 401);
});

test("POST /api/review 는 원고를 프롬프트에 담아 모델을 부르고 findings 를 돌려준다", async () => {
  let seenPrompt = "";
  const app = createApp({
    store: authed(),
    reviewModel: async (_access, params) => { seenPrompt = params.prompt; return { text: "[{\"severity\":\"medium\",\"category\":\"페이싱\",\"summary\":\"2장이 급하다\"}]", host: "h", model: "gemini" }; },
  });
  const res = await app.request("/api/review", { method: "POST", headers: HEADERS, body: JSON.stringify({ manuscript: MANUSCRIPT, focus: "페이싱" }) });
  assert.equal(res.status, 200);
  const json = await res.json() as { findings: unknown[]; model: string; unofficial: boolean };
  assert.ok(seenPrompt.includes("s02") && seenPrompt.includes("집중해라: 페이싱"));
  assert.equal(json.findings.length, 1);
  assert.equal(json.model, "gemini");
  assert.equal(json.unofficial, true);
});

test("POST /api/review 는 모델 오류를 502 로 보고한다", async () => {
  const app = createApp({ store: authed(), reviewModel: async () => { throw new Error("업스트림 죽음"); } });
  const res = await app.request("/api/review", { method: "POST", headers: HEADERS, body: JSON.stringify({ manuscript: MANUSCRIPT }) });
  assert.equal(res.status, 502);
});
