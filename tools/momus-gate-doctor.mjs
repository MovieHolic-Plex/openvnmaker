#!/usr/bin/env node
/**
 * momus / metis 플랜 게이트가 왜 잠겼는지 진단한다.
 *
 * 게이트는 모델이나 API 연결 문제가 아니라 omo-ai 플러그인이 세션 안에서 굴리는
 * 상태 머신이다. 규칙은 omo-task.js 번들에 박혀 있으므로 상수를 베끼지 않고
 * 실제 번들에서 읽어 온다. 번들이 바뀌면 이 도구의 판정도 같이 바뀐다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 번들 파싱이 실패했을 때만 쓰는 최후의 값. 낡았을 수 있다고 표시한다. */
export const FALLBACK_RULES = {
  gates: {
    metis: { requiresSkills: ["ulw-plan"], requiresPlanArtifact: true, forbidsSkills: ["ulw-execute"] },
    momus: { requiresSkills: ["ulw-plan"], requiresPlanArtifact: true, forbidsSkills: ["ulw-execute"] },
  },
  keyword: { "ulw-plan": /\bulw[-_ ]?plan\b/i },
  natural: [
    /\b(?:make|write|create|draw|draft|build)\s+(?:me\s+)?(?:a|an|the)?\s*(?:work|implementation|action)?\s*plan\b/i,
    /\bplan\b[^.!?\n]{0,40}\bbefore\s+(?:you\s+)?(?:cod(?:e|ing)|implement|start|work)/i,
    /\bbefore\s+(?:you\s+)?(?:cod(?:e|ing)|implement|start)\b[^.!?\n]{0,40}\bplan\b/i,
    /\bplan\s+(?:it|this|that|the\s+work)\s+(?:out\s+)?first\b/i,
    /계획(?:서)?(?:부터|을|를|\s)*\s*(?:먼저\s*)?(?:세워|세우|짜|작성해|수립해)/,
    /(?:먼저|우선)\s*계획(?:서)?(?:을|를)?\s*(?:세워|세우|짜|작성해|수립해)/,
  ],
  /** 자연어 매칭 전에 지워지는 블록. 시스템이 끼워 넣은 텍스트는 사용자 요청이 아니다. */
  strip: [/<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/gi, /<system-reminder>[\s\S]*?<\/system-reminder>/gi],
};

/** omo-task.js 번들을 찾는다. 전역 bun 설치와 cwd 상위 node_modules 를 모두 본다. */
export function findBundle(env = process.env, cwd = ROOT) {
  const rel = join("omo-ai", "plugin", "extensions", "omo-task.js");
  const candidates = [];
  if (env.OMO_PLUGIN_PATH) {
    candidates.push(env.OMO_PLUGIN_PATH, join(env.OMO_PLUGIN_PATH, rel));
  }
  candidates.push(join(homedir(), ".bun", "install", "global", "node_modules", rel));
  let dir = cwd;
  for (let i = 0; i < 8; i += 1) {
    candidates.push(join(dir, "node_modules", rel));
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return candidates.find((p) => p.endsWith(".js") && existsSync(p)) ?? null;
}

/** 미니파이된 정규식 리터럴 하나를 소스 문자열 그대로 떼어 낸다. */
function sliceRegexLiteral(src, start) {
  let i = start + 1;
  let inClass = false;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      let j = i + 1;
      while (j < src.length && /[a-z]/.test(src[j])) j += 1;
      return { body: src.slice(start + 1, i), flags: src.slice(i + 1, j), end: j };
    }
    i += 1;
  }
  return null;
}

/** `이름=[` 뒤에 이어지는 정규식 리터럴들을 순서대로 모은다. */
function parseRegexArray(src, anchor) {
  const at = src.indexOf(anchor);
  if (at === -1) return null;
  const out = [];
  let i = at + anchor.length;
  while (i < src.length) {
    if (src[i] === "]") break;
    if (src[i] === "/") {
      const lit = sliceRegexLiteral(src, i);
      if (!lit) return null;
      out.push(new RegExp(lit.body, lit.flags));
      i = lit.end;
      continue;
    }
    if (src[i] === "," || src[i] === " ") {
      i += 1;
      continue;
    }
    return null;
  }
  return out.length > 0 ? out : null;
}

