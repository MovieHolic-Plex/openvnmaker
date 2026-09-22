/**
 * 대사 인라인 표기 — 마크업과 플래그 치환을 한 번에 처리한다.
 *
 * 지원 표기:
 *   **굵게**        — 토글
 *   *기울임*        — 토글
 *   {c:#a78bfa}…{/c} — 색 입히기(hex 색만 허용, 닫기 생략 시 줄 끝까지)
 *   {flag:이름}     — 플래그 값으로 치환(없으면 빈 문자열)
 *   {player}        — {flag:player} 의 줄임
 *   \{ \* \}        — 이스케이프(문자 그대로)
 *
 * 엔진은 plain(표기를 걷어낸 텍스트)으로 타이프라이터를 돌리고,
 * 화면에는 parts 를 보이는 글자 수만큼 잘라 렌더한다 — 타이핑 도중
 * 태그가 반쪽 나오는 일이 없다.
 */
import type { StoryFlags } from "@vnmaker/content";

export interface InlinePart {
  readonly text: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly color?: string;
}

export interface ResolvedText {
  readonly plain: string;
  readonly parts: readonly InlinePart[];
}

const INLINE_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FLAG_TOKEN = /^[a-z][a-z0-9_-]{0,63}$/i;

interface Style {
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color?: string;
}

/** {…} 토큰 하나를 읽는다. 인식 못 하면 null(호출자가 문자 그대로 출력). */
function readBrace(text: string, at: number, flags: StoryFlags, style: Style): { next: number; insert?: string; style?: Style } | null {
  const close = text.indexOf("}", at + 1);
  if (close === -1) return null;
  const inner = text.slice(at + 1, close);
  // 열린 색 태그가 없는데 닫는 태그만 오면 원문으로 남긴다 — {c:…} 가 무효였을 때 꼬리가 사라지면 안 된다.
  if (inner === "/c") return style.color === undefined ? null : { next: close + 1, style: { bold: style.bold, italic: style.italic } };
  if (inner.startsWith("c:") && INLINE_COLOR.test(inner.slice(2))) return { next: close + 1, style: { ...style, color: inner.slice(2) } };
  if (inner === "player") return { next: close + 1, insert: String(Object.hasOwn(flags, "player") ? flags["player"] : "") };
  if (inner.startsWith("flag:") && FLAG_TOKEN.test(inner.slice(5))) {
    const name = inner.slice(5);
    return { next: close + 1, insert: String(Object.hasOwn(flags, name) ? flags[name] : "") };
  }
  return null;
}

export function resolveInline(text: string, flags: StoryFlags = {}): ResolvedText {
  const parts: InlinePart[] = [];
  let plain = "";
  let buffer = "";
  let style: Style = { bold: false, italic: false };

  const flush = () => {
    if (buffer === "") return;
    parts.push({ text: buffer, ...(style.bold ? { bold: true } : {}), ...(style.italic ? { italic: true } : {}), ...(style.color ? { color: style.color } : {}) });
    plain += buffer;
    buffer = "";
  };

  let index = 0;
  while (index < text.length) {
    const ch = text[index]!;
    if (ch === "\\" && (text[index + 1] === "{" || text[index + 1] === "}" || text[index + 1] === "*" || text[index + 1] === "\\")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (ch === "{" ) {
      const token = readBrace(text, index, flags, style);
      if (token) {
        if (token.insert !== undefined) {
          buffer += token.insert;
          index = token.next;
          continue;
        }
        if (token.style) {
          flush();
          style = token.style;
          index = token.next;
          continue;
        }
      }
      buffer += ch;
      index += 1;
      continue;
    }
    if (ch === "*" && text[index + 1] === "*") {
      // 굵게는 짝이 있어야 연다 — 이미 켜져 있으면 닫기, 꺼져 있으면 뒤에 ** 가 있을 때만 연다.
      if (style.bold || text.indexOf("**", index + 2) !== -1) {
        flush();
        style = { ...style, bold: !style.bold };
        index += 2;
        continue;
      }
      buffer += "**";
      index += 2;
      continue;
    }
    if (ch === "*") {
      // 기울임도 짝 맞춤 — 별*3 같은 원문이 이탤릭을 켜면 안 된다.
      if (style.italic || text.indexOf("*", index + 1) !== -1) {
        flush();
        style = { ...style, italic: !style.italic };
        index += 1;
        continue;
      }
      buffer += "*";
      index += 1;
      continue;
    }
    buffer += ch;
    index += 1;
  }
  flush();
  return { plain, parts };
}

/** 표기를 걷고 플래그만 풀어 쓴 텍스트 — 화자 이름·선택지처럼 스타일이 필요 없는 곳용. */
export function resolveText(text: string, flags: StoryFlags = {}): string {
  return resolveInline(text, flags).plain;
}

/** parts 를 plain 기준 count 글자까지만 남긴다. 타이프라이터의 표시 길이와 맞춰 쓴다. */
export function truncateParts(parts: readonly InlinePart[], count: number): readonly InlinePart[] {
  if (count <= 0) return [];
  const out: InlinePart[] = [];
  let used = 0;
  for (const part of parts) {
    const left = count - used;
    if (left <= 0) break;
    if (part.text.length <= left) { out.push(part); used += part.text.length; }
    else {
      // count 는 UTF-16 코드 유닛 기준 — 경계가 서로게이트 쌍을 쪼개면 상위 서로게이트만 남는다.
      let text = part.text.slice(0, left);
      const tail = text.charCodeAt(text.length - 1);
      if (tail >= 0xd800 && tail <= 0xdbff && text.length < part.text.length && part.text.charCodeAt(text.length) >= 0xdc00 && part.text.charCodeAt(text.length) <= 0xdfff) text = text.slice(0, -1);
      out.push({ ...part, text }); used += text.length;
    }
  }
  return out;
}
