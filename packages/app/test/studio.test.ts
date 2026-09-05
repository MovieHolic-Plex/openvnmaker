import assert from "node:assert/strict";
import { test } from "node:test";
import { auditScript, script, parseScript, validBackgroundUrl, type VnScript } from "@vnmaker/content";
import { historyReducer, makePrompt, parseProposal } from "../src/studio/project.js";
import { spritesAt } from "../src/engine/selectors.js";

const base: VnScript = { title: "테스트", subtitle: "", start: "first", characters: script.characters, scenes: [{ id: "first", background: "title", lines: [{ speaker: "seorin", text: "첫 대사", expression: "smile" }, { speaker: null, text: "두 번째 대사" }], sprites: [{ slot: "center", character: "seorin", expression: "neutral" }], ending: "끝" }] };

test("가져오기 검증은 알려지지 않은 화자·깨진 씬·외부 배경 URL을 거부한다", () => {
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], lines: [{ speaker: "unknown", text: "hi" }] }] }), /화자/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], lines: null }] }), /대사/);
  assert.throws(() => parseScript({ ...base, scenes: [{ ...base.scenes[0], backgroundUrl: "https://example.com/track" }] }), /배경 주소/);
  assert.throws(() => parseScript({ ...base, scenes: [base.scenes[0], base.scenes[0]] }), /중복/);
  assert.throws(() => parseScript({ ...base, start: "missing" }), /시작 씬/);
});

test("저장 도중 빈 대사·빈 엔딩인 초안도 다시 열어 수정할 수 있다", () => {
  const draft = parseScript({ ...base, scenes: [{ ...base.scenes[0], ending: "", lines: [{ speaker: null, text: "" }] }] });
  assert.equal(draft.scenes[0]?.lines[0]?.text, "");
  assert.ok(auditScript(draft).some(issue => issue.message.includes("빈 대사")));
  assert.ok(auditScript(draft).some(issue => issue.message.includes("엔딩을 연결")));
});

test("정상 엔딩이 따로 있어도 빠져나올 수 없는 분기를 찾아낸다", () => {
  const graph: VnScript = { ...base, scenes: [{ ...base.scenes[0]!, ending: "", choices: [{ text: "반복", next: "loop" }, { text: "종료", next: "end" }] }, { id: "loop", background: "title", lines: [{ speaker: null, text: "반복한다." }], next: "loop" }, { id: "end", background: "title", lines: [{ speaker: null, text: "끝났다." }], ending: "끝" }] };
  assert.ok(auditScript(graph).some(issue => issue.sceneId === "loop" && issue.message.includes("엔딩이 없습니다")));
  assert.ok(!auditScript(graph).some(issue => issue.sceneId === "end"));
});

test("배경 URL은 생성 파일 경로만 허용한다", () => {
  assert.equal(validBackgroundUrl("/api/image/file/generated-42.png"), true);
  for (const path of ["/api/image/file/../../auth.json", "//example.com/a.png", "javascript:alert(1)", "/api/image/file/a.png?x=1"]) assert.equal(validBackgroundUrl(path), false);
});

test("줄을 넘겨도 마지막으로 지정한 배우 표정을 유지한다", () => {
  assert.equal(spritesAt(base.scenes[0]!, 1)[0]?.expression, "smile");
  assert.equal(spritesAt(base.scenes[0]!, 0)[0]?.expression, "smile");
});

test("AI 대사 적용은 요청한 대사 위치와 이전 연출 필드를 보존한다", () => {
  const source = { ...base, scenes: [{ ...base.scenes[0]!, lines: [{ speaker: null, text: "첫 대사" }, { speaker: "seorin" as const, text: "기존 대사", sfx: "page-turn", shake: true }] }] };
  const proposal = parseProposal('{"lines":[{"speaker":"seorin","text":"수정된 대사"}]}', "rewrite", source, source.scenes[0]!, 1, "fixture");
  assert.equal(proposal.lineIndex, 1);
  assert.equal(proposal.next.scenes[0]?.lines[1]?.sfx, "page-turn");
  assert.equal(proposal.next.scenes[0]?.lines[1]?.shake, true);
  assert.equal(source.scenes[0]?.lines[1]?.text, "기존 대사");
});

test("이어서 쓰기는 새로 추가한 첫 줄을 선택한다", () => {
  const proposal = parseProposal('{"lines":[{"speaker":null,"text":"새로운 대사"}]}', "continue", base, base.scenes[0]!, 0, "fixture");
  assert.equal(proposal.lineIndex, 2);
  assert.equal(proposal.next.scenes[0]?.lines.length, 3);
});

test("완성 작품 AI 제안은 끊긴 링크와 도달 불가 엔딩을 거부한다", () => {
  const raw = { ...base, scenes: [{ ...base.scenes[0], ending: "", next: "missing" }] };
  assert.throws(() => parseProposal(JSON.stringify(raw), "project", base, base.scenes[0]!, 0, "fixture"), /검증 실패/);
});

test("AI 프롬프트는 선택한 대사와 씬·캐릭터 설정을 포함한다", () => {
  const prompt = makePrompt("rewrite", "더 차갑게", base, base.scenes[0]!, 1);
  for (const text of ["더 차갑게", "두 번째 대사", "한서린", "first"]) assert.ok(prompt.includes(text));
});

test("실행 취소 이후 새 수정은 다시 실행 기록을 폐기한다", () => {
  const edited = { ...base, title: "수정" };
  let state = historyReducer({ present: base, past: [], future: [] }, { type: "edit", script: edited, at: 1 });
  state = historyReducer(state, { type: "undo" });
  assert.equal(state.present.title, base.title);
  assert.equal(state.future.length, 1);
  state = historyReducer(state, { type: "edit", script: { ...base, title: "새 수정" }, at: 2 });
  assert.equal(state.future.length, 0);
});