/** 번들에서 게이트 표와 탐지 규칙을 읽는다. 하나라도 실패하면 fallback 을 쓴다. */
export function parseRules(bundlePath) {
  if (!bundlePath || !existsSync(bundlePath)) {
    return { ...FALLBACK_RULES, source: "fallback", reason: "번들을 찾지 못했다" };
  }
  const src = readFileSync(bundlePath, "utf8");
  const problems = [];

  const gateAt = src.search(/var\s+\w+=\{metis:\{requiresSkills:/);
  let gates = null;
  if (gateAt !== -1) {
    const chunk = src.slice(gateAt, gateAt + 400);
    gates = {};
    for (const m of chunk.matchAll(
      /(metis|momus):\{requiresSkills:\[([^\]]*)\],requiresPlanArtifact:(!0|!1),forbidsSkills:\[([^\]]*)\]\}/g,
    )) {
      const list = (raw) => [...raw.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      gates[m[1]] = {
        requiresSkills: list(m[2]),
        requiresPlanArtifact: m[3] === "!0",
        forbidsSkills: list(m[4]),
      };
    }
    if (Object.keys(gates).length === 0) gates = null;
  }
  if (!gates) problems.push("게이트 표");

  let keyword = null;
  const kwAt = src.search(/\w+=\{"ulw-plan":\//);
  if (kwAt !== -1) {
    const lit = sliceRegexLiteral(src, src.indexOf("/", src.indexOf('"ulw-plan":', kwAt)));
    if (lit) keyword = { "ulw-plan": new RegExp(lit.body, lit.flags) };
  }
  if (!keyword) problems.push("키워드 규칙");

  const naturalAnchor = src.match(/\w+=\[\/\\b\(\?:make\|write\|create/);
  const natural = naturalAnchor ? parseRegexArray(src, naturalAnchor[0].slice(0, naturalAnchor[0].indexOf("[") + 1)) : null;
  if (!natural) problems.push("자연어 규칙");

  const stripAnchor = src.match(/\w+=\[\/<ultrawork-mode>/);
  const strip = stripAnchor ? parseRegexArray(src, stripAnchor[0].slice(0, stripAnchor[0].indexOf("[") + 1)) : null;
  if (!strip) problems.push("블록 제거 규칙");

  const ok = problems.length === 0;
  return {
    gates: gates ?? FALLBACK_RULES.gates,
    keyword: keyword ?? FALLBACK_RULES.keyword,
    natural: natural ?? FALLBACK_RULES.natural,
    strip: strip ?? FALLBACK_RULES.strip,
    source: ok ? "bundle" : "partial",
    bundlePath,
    reason: ok ? null : `${problems.join(", ")} 파싱 실패 → 그 부분만 fallback`,
  };
}

/** 자연어 판정 전에 시스템이 끼워 넣은 블록을 지운다. */
export function stripInjectedBlocks(text, rules) {
  let out = text;
  for (const re of rules.strip) out = out.replace(re, "");
  return out;
}

/**
 * 사용자 발화가 ulw-plan 요청으로 인정되는지 본다.
 * `/skill:ulw-plan` 접두사, 키워드, 자연어 순으로 검사한다.
 */
export function matchUserRequest(text, rules) {
  const trimmed = text.trim();
  if (trimmed.startsWith("/skill:")) {
    const sp = trimmed.indexOf(" ");
    const name = (sp === -1 ? trimmed.slice(7) : trimmed.slice(7, sp)).trim();
    if (name === "ulw-plan") return { matched: true, via: "slash", detail: "/skill:ulw-plan" };
  }
  const cleaned = stripInjectedBlocks(trimmed, rules);
  for (const [skill, re] of Object.entries(rules.keyword)) {
    if (re.test(cleaned)) return { matched: true, via: "keyword", detail: `${skill} ${re}` };
  }
  for (const re of rules.natural) {
    if (re.test(cleaned)) return { matched: true, via: "natural", detail: String(re) };
  }
  return { matched: false, via: null, detail: null };
}

/** .omo/plans/*.md 를 훑는다. 존재 여부만 본다 — 세션 접촉 여부는 밖에서 알 수 없다. */
export function scanPlanArtifacts(root = ROOT) {
  const dir = join(root, ".omo", "plans");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const st = statSync(join(dir, f));
      return { name: f, path: join(dir, f), bytes: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** 규칙 + 디스크 상태를 합쳐 진단 결과를 만든다. */
export function diagnose({ root = ROOT, env = process.env, texts = [] } = {}) {
  const rules = parseRules(findBundle(env, root));
  const plans = scanPlanArtifacts(root);
  const gate = rules.gates.momus ?? FALLBACK_RULES.gates.momus;
  return {
    rules: {
      source: rules.source,
      bundlePath: rules.bundlePath ?? null,
      reason: rules.reason,
      keyword: Object.fromEntries(Object.entries(rules.keyword).map(([k, v]) => [k, String(v)])),
      natural: rules.natural.map(String),
    },
    gates: rules.gates,
    conditions: [
      {
        id: "user-requested",
        label: `사용자가 이번 세션에서 ${gate.requiresSkills.join(", ")} 을 직접 요청했는가`,
        observable: false,
        note: "세션 메모리에만 있어 밖에서는 확인할 수 없다. 아래 패턴 중 하나가 사용자 발화에 있어야 한다.",
      },
      {
        id: "plan-artifact",
        label: ".omo/plans/*.md 플랜 파일이 이번 세션에서 열렸는가",
        observable: true,
        found: plans,
        pass: plans.length > 0,
        note:
          plans.length > 0
            ? "파일은 있다. 다만 게이트는 '이번 세션에서 읽거나 쓴' 것을 요구하므로 세션 안에서 한 번 열어야 한다."
            : "플랜 파일이 없다. ulw-plan 워크플로로 먼저 플랜을 만들어야 한다.",
      },
      {
        id: "forbidden-skill",
        label: `${gate.forbidsSkills.join(", ")} 를 이미 호출하지 않았는가`,
        observable: false,
        note: "세션에서 /ulw-execute 를 한 번이라도 부르면 그 세션에서는 momus 가 영구히 잠긴다. 새 세션을 열어야 한다.",
      },
    ],
    textChecks: texts.map((t) => ({ text: t, ...matchUserRequest(t, rules) })),
    unlockRecipe: [
      "새 세션을 연다 (같은 세션에서 /ulw-execute 를 이미 불렀다면 필수).",
      "사용자가 직접 `/skill:ulw-plan` 을 치거나, 발화에 `ulw-plan` 을 넣거나, `계획을 먼저 세워줘` 처럼 자연어 패턴에 맞게 말한다.",
      "그 세션 안에서 .omo/plans/*.md 플랜 파일을 만들거나 읽어 아티팩트를 접촉시킨다.",
      "그 다음에야 momus 스폰이 허용된다.",
    ],
  };
}

function renderText(d) {
  const line = (s = "") => console.log(s);
  line("momus / metis 플랜 게이트 진단");
  line("=".repeat(48));
  line(`규칙 출처: ${d.rules.source === "bundle" ? "omo 번들 실측" : d.rules.source === "partial" ? "일부 fallback (번들 파싱 실패)" : "fallback (번들 파싱 실패)"}`);
  if (d.rules.bundlePath) line(`번들: ${d.rules.bundlePath}`);
  if (d.rules.reason) line(`주의: ${d.rules.reason}`);
  line();
  line("게이트 규칙");
  for (const [name, g] of Object.entries(d.gates)) {
    line(`  ${name}: 필요스킬=${g.requiresSkills.join(",")} 플랜파일필요=${g.requiresPlanArtifact ? "예" : "아니오"} 금지스킬=${g.forbidsSkills.join(",")}`);
  }
  line();
  line("조건별 상태");
  for (const c of d.conditions) {
    const mark = c.observable ? (c.pass ? "통과" : "실패") : "세션상태(확인불가)";
    line(`  [${mark}] ${c.label}`);
    line(`         ${c.note}`);
    if (c.found?.length) {
      for (const f of c.found) line(`         - ${f.name} ${f.bytes}b ${f.mtime}`);
    }
  }
  line();
  line("ulw-plan 요청으로 인정되는 패턴");
  for (const [k, v] of Object.entries(d.rules.keyword)) line(`  키워드 ${k}: ${v}`);
  for (const n of d.rules.natural) line(`  자연어 ${n}`);
  if (d.textChecks.length > 0) {
    line();
    line("발화 검사");
    for (const t of d.textChecks) {
      line(`  ${t.matched ? "해제됨" : "해제안됨"} :: ${t.text}`);
      if (t.matched) line(`         매칭(${t.via}) ${t.detail}`);
      else line("         어떤 패턴에도 걸리지 않는다. 표현을 바꿔야 한다.");
    }
  }
  line();
  line("해제 절차");
  d.unlockRecipe.forEach((s, i) => line(`  ${i + 1}. ${s}`));
}

function parseArgv(argv) {
  const texts = [];
  let json = false;
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--text") {
      const v = argv[i + 1];
      if (v === undefined) throw new Error("--text 뒤에 검사할 발화를 넣어야 한다");
      texts.push(v);
      i += 1;
    } else if (argv[i] === "--json") json = true;
    else if (argv[i] === "--help" || argv[i] === "-h") help = true;
    else throw new Error(`알 수 없는 인자: ${argv[i]}`);
  }
  return { texts, json, help };
}

const HELP = `사용법: node tools/momus-gate-doctor.mjs [옵션]

  --text "<발화>"   그 발화가 ulw-plan 요청으로 인정되는지 검사한다 (여러 번 가능)
  --json            기계가 읽는 JSON 으로 출력한다
  --help            이 도움말

환경변수 OMO_PLUGIN_PATH 로 omo-ai 플러그인 경로를 지정할 수 있다.`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const { texts, json, help } = parseArgv(process.argv.slice(2));
    if (help) {
      console.log(HELP);
      process.exit(0);
    }
    const d = diagnose({ texts });
    if (json) console.log(JSON.stringify(d, null, 2));
    else renderText(d);
    const artifact = d.conditions.find((c) => c.id === "plan-artifact");
    process.exit(artifact.pass ? 0 : 1);
  } catch (err) {
    console.error(`진단 실패: ${err.message}`);
    process.exit(1);
  }
}
