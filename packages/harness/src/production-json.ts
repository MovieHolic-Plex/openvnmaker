export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("올바른 JSON 객체가 필요합니다.");
  return value;
}

export function requiredText(value: unknown, label: string, max = 3000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label}을 확인하세요. (1–${max}자)`);
  }
  return value.trim();
}

export function parseJsonBlob(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    return parsed;
  } catch {
    throw new Error("AI가 유효한 JSON을 반환하지 않았습니다. 기존 집필 내용은 보존했습니다.");
  }
}
