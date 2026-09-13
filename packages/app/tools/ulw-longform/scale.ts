#!/usr/bin/env node
/**
 * ULW long-form capability audit — fixture generator + pipeline scale measurement + edge caps.
 *
 *   cd packages/app && node --import tsx tools/ulw-longform/scale.ts gen
 *   cd packages/app && node --import tsx tools/ulw-longform/scale.ts measure
 *   cd packages/app && node --import tsx tools/ulw-longform/scale.ts edges
 *   cd packages/app && node --import tsx tools/ulw-longform/scale.ts all
 *
 * Fixtures land in /tmp/ulw-longform-fixtures, results in <repo>/evidence/ulw-longform.
 * The generated text is synthetic and repetitive on purpose: it is a scale probe, not prose.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BACKGROUNDS, BGM, SFX, auditScript, parseScript } from "@vnmaker/content";
import { estimateScriptDuration } from "../../src/studio/production.js";
import { generateRenpyScript } from "../../src/studio/renpyScript.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const FIXTURES = "/tmp/ulw-longform-fixtures";
const EVIDENCE = resolve(repo, "evidence/ulw-longform");

const BG_KEYS = Object.keys(BACKGROUNDS);
const BGM_KEYS = Object.keys(BGM);
const SFX_KEYS = Object.keys(SFX);
const CAST = ["seorin", "dohyun", "mirae"] as const;
const EXPRESSIONS = ["neutral", "smile", "sad", "surprised"];

const SUBJ = [
  "비가 그친 오후의 캠퍼스", "도서관 창가의 낡은 의자", "전시 준비가 한창인 작업실", "해질녘 잔디광장",
  "골목 끝 자판기 앞", "미술관 로비의 안내판", "서른 걸음쯤 떨어진 계단", "유리문 너머의 복도",
  "조용한 세미나실", "자료실 가장 깊은 서가", "옥상 난간 옆", "벚나무 그늘 아래 벤치",
  "학생회관 지하 카페", "비를 머금은 은행나무 길", "창고처럼 넓은 스튜디오", "늦은 밤 편의점 앞",
  "전시장 입구의 포스터", "사무실 한쪽 화이트보드", "노트북 화면이 밝힌 책상", "계절이 바뀌는 창가",
];
const ACT = [
  "에는 아직 아무도 없었다", "에 서린 먼지가 천천히 가라앉았다", "에서 우리는 서로의 말을 기다렸다",
  "에는 누군가 남긴 쪽지가 놓여 있었다", "에 비 소리가 오래 머물렀다", "에서 약속한 시간이 지나갔다",
  "에는 익숙한 향이 남아 있었다", "에 마지막 점검 목록이 걸려 있었다", "에서 작은 소리가 났다",
  "에는 잊고 온 물건이 있었다", "에 불이 하나둘 켜졌다", "에서 우리는 같은 곳을 보았다",
  "에는 설명하기 어려운 공기가 흘렀다", "에 유리 조각이 반짝였다", "에서 대화가 조금씩 이어졌다",
  "에는 오래된 사진이 붙어 있었다", "에 바람이 스며들었다", "에서 침묵이 길어졌다",
  "에는 예전의 흔적이 남아 있었다", "에 이름 모를 그림자가 스쳤다",
];
const TAIL = [
  "서린은 그 자리에 오래 서 있었다.", "도현은 웃음을 감추지 않았다.", "미래는 노트를 펼쳐 무언가를 적었다.",
  "우리는 다음 단계를 천천히 정했다.", "누군가의 목소리가 낮게 번졌다.", "시간은 예상보다 빠르게 흘렀다.",
  "그 순간의 공기가 아직도 선명하다.", "나는 그 말을 오래 기억하기로 했다.", "작은 실수가 다음 장면을 바꾸었다.",
  "모두가 같은 결론에 천천히 다가갔다.", "창밖의 빛이 조금씩 옅어졌다.", "우리는 서로의 표정을 살폈다.",
  "결정을 미룰수록 마음은 무거워졌다.", "그날의 기록은 짧게 남았다.", "다음 약속은 흐릿하게 정해졌다.",
  "서로의 말이 조금씩 맞물렸다.", "한 사람의 침묵이 방향을 바꾸었다.", "나는 익숙한 문장을 다시 곱씹었다.",
  "이 장면은 오래 기억될 것 같았다.", "우리는 천천히 자리에서 일어났다.",
];
const TAG = ["그리고 잠시 후.", "한참 뒤에야.", "그때였다.", "돌아보니.", "결국.", "그날 밤.", "다음 주에."];

const lineText = (i: number) => `${SUBJ[i % 20]}${ACT[(i * 7) % 20]} ${TAIL[(i * 13) % 20]} ${TAG[(i * 3) % 7]}`;
const pad = (n: number, w = 3) => String(n).padStart(w, "0");
const speakerOf = (i: number) => (i % 3 === 0 ? null : CAST[(i + 1) % 3]);

interface ScaleSpec { name: string; spine: number; linesPerScene: number; conditional: boolean; endings: number }

const SCALES: ScaleSpec[] = [
  { name: "L1", spine: 20, linesPerScene: 42, conditional: false, endings: 2 },
  { name: "L2", spine: 100, linesPerScene: 42, conditional: false, endings: 8 },
  { name: "L3", spine: 200, linesPerScene: 42, conditional: false, endings: 8 },
  { name: "L3c", spine: 200, linesPerScene: 42, conditional: true, endings: 8 },
];

function makeFlags(spec: ScaleSpec) {
  return {
    affection: 0,
    trust: 0,
    seen_letter: false,
    met_seorin: false,
    met_dohyun: false,
    route_a: false,
    route_b: false,
  } as Record<string, number | boolean>;
}

function buildLongform(spec: ScaleSpec) {
  const scenes: Record<string, unknown>[] = [];
  const spine: string[] = [];
  for (let i = 0; i < spec.spine; i += 1) spine.push(`s${pad(i)}`);

  let lineCounter = 0;
  const linesFor = (sceneIndex: number, count: number) => {
    const rows: Record<string, unknown>[] = [];
    for (let j = 0; j < count; j += 1) {
      const i = lineCounter++;
      const row: Record<string, unknown> = { speaker: speakerOf(i), text: lineText(i) };
      if (i % 5 === 0) row["expression"] = EXPRESSIONS[(i / 5) % 4];
      if (i % 17 === 0 && SFX_KEYS.length) row["sfx"] = SFX_KEYS[i % SFX_KEYS.length];
      if (spec.conditional) {
        if (j % 6 === 5) row["when"] = { compare: [{ flag: "affection", op: "gte", value: 4 }] };
        else if (j % 11 === 10) row["when"] = { all: ["seen_letter"] };
      }
      rows.push(row);
    }
    void sceneIndex;
    return rows;
  };

  const choicePoints: number[] = [];
  for (let i = 7; i < spec.spine - 1; i += 8) choicePoints.push(i);

  for (let i = 0; i < spec.spine; i += 1) {
    const id = spine[i]!;
    const isChoice = choicePoints.includes(i);
    const isHub = i === spec.spine - 1;
    const scene: Record<string, unknown> = {
      id,
      chapter: `${pad(Math.floor(i / 8) + 1, 2)}장 · ${["비의 흔적", "빈 의자", "겹치는 목소리", "유리 조각", "늦은 약속", "다시 창가", "마지막 전시", "남은 문장"][Math.floor(i / 8) % 8]}`,
      background: BG_KEYS[i % BG_KEYS.length]!,
      ...(i % 4 === 0 ? { bgm: BGM_KEYS[i % BGM_KEYS.length]! } : {}),
      ...(i % 3 === 0 ? { sprites: [{ slot: "center", character: CAST[i % 3]!, expression: "neutral" }] } : {}),
      lines: linesFor(i, spec.linesPerScene),
    };
    if (isHub) {
      const choices = Array.from({ length: spec.endings }, (_, k) => ({
        text: `마지막 문장을 ${["붙잡는다", "놓아준다", "다시 쓴다", "접는다", "읽어준다", "감춘다", "태운다", "남긴다"][k % 8]}`,
        next: `ending-${k}`,
        ...(spec.conditional ? { add: { affection: k % 3 } } : {}),
      }));
      scene["choices"] = choices;
    } else if (isChoice) {
      const branches = [0, 1].map((k) => {
        const bid = `${id}-b${k}`;
        scenes.push({
          id: bid,
          chapter: `${pad(Math.floor(i / 8) + 1, 2)}장 · 갈래 ${k + 1}`,
          background: BG_KEYS[(i + k + 3) % BG_KEYS.length]!,
          lines: linesFor(i, 4),
          next: spine[i + 1]!,
        });
        return bid;
      });
      const choices: Record<string, unknown>[] = [
        {
          text: "쪽지를 먼저 읽는다",
          next: branches[0]!,
          ...(spec.conditional ? { set: { seen_letter: true } } : { set: { seen_letter: true } }),
        },
        {
          text: "창가로 걸어간다",
          next: branches[1]!,
          ...(spec.conditional
            ? { add: { affection: 2 } }
            : { set: { met_seorin: true } }),
        },
      ];
      if (spec.conditional && i % 16 === 7) {
        choices.push({
          text: "아무도 모르게 문을 닫는다",
          next: branches[1]!,
          when: { compare: [{ flag: "affection", op: "gte", value: 4 }] },
          add: { trust: 1 },
        });
      }
      scene["choices"] = choices;
    } else if (i < spec.spine - 1) {
      scene["next"] = spine[i + 1]!;
    }
    scenes.push(scene);
  }

  for (let k = 0; k < spec.endings; k += 1) {
    scenes.push({
      id: `ending-${k}`,
      chapter: `${pad(Math.floor(spec.spine / 8) + 1, 2)}장 · 엔딩`,
      background: BG_KEYS[(k + 5) % BG_KEYS.length]!,
      lines: linesFor(k, 3),
      ending: `엔딩 ${k + 1} — ${["붙잡은 문장", "놓아준 문장", "다시 쓴 문장", "접어 둔 문장", "읽어 준 문장", "감춘 문장", "태운 문장", "남긴 문장"][k % 8]}`,
    });
  }

  return {
    title: `장편 검증 원고 ${spec.name}`,
    subtitle: "적대적 규모 검증용 합성 원고",
    start: spine[0]!,
    flags: makeFlags(spec),
    characters: [
      { id: "seorin", name: "한서린", color: "#a8ccdc", bio: "23세, 회화과. 유리의 반사와 비어 있는 부분을 먼저 본다." },
      { id: "dohyun", name: "배도현", color: "#e0b38b", bio: "24세, 산업디자인과. 농담 뒤에 실무적인 배려를 감춘다." },
      { id: "mirae", name: "오미래", color: "#dca9b5", bio: "22세, 컴퓨터공학과이자 학생회 기록 담당." },
      { id: "me", name: "정우진", color: "#b7c6d4", bio: "24세, 컴퓨터공학과. 인터랙티브 스토리 엔진을 만든다." },
    ],
    scenes,
  } as const;
}

function summarize(script: ReturnType<typeof parseScript>) {
  let lines = 0;
  let chars = 0;
  const hangul = /[\uac00-\ud7a3]/gu;
  let hangulChars = 0;
  for (const scene of script.scenes) {
    lines += scene.lines.length;
    for (const line of scene.lines) {
      chars += line.text.replace(/\s/gu, "").length;
      hangulChars += (line.text.match(hangul) ?? []).length;
    }
  }
  return { scenes: script.scenes.length, lines, charsWithoutSpaces: chars, hangulChars, endings: script.scenes.filter(s => s.ending).length, choices: script.scenes.reduce((a, s) => a + (s.choices?.length ?? 0), 0) };
}

const ms = (fn: () => unknown) => {
  const t0 = performance.now();
  const value = fn();
  return { ms: Math.round((performance.now() - t0) * 100) / 100, value };
};

function cmdGen() {
  mkdirSync(FIXTURES, { recursive: true });
  const report: Record<string, unknown> = {};
  for (const spec of SCALES) {
    const raw = buildLongform(spec);
    const script = parseScript(raw);
    const issues = auditScript(script);
    const errors = issues.filter(i => i.severity === "error");
    if (errors.length) throw new Error(`${spec.name}: audit errors: ${JSON.stringify(errors.slice(0, 5))}`);
    const path = `${FIXTURES}/${spec.name}.json`;
    writeFileSync(path, JSON.stringify(script));
    report[spec.name] = { path, bytes: statSync(path).size, ...summarize(script), auditIssues: issues.length, auditWarnings: issues.filter(i => i.severity === "warning").length, warningsSample: issues.slice(0, 3).map(i => i.message) };
  }
  console.log(JSON.stringify(report, null, 1));
  return report;
}

function cmdMeasure() {
  mkdirSync(EVIDENCE, { recursive: true });
  const results: Record<string, unknown> = { measuredAt: new Date().toISOString(), node: process.version, fixtures: {} };
  for (const spec of SCALES) {
    const path = `${FIXTURES}/${spec.name}.json`;
    const rawText = readFileSync(path, "utf8");
    const row: Record<string, unknown> = { bytes: statSync(path).size };
    let script: ReturnType<typeof parseScript>;
    const parse = ms(() => { const parsed = JSON.parse(rawText); return parseScript(parsed); });
    row["parseMs"] = parse.ms;
    script = parse.value;
    row["stats"] = summarize(script);
    const audit = ms(() => auditScript(script));
    row["auditMs"] = audit.ms;
    row["auditErrors"] = (audit.value as ReturnType<typeof auditScript>).filter(i => i.severity === "error").length;
    row["auditWarnings"] = (audit.value as ReturnType<typeof auditScript>).filter(i => i.severity === "warning").length;
    row["auditIssueSample"] = (audit.value as ReturnType<typeof auditScript>).slice(0, 3).map(i => `${i.severity}: ${i.message}`);
    const estimate = ms(() => estimateScriptDuration(script, 320));
    row["estimateMs"] = estimate.ms;
    row["estimate"] = { min: (estimate.value as ReturnType<typeof estimateScriptDuration>).minMinutes, max: (estimate.value as ReturnType<typeof estimateScriptDuration>).maxMinutes, incomplete: (estimate.value as ReturnType<typeof estimateScriptDuration>).incomplete, hasCycle: (estimate.value as ReturnType<typeof estimateScriptDuration>).hasCycle, endings: (estimate.value as ReturnType<typeof estimateScriptDuration>).endingCount };
    const renpy = ms(() => generateRenpyScript(script));
    row["renpyExportMs"] = renpy.ms;
    row["renpyBytes"] = (renpy.value as string).length;
    const stringify = ms(() => JSON.stringify(script));
    row["stringifyMs"] = stringify.ms;
    row["memoryMB"] = Math.round(process.memoryUsage().heapUsed / 1048576);
    results.fixtures[spec.name] = row;
    console.log(`${spec.name}: parse ${row["parseMs"]}ms audit ${row["auditMs"]}ms estimate ${row["estimateMs"]}ms renpy ${row["renpyExportMs"]}ms stringify ${row["stringifyMs"]}ms bytes ${row["bytes"]} seconds=${row["auditMs"] > 3000 ? "AUDIT-SLOW" : "ok"}`);
  }
  writeFileSync(`${EVIDENCE}/scale-pipeline.json`, JSON.stringify(results, null, 1));
  console.log(`wrote ${EVIDENCE}/scale-pipeline.json`);
  return results;
}

function expectReject(label: string, build: () => unknown, row: Record<string, unknown>) {
  try {
    const value = build();
    const script = parseScript(value);
    row[label] = { accepted: true, scenes: script.scenes.length };
  } catch (error) {
    row[label] = { accepted: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function chainScript(count: number, withCycle = false) {
  const scenes = Array.from({ length: count }, (_, i) => ({
    id: `c${pad(i)}`,
    background: BG_KEYS[0]!,
    lines: [{ speaker: null as string | null, text: `기록 ${i}: 창가에 앉아 다음 문장을 기다린다.` }],
    ...(i === count - 1 ? { ending: "끝" } : { next: `c${pad(i + 1)}` }),
    ...(withCycle && i === count - 1 ? { next: "c010", ending: undefined } : {}),
  }));
  if (withCycle) scenes[count - 1] = { id: `c${pad(count - 1)}`, background: BG_KEYS[0]!, lines: [{ speaker: null, text: "다시 서가로 돌아간다." }], next: "c010" } as typeof scenes[0];
  return { title: `연쇄 ${count}`, subtitle: "", start: "c000", flags: {}, characters: [], scenes };
}

function cmdEdges() {
  mkdirSync(EVIDENCE, { recursive: true });
  const row: Record<string, unknown> = { measuredAt: new Date().toISOString() };
  expectReject("scenes300", () => chainScript(300), row);
  expectReject("scenes301", () => chainScript(301), row);

  const oneScene = (lines: number, choices: number) => ({
    title: "캡 경계", subtitle: "", start: "s", flags: {}, characters: [],
    scenes: [{
      id: "s", background: BG_KEYS[0]!,
      lines: Array.from({ length: lines }, (_, i) => ({ speaker: null as string | null, text: `경계 대사 ${i}.` })),
      ...(choices > 0 ? { choices: Array.from({ length: choices }, (_, k) => ({ text: `선택 ${k}`, next: "e" })) } : { next: "e" }),
    }, { id: "e", background: BG_KEYS[0]!, lines: [{ speaker: null, text: "도착." }], ending: "끝" }],
  });
  expectReject("lines2000", () => oneScene(2000, 0), row);
  expectReject("lines2001", () => oneScene(2001, 0), row);
  expectReject("choices8", () => oneScene(1, 8), row);
  expectReject("choices9", () => oneScene(1, 9), row);

  const flagsOf = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`flag_${i}`, 0]));
  expectReject("flags100", () => ({ title: "flags", subtitle: "", start: "s", flags: flagsOf(100), characters: [], scenes: [{ id: "s", background: BG_KEYS[0]!, lines: [{ speaker: null, text: "x" }], ending: "끝" }] }), row);
  expectReject("flags101", () => ({ title: "flags", subtitle: "", start: "s", flags: flagsOf(101), characters: [], scenes: [{ id: "s", background: BG_KEYS[0]!, lines: [{ speaker: null, text: "x" }], ending: "끝" }] }), row);

  // 64-ending fan: hub -> 8 mid hubs -> 8 endings each = 64 endings, 73 scenes.
  const fanScenes: Record<string, unknown>[] = [];
  fanScenes.push({ id: "hub", background: BG_KEYS[0]!, lines: [{ speaker: null, text: "문이 여럿이다." }], choices: Array.from({ length: 8 }, (_, k) => ({ text: `문 ${k}`, next: `mid-${k}` })) });
  for (let k = 0; k < 8; k += 1) {
    fanScenes.push({ id: `mid-${k}`, background: BG_KEYS[0]!, lines: [{ speaker: null, text: `복도 ${k}.` }], choices: Array.from({ length: 8 }, (_, m) => ({ text: `끝 ${m}`, next: `end-${k}-${m}` })) });
    for (let m = 0; m < 8; m += 1) fanScenes.push({ id: `end-${k}-${m}`, background: BG_KEYS[0]!, lines: [{ speaker: null, text: `결말 ${k}-${m}.` }], ending: `결말 ${k}-${m}` });
  }
  const fan = { title: "64 엔딩", subtitle: "", start: "hub", flags: {}, characters: [], scenes: fanScenes };
  {
    const t0 = performance.now();
    const parsed = parseScript(fan);
    const auditMs = ms(() => auditScript(parsed));
    const estimateMs = ms(() => estimateScriptDuration(parsed, 320));
    row["fan64"] = { scenes: parsed.scenes.length, endings: parsed.scenes.filter(s => s.ending).length, parseMs: Math.round((performance.now() - t0) * 100) / 100, auditMs: auditMs.ms, estimateMs: estimateMs.ms, estimate: (estimateMs.value as ReturnType<typeof estimateScriptDuration>).minMinutes };
  }

  for (const [name, count, withCycle] of [["chain300", 300, false], ["cycle300", 300, true]] as const) {
    const t0 = performance.now();
    const parsed = parseScript(chainScript(count, withCycle));
    const audit = ms(() => auditScript(parsed));
    const estimate = ms(() => estimateScriptDuration(parsed, 320));
    const renpy = ms(() => generateRenpyScript(parsed));
    row[name] = { scenes: parsed.scenes.length, parseMs: Math.round((performance.now() - t0) * 100) / 100, auditMs: audit.ms, auditErrors: (audit.value as ReturnType<typeof auditScript>).filter(i => i.severity === "error").length, estimateMs: estimate.ms, hasCycle: (estimate.value as ReturnType<typeof estimateScriptDuration>).hasCycle, renpyMs: renpy.ms };
  }
  writeFileSync(`${EVIDENCE}/edges.json`, JSON.stringify(row, null, 1));
  console.log(JSON.stringify(row, null, 1));
  return row;
}

const cmd = process.argv[2] ?? "all";
if (cmd === "gen" || cmd === "all") cmdGen();
if (cmd === "measure" || cmd === "all") cmdMeasure();
if (cmd === "edges" || cmd === "all") cmdEdges();
