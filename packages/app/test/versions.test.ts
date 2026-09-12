import assert from "node:assert/strict";
import { test } from "node:test";
import { ownVersions, staleVersionIds, type ProjectVersion } from "../src/studio/versions.js";
import type { VnScript } from "@vnmaker/content";

const script: VnScript = { title: "t", subtitle: "", start: "s", characters: [], scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "x" }], ending: "끝" }] };
const row = (id: string, projectId: string, createdAt: number): ProjectVersion => ({ id, projectId, createdAt, label: id, fingerprint: "f", script });

test("버전 목록은 프로젝트로 스코프된다 — 다른 작품 원고가 섞이지 않는다", () => {
  const rows = [row("a1", "proj-a", 3), row("b1", "proj-b", 2), row("a2", "proj-a", 1)];
  assert.deepEqual(ownVersions(rows, "proj-a").map((v) => v.id), ["a1", "a2"]);
  assert.deepEqual(ownVersions(rows, "proj-b").map((v) => v.id), ["b1"]);
  assert.deepEqual(ownVersions(rows, "proj-c"), []);
});

test("정리는 프로젝트당 20개 — 다른 프로젝트의 버전을 밀어내지 않는다", () => {
  const a = Array.from({ length: 25 }, (_, i) => row(`a${i}`, "proj-a", i));
  const b = Array.from({ length: 25 }, (_, i) => row(`b${i}`, "proj-b", i));
  const stale = new Set(staleVersionIds([...a, ...b], "proj-a"));
  // proj-a 의 가장 오래된 5개만 지운다
  assert.equal(stale.size, 5);
  for (const id of ["a0", "a1", "a2", "a3", "a4"]) assert.ok(stale.has(id), id);
  // proj-b 는 건드리지 않는다 — 이전 동작은 전체 20개 공유라 A 저장이 B 를 밀어냈다
  assert.equal([...stale].some((id) => id.startsWith("b")), false);
});

test("projectId 없는 레거시 행은 마이그레이션 대상이다", () => {
  const legacy = { id: "old", createdAt: 1, label: "l", fingerprint: "f", script } as ProjectVersion;
  const stale = staleVersionIds([legacy, row("a", "proj-a", 2)], "proj-a");
  assert.deepEqual(stale, ["old"]);
});
