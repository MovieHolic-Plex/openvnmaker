#!/usr/bin/env node
/**
 * momus / metis 플랜 게이트가 왜 잠겼는지 진단한다.
 *
 * 게이트는 모델이나 API 연결 문제가 아니라 omo-ai 플러그인이 세션 안에서 굴리는
 * 상태 머신이다. 규칙은 omo-task.js 번들에 박혀 있으므로 상수를 베끼지 않고
 * 실제 번들에서 읽어 온다. 번들 파싱에 실패한 부분만 아래 상수로 되돌리며,
 * 그때는 출력에 fallback 이라고 밝힌다.
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
  /** 스킬 태그에서 스킬 이름을 캐낸다. 태그는 요청과 호출 양쪽으로 등록된다. */
  skillTag: /<skill\s+name="([^"]+)"/gi,
  /** 자연어 매칭 전에 지워지는 블록. 순서는 번들과 같이 ultrawork/reminder 다음 skill 이다. */
  strip: [
    /<ultrawork-mode>[\s\S]*?<\/ultrawork-mode>/gi,
    /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
    /<skill\s+name="[^"]*"[\s\S]*?<\/skill>/gi,
    /<skill\s+name="[^"]*"[\s\S]*$/i,
  ],
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
      return { re: new RegExp(src.slice(start + 1, i), src.slice(i + 1, j)), end: j };
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
      out.push(lit.re);
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

/** `이름=[/<접두>` 형태의 배열 선언을 앵커로 잡아 정규식들을 읽는다. */
function parseArrayByPrefix(src, prefixPattern) {
  const m = src.match(prefixPattern);
  if (!m) return null;
  return parseRegexArray(src, m[0].slice(0, m[0].indexOf("[") + 1));
}

/** 게이트 표를 키 이름에 의존하지 않고 통째로 읽는다. */
function parseGates(src) {
  const at = src.search(/var\s+\w+=\{\w+:\{requiresSkills:/);
  if (at === -1) return { gates: null, complete: false };
  const chunk = src.slice(at, at + 800);
  const end = chunk.indexOf("};");
  const body = end === -1 ? chunk : chunk.slice(0, end);
  const gates = {};
  const entry = /([A-Za-z_$][\w$]*):\{requiresSkills:\[([^\]]*)\],requiresPlanArtifact:(!0|!1),forbidsSkills:\[([^\]]*)\]\}/g;
  const list = (raw) => [...raw.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const m of body.matchAll(entry)) {
    gates[m[1]] = { requiresSkills: list(m[2]), requiresPlanArtifact: m[3] === "!0", forbidsSkills: list(m[4]) };
  }
  // 선언에 있는 항목 수와 읽어 낸 수가 다르면 규칙이 바뀐 것이다. 조용히 넘기지 않는다.
  const declared = (body.match(/requiresSkills:/g) ?? []).length;
  const complete = declared > 0 && declared === Object.keys(gates).length;
  return { gates: Object.keys(gates).length > 0 ? gates : null, complete };
}

