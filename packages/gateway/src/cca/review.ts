/**
 * agy(Antigravity/Gemini) 텍스트 모델로 원고를 점검한다. auditScript 가 구조(끊긴 연결·
 * 닫히는 선택지)를 보는 것과 달리, 이쪽은 LLM 이 서사(연속성·개연성·인물 목소리·복선·
 * 페이싱·분기 균형)를 읽고 지적을 낸다. 순수 함수라 네트워크 없이 검증할 수 있다.
 */
import { GENERATE_PROMPT_MAX } from "../config.js";

export type ReviewSeverity = "high" | "medium" | "low";
export interface ReviewFinding {
  readonly severity: ReviewSeverity;
  readonly category: string;
  readonly summary: string;
  readonly sceneId?: string;
  readonly suggestion?: string;
}

interface CompactLine {
  readonly speaker: string | null;
  readonly text: string;
  readonly when?: unknown;
}
interface CompactScene {
  readonly id: string;
  readonly chapter?: string;
  readonly next?: string;
  readonly ending?: string;
  readonly lines: readonly CompactLine[];
  readonly choices?: readonly { readonly text: string; readonly next?: string; readonly when?: unknown }[];
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);

/** 원고에서 서사 점검에 필요한 것만 방어적으로 추린다. 알 수 없는 필드는 버린다. */
export function compactManuscript(manuscript: unknown): { title?: string; subtitle?: string; cast: { id: string; name?: string }[]; scenes: CompactScene[] } {
  const root = (manuscript ?? {}) as Record<string, unknown>;
  const cast = Array.isArray(root["characters"])
    ? root["characters"].flatMap(entry => { const id = str((entry as Record<string, unknown>)?.["id"]); return id ? [{ id, ...(str((entry as Record<string, unknown>)["name"]) ? { name: str((entry as Record<string, unknown>)["name"])! } : {}) }] : []; })
    : [];
  const scenes: CompactScene[] = Array.isArray(root["scenes"])
    ? root["scenes"].flatMap(entry => {
        const row = entry as Record<string, unknown>;
        const id = str(row["id"]);
        if (!id) return [];
        const lines = Array.isArray(row["lines"])
          ? row["lines"].map(line => { const l = line as Record<string, unknown>; return { speaker: typeof l["speaker"] === "string" ? l["speaker"] : null, text: typeof l["text"] === "string" ? l["text"] : "", ...(l["when"] !== undefined ? { when: l["when"] } : {}) }; })
          : [];
        const choices = Array.isArray(row["choices"])
          ? row["choices"].map(choice => { const ch = choice as Record<string, unknown>; return { text: typeof ch["text"] === "string" ? ch["text"] : "", ...(str(ch["next"]) ? { next: str(ch["next"])! } : {}), ...(ch["when"] !== undefined ? { when: ch["when"] } : {}) }; })
          : undefined;
        return [{ id, ...(str(row["chapter"]) ? { chapter: str(row["chapter"])! } : {}), ...(str(row["next"]) ? { next: str(row["next"])! } : {}), ...(str(row["ending"]) ? { ending: str(row["ending"])! } : {}), lines, ...(choices && choices.length ? { choices } : {}) }];
      })
    : [];
  return { ...(str(root["title"]) ? { title: str(root["title"])! } : {}), ...(str(root["subtitle"]) ? { subtitle: str(root["subtitle"])! } : {}), cast, scenes };
}

const SEVERITIES: readonly ReviewSeverity[] = ["high", "medium", "low"];

/** 프롬프트를 조립한다. focus 가 있으면 그 항목을 우선 보게 한다. maxChars 안에서 씬을 자른다. */
export function buildReviewPrompt(manuscript: unknown, focus?: string, maxChars = GENERATE_PROMPT_MAX): string {
  const compact = compactManuscript(manuscript);
  const header =
    "너는 비주얼 노벨 원고를 검토하는 한국어 스토리 에디터다. 아래 원고를 읽고 서사 문제를 지적해라. " +
    "검토 항목: 연속성(앞뒤 사실·소지품·시간의 모순), 개연성(동기 없는 전개), 인물 목소리 일관성, 복선의 회수 여부, " +
    "페이싱(늘어지거나 급한 구간), 분기 균형(선택의 무게와 결과), 톤 이탈. 구조적 끊김(없는 씬 연결 등)은 이미 별도로 검사하므로 무시한다. " +
    (focus ? `특히 다음에 집중해라: ${focus}. ` : "") +
    "출력은 오직 JSON 배열 하나다. 각 원소는 " +
    '{"severity":"high"|"medium"|"low","category":"연속성"|"개연성"|"인물"|"복선"|"페이싱"|"분기"|"톤"|기타 한 단어,"sceneId":"관련 씬 id 또는 생략","summary":"한 문장 지적","suggestion":"한 문장 개선안"} ' +
    "형태다. 문제가 없으면 빈 배열 []. 지적은 심각한 순서로 최대 12개. 코드펜스·설명 문장 없이 JSON 만 낸다.\n\n";
  const cast = compact.cast.length ? `[인물]\n${compact.cast.map(c => `${c.id}=${c.name ?? c.id}`).join(", ")}\n\n` : "";
  const meta = `[작품] ${compact.title ?? "무제"}${compact.subtitle ? ` — ${compact.subtitle}` : ""}\n\n`;
  const sceneText = (scene: CompactScene): string => {
    const flow = scene.ending ? `엔딩:${scene.ending}` : scene.choices?.length ? `선택 ${scene.choices.map(ch => `「${ch.text}」→${ch.next ?? "?"}${ch.when ? "(조건)" : ""}`).join(" / ")}` : scene.next ? `→${scene.next}` : "출구없음";
    const lines = scene.lines.map(l => `${l.speaker ?? "(내레이션)"}: ${l.text}${l.when ? " [조건부]" : ""}`).join("\n");
    return `# ${scene.id}${scene.chapter ? ` (${scene.chapter})` : ""} [${flow}]\n${lines}`;
  };
  let body = "";
  for (const scene of compact.scenes) {
    const block = sceneText(scene) + "\n\n";
    if (header.length + meta.length + cast.length + body.length + block.length > maxChars) { body += "…(이후 씬 생략: 원고가 길어 앞부분만 검토)\n"; break; }
    body += block;
  }
  return header + meta + cast + body;
}

/** 모델 출력에서 JSON 배열을 꺼내 검증한다. 코드펜스·앞뒤 잡소리를 견딘다. */
export function parseReviewFindings(text: string): ReviewFinding[] {
  if (typeof text !== "string") return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) return [];
  let raw: unknown;
  try { raw = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const findings: ReviewFinding[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const summary = str(row["summary"]);
    if (!summary) continue;
    const severity = SEVERITIES.includes(row["severity"] as ReviewSeverity) ? (row["severity"] as ReviewSeverity) : "medium";
    findings.push({
      severity,
      category: str(row["category"])?.slice(0, 24) ?? "기타",
      summary: summary.slice(0, 400),
      ...(str(row["sceneId"]) ? { sceneId: str(row["sceneId"])!.slice(0, 64) } : {}),
      ...(str(row["suggestion"]) ? { suggestion: str(row["suggestion"])!.slice(0, 400) } : {}),
    });
    if (findings.length >= 12) break;
  }
  return findings;
}
