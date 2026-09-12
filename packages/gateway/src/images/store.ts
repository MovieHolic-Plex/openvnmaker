/**
 * 생성된 이미지 저장소. 고정 디렉터리 하나만 쓴다(기본 ~/.vnmaker/images).
 * 요청이 경로를 정하게 하지 않는다 — 이 프로세스는 토큰을 들고 있으므로
 * 임의 경로 쓰기를 열어주면 안 된다.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.js";
import { IMAGE_DIR } from "../config.js";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/**
 * 파일명을 한 조각으로 좁힌다. 구분자와 상위 참조는 살아남지 못한다.
 * 한글은 남긴다(에셋 이름을 한국어로 쓰는 게 이 프로젝트의 기본이다).
 * 빈 문자열이 되면 호출자가 기본 이름을 쓴다.
 */
export function sanitizeName(raw: string): string {
  const leaf = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = leaf
    // 제어문자와 Windows 금지 문자를 없애고 공백은 하이픈으로
    .replace(/[\u0000-\u001f<>:"|?*]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, 80);
  // Windows 예약명(con/nul/aux/…)은 확장자가 붙어도 못 쓴다 — 쓰기가 조용히 실패한다.
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? "" : clean;
}

/** 사용자가 준 이름에 확장자가 이미 있으면 겹쳐 붙이지 않는다. */
function stripKnownExtension(name: string): string {
  return name.replace(/\.(png|jpe?g|webp)$/i, "");
}

export function timestampName(prefix = "img"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}-${stamp}`;
}

export interface SavedImage {
  readonly name: string;
  readonly path: string;
  readonly url: string;
  readonly mimeType: string;
  readonly bytes: number;
}

export async function saveImage(base64: string, mimeType: string, baseName: string): Promise<SavedImage> {
  const buffer = Buffer.from(base64, "base64");
  const name = `${stripKnownExtension(sanitizeName(baseName)) || timestampName()}.${extensionFor(mimeType)}`;
  const path = join(IMAGE_DIR, name);
  await writeFileAtomic(path, buffer);
  return { name, path, url: `/api/image/file/${encodeURIComponent(name)}`, mimeType, bytes: buffer.byteLength };
}

const SERVED_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** 저장된 파일 읽기. 이름을 좁힌 뒤 고정 디렉터리에서만 찾는다. */
export async function readImage(rawName: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const name = sanitizeName(rawName);
  if (!name) return null;
  try {
    const bytes = await readFile(join(IMAGE_DIR, name));
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    // 모르는 확장자를 image/png 로 거짓 서빙하지 않는다.
    return { bytes, mimeType: SERVED_TYPES[ext] ?? "application/octet-stream" };
  } catch {
    return null;
  }
}