/** 번들에서 게이트 표와 탐지 규칙을 읽는다. 실패한 항목만 fallback 으로 채운다. */
export function parseRules(bundlePath) {
  if (!bundlePath || !existsSync(bundlePath)) {
    return { ...FALLBACK_RULES, source: "fallback", bundlePath: null, reason: "번들을 찾지 못했다" };
  }
  const src = readFileSync(bundlePath, "utf8");
  const problems = [];

  const { gates, complete } = parseGates(src);
  if (!gates) problems.push("게이트 표");
  else if (!complete) problems.push("게이트 표 일부 항목");

  let keyword = null;
  const kwAt = src.search(/\w+=\{"ulw-plan":\//);
  if (kwAt !== -1) {
    const lit = sliceRegexLiteral(src, src.indexOf("/", src.indexOf('"ulw-plan":', kwAt)));
    if (lit) keyword = { "ulw-plan": lit.re };
  }
  if (!keyword) problems.push("키워드 규칙");

  const natural = parseArrayByPrefix(src, /\w+=\[\/\\b\(\?:make\|write\|create/);
  if (!natural) problems.push("자연어 규칙");

  // 번들은 ultrawork/reminder 블록을 먼저 지우고, 이어서 skill 블록을 지운다.
  const injected = parseArrayByPrefix(src, /\w+=\[\/<ultrawork-mode>/);
  const skillBlocks = parseArrayByPrefix(src, /\w+=\[\/<skill\\s\+name=/);
  if (!injected) problems.push("주입 블록 제거 규칙");
  if (!skillBlocks) problems.push("스킬 블록 제거 규칙");

  let skillTag = null;
  const tagAt = src.search(/\w+=\/<skill\\s\+name="\(\[\^"\]\+\)"\//);
  if (tagAt !== -1) {
    const lit = sliceRegexLiteral(src, src.indexOf("/", tagAt));
    if (lit) skillTag = lit.re;
  }
  if (!skillTag) problems.push("스킬 태그 규칙");

  const strip = injected && skillBlocks ? [...injected, ...skillBlocks] : FALLBACK_RULES.strip;
  return {
    gates: gates ?? FALLBACK_RULES.gates,
    keyword: keyword ?? FALLBACK_RULES.keyword,
    natural: natural ?? FALLBACK_RULES.natural,
    skillTag: skillTag ?? FALLBACK_RULES.skillTag,
    strip,
    source: problems.length === 0 ? "bundle" : "partial",
    bundlePath,
    reason: problems.length === 0 ? null : `${problems.join(", ")} 파싱 실패 → 그 부분만 fallback`,
  };
}

/** 자연어 판정 전에 주입 블록과 스킬 블록을 지운다. 번들과 같은 순서다. */
export function stripInjectedBlocks(text, rules) {
  let out = text;
  for (const re of rules.strip) out = out.replace(re, "");
  return out;
}

/**
 * 사용자 발화 한 건을 번들의 input 핸들러와 같은 순서로 해석한다.
 *
 * 번들은 스킬을 두 갈래로 기록한다. requested 는 requiresSkills 판정에,
 * invoked 는 forbidsSkills 판정에 쓰인다. 슬래시 명령과 스킬 태그는 양쪽 모두에
 * 들어가지만 키워드와 자연어는 requested 에만 들어간다.
 *
 * 주의: 번들은 source 가 "extension" 인 메시지를 통째로 무시한다. 여기서는 사용자가
 * 직접 친 발화만 검사한다고 보고 그 갈래는 재현하지 않는다.
 */
export function analyzeUserText(text, rules) {
  const requested = new Set();
  const invoked = new Set();

  if (text.startsWith("/skill:")) {
    const sp = text.indexOf(" ");
    const name = (sp === -1 ? text.slice(7) : text.slice(7, sp)).trim();
    if (name.length > 0) {
      requested.add(name);
      invoked.add(name);
    }
    return finish(requested, invoked, "slash", `/skill:${name}`);
  }

  for (const m of text.matchAll(rules.skillTag)) {
    const name = m[1]?.trim();
    if (name !== undefined && name.length > 0) {
      requested.add(name);
      invoked.add(name);
    }
  }
  const tagged = requested.size > 0;

  const cleaned = stripInjectedBlocks(text, rules);
  let via = tagged ? "skill-tag" : null;
  let detail = tagged ? `<skill name="${[...requested].join(", ")}">` : null;

  for (const [skill, re] of Object.entries(rules.keyword)) {
    if (re.test(cleaned)) {
      requested.add(skill);
      if (via === null) {
        via = "keyword";
        detail = `${skill} ${re}`;
      }
    }
  }
  const hit = rules.natural.find((re) => re.test(cleaned));
  if (hit !== undefined) {
    requested.add("ulw-plan");
    if (via === null) {
      via = "natural";
      detail = String(hit);
    }
  }
  return finish(requested, invoked, via, detail);
}

function finish(requested, invoked, via, detail) {
  const planRequested = requested.has("ulw-plan");
  return {
    requested: [...requested],
    invoked: [...invoked],
    planRequested,
    matched: planRequested,
    via: planRequested ? via : null,
    detail: planRequested ? detail : null,
  };
}

/** .omo/plans/*.md 를 훑는다. 존재만 볼 수 있고 세션 접촉 여부는 알 수 없다. */
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

/**
 * 규칙 + 디스크 상태를 합쳐 진단 결과를 만든다.
 *
 * 세 조건 중 어느 것도 밖에서 "통과"라고 단정할 수 없다. 세션 메모리를 볼 수 없기
 * 때문이다. 확실히 말할 수 있는 것은 플랜 파일이 아예 없을 때 뿐이라서, 상태를
 * blocked / unknown 두 가지로만 낸다.
 */
export function diagnose({ root = ROOT, env = process.env, texts = [] } = {}) {
  const rules = parseRules(findBundle(env, root));
  const files = scanPlanArtifacts(root);
  const gate = rules.gates.momus ?? FALLBACK_RULES.gates.momus;
  const forbidden = new Set(gate.forbidsSkills);

  return {
    rules: {
      source: rules.source,
      bundlePath: rules.bundlePath ?? null,
      reason: rules.reason,
      keyword: Object.fromEntries(Object.entries(rules.keyword).map(([k, v]) => [k, String(v)])),
      natural: rules.natural.map(String),
      strip: rules.strip.map(String),
      skillTag: String(rules.skillTag),
    },
    gates: rules.gates,
    conditions: [
      {
        id: "user-requested",
        label: `사용자가 이번 세션에서 ${gate.requiresSkills.join(", ")} 을 직접 요청했는가`,
        state: "unknown",
        note: "세션 메모리에만 있어 밖에서는 확인할 수 없다. 아래 패턴 중 하나가 사용자 발화에 있어야 한다.",
      },
      {
        id: "plan-artifact",
        label: ".omo/plans/*.md 플랜 파일을 이번 세션에서 열었는가",
        state: files.length > 0 ? "unknown" : "blocked",
        files,
        note:
          files.length > 0
            ? "디스크에 파일은 있다. 다만 게이트는 '이번 세션에서 읽거나 쓴' 것을 요구하므로, 파일이 있다는 사실만으로는 통과라고 말할 수 없다. 세션 안에서 한 번 열어야 한다."
            : "플랜 파일이 하나도 없다. 이 조건은 확실히 막혀 있다. ulw-plan 워크플로로 플랜을 먼저 만들어야 한다.",
      },
      {
        id: "forbidden-skill",
        label: `${gate.forbidsSkills.join(", ")} 를 아직 호출하지 않았는가`,
        state: "unknown",
        note: `세션에서 /skill:${gate.forbidsSkills[0]} 를 치거나 <skill name="${gate.forbidsSkills[0]}"> 태그가 발화에 들어가면 그 세션에서는 momus 가 영구히 잠긴다. 그때는 새 세션을 열어야 한다.`,
      },
    ],
    textChecks: texts.map((t) => {
      const a = analyzeUserText(t, rules);
      return { text: t, ...a, forbiddenInvoked: a.invoked.filter((s) => forbidden.has(s)) };
    }),
    unlockRecipe: [
      "새 세션을 연다 (같은 세션에서 ulw-execute 를 이미 호출했다면 필수).",
      "사용자가 직접 `/skill:ulw-plan` 을 치거나, 발화에 `ulw-plan` 을 넣거나, `계획을 먼저 세워줘` 처럼 자연어 패턴에 맞게 말한다.",
      "그 세션 안에서 .omo/plans/*.md 플랜 파일을 만들거나 읽어 아티팩트를 접촉시킨다.",
      "그 다음에야 momus 스폰이 허용된다.",
    ],
  };
}

const STATE_MARK = { blocked: "확실히 막힘", unknown: "세션상태(확인불가)" };

function renderText(d) {
  const line = (s = "") => console.log(s);
  const origin =
    d.rules.source === "bundle" ? "omo 번들 실측" : d.rules.source === "partial" ? "일부 fallback (번들 파싱 실패)" : "fallback (번들을 못 찾음)";
  line("momus / metis 플랜 게이트 진단");
  line("=".repeat(48));
  line(`규칙 출처: ${origin}`);
  if (d.rules.bundlePath) line(`번들: ${d.rules.bundlePath}`);
  if (d.rules.reason) line(`주의: ${d.rules.reason}`);
  line();
  line("게이트 규칙");
  for (const [name, g] of Object.entries(d.gates)) {
    line(`  ${name}: 필요스킬=${g.requiresSkills.join(",")} 플랜파일필요=${g.requiresPlanArtifact ? "예" : "아니오"} 금지스킬=${g.forbidsSkills.join(",")}`);
  }
  line();
  line("조건별 상태 — 세션 메모리를 볼 수 없어 '통과'는 밖에서 단정할 수 없다");
  for (const c of d.conditions) {
    line(`  [${STATE_MARK[c.state]}] ${c.label}`);
    line(`         ${c.note}`);
    for (const f of c.files ?? []) line(`         - ${f.name} ${f.bytes}b ${f.mtime}`);
  }
  line();
  line("ulw-plan 요청으로 인정되는 패턴");
  for (const [k, v] of Object.entries(d.rules.keyword)) line(`  키워드 ${k}: ${v}`);
  for (const n of d.rules.natural) line(`  자연어 ${n}`);
  if (d.textChecks.length > 0) {
    line();
    line("발화 검사");
    for (const t of d.textChecks) {
      line(`  ${t.planRequested ? "ulw-plan 요청으로 인정됨" : "요청으로 인정되지 않음"} :: ${t.text}`);
      if (t.planRequested) line(`         매칭(${t.via}) ${t.detail}`);
      else line("         어떤 패턴에도 걸리지 않는다. 표현을 바꿔야 한다.");
      if (t.forbiddenInvoked.length > 0) {
        line(`         경고: 이 발화는 금지 스킬 ${t.forbiddenInvoked.join(", ")} 를 호출된 것으로 등록해 세션을 영구히 잠근다.`);
      }
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

진단에 성공하면 0 으로 끝난다. 게이트가 막혀 있다는 것은 진단 결과이지
이 도구의 실패가 아니므로 종료 코드로 알리지 않는다. 인자가 틀렸거나 진단
자체가 불가능할 때만 1 로 끝난다.

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
    process.exit(0);
  } catch (err) {
    console.error(`진단 실패: ${err.message}`);
    process.exit(1);
  }
}
