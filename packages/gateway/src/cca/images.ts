/**
 * agy(Antigravity) 이미지 생성. 텍스트와 같은 v1internal:streamGenerateContent 를 쓰고
 * generationConfig.responseModalities:["IMAGE"] 로 이미지를 받는다. project 는 필수다.
 *
 * 참조: _vendor/oh-my-pi packages/coding-agent/src/tools/image-gen.ts
 *       (buildAntigravityRequest / parseAntigravitySseForImage). 봉투를 임의로 바꾸지 마라.
 */
import { CCA_HOSTS, IMAGE_MODEL, IMAGE_TIMEOUT_MS, ccaHeaders } from "../config.js";
import { UpstreamError } from "../http.js";

const SYSTEM_INSTRUCTION =
  "You are an AI image generator. Generate images based on user descriptions. " +
  "Focus on creating high-quality, visually appealing images that match the user's request.";

/** 참조 구현과 같은 임계값. 여기를 느슨하게 하지 않는다. */
const SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
  { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_ONLY_HIGH" },
] as const;

export interface ImageRequestParams {
  readonly prompt: string;
  readonly projectId: string;
  readonly model?: string;
  readonly aspectRatio?: string;
  readonly imageSize?: string;
  readonly requestId?: string;
  readonly references?: readonly InlineImage[];
}

export interface InlineImage {
  readonly mimeType: string;
  /** base64. 게이트웨이 밖으로 나갈 때는 파일로 저장하고 URL 만 준다. */
  readonly data: string;
}

export interface ImageResult {
  readonly images: InlineImage[];
  readonly text: string[];
  readonly usage?: Record<string, unknown>;
  readonly host: string;
  readonly model: string;
}

interface ResponseChunk {
  readonly response?: {
    readonly candidates?: readonly {
      readonly content?: { readonly parts?: readonly { readonly text?: string; readonly inlineData?: { readonly mimeType?: string; readonly data?: string } }[] };
      readonly finishReason?: string;
    }[];
    readonly usageMetadata?: Record<string, unknown>;
    readonly promptFeedback?: { readonly blockReason?: string };
  };
}

/** 순수 함수. 네트워크 없이 봉투를 검증할 수 있다. */
export function buildImageRequest(params: ImageRequestParams): Record<string, unknown> {
  const model = params.model ?? IMAGE_MODEL;
  const imageConfig =
    params.aspectRatio || params.imageSize
      ? {
          ...(params.aspectRatio === undefined ? {} : { aspectRatio: params.aspectRatio }),
          ...(params.imageSize === undefined ? {} : { imageSize: params.imageSize }),
        }
      : undefined;

  const parts = [
    { text: params.prompt },
    ...(params.references ?? []).map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.data },
    })),
  ];

  return {
    project: params.projectId,
    model,
    request: {
      contents: [{ role: "user", parts }],
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      generationConfig: {
        responseModalities: ["IMAGE"],
        ...(imageConfig === undefined ? {} : { imageConfig }),
        candidateCount: 1,
      },
      safetySettings: SAFETY_SETTINGS,
    },
    requestType: "agent",
    requestId: params.requestId ?? `vnmaker-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    userAgent: "antigravity",
  };
}

/** 1x1 PNG generated in-process. Not a repo asset and not fetched. */
export function generateTinyPng(): Uint8Array {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
}

/**
 * SSE 본문 하나를 청크 배열로 만든다. data: 여러 줄은 SSE 규격대로 \n 으로 잇고
 * [DONE] 에서 멈춘다. 파싱 불가한 조각은 버린다 — 스트림 끝이 잘려 오는 일이 있다.
 */
export function parseSseChunks(body: string): ResponseChunk[] {
  const chunks: ResponseChunk[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "") continue;
    if (data === "[DONE]") break;
    try {
      chunks.push(JSON.parse(data) as ResponseChunk);
    } catch {
      // 잘린 마지막 이벤트는 무시한다.
    }
  }
  return chunks;
}

/** 청크에서 이미지와 텍스트를 걷어낸다. 순수 함수. */
export function collectImages(chunks: readonly ResponseChunk[]): {
  images: InlineImage[];
  text: string[];
  usage?: Record<string, unknown>;
  blockReason?: string;
} {
  const images: InlineImage[] = [];
  const text: string[] = [];
  let usage: Record<string, unknown> | undefined;
  let blockReason: string | undefined;

  for (const chunk of chunks) {
    const response = chunk.response;
    if (!response) continue;
    if (response.promptFeedback?.blockReason) blockReason = response.promptFeedback.blockReason;
    for (const candidate of response.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        if (part.text) text.push(part.text);
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType) images.push({ mimeType: inline.mimeType, data: inline.data });
      }
    }
    if (response.usageMetadata) usage = response.usageMetadata;
  }

  return { images, text, ...(usage === undefined ? {} : { usage }), ...(blockReason === undefined ? {} : { blockReason }) };
}

async function postImage(host: string, accessToken: string, body: unknown, signal: AbortSignal): Promise<string> {
  const res = await fetch(`${host}/v1internal:streamGenerateContent?alt=sse`, {
    method: "POST",
    headers: { ...ccaHeaders(accessToken), Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text.slice(0, 1200);
    try {
      message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
    } catch {
      // 원문 유지
    }
    throw new UpstreamError(`이미지 생성 실패: ${res.status} ${res.statusText} — ${message}`, res.status, text.slice(0, 1200));
  }
  return text;
}

/**
 * 이미지 한 장 요청. 1차 호스트가 5xx/429 면 sandbox 호스트로 한 번 물러난다.
 * 성공해도 이미지가 0장일 수 있다(안전 필터). 그 경우 텍스트와 blockReason 을 올린다.
 */
export async function generateImage(accessToken: string, params: ImageRequestParams): Promise<ImageResult> {
  const model = params.model ?? IMAGE_MODEL;
  const body = buildImageRequest({ ...params, model });
  let lastError: unknown;

  for (const [index, host] of CCA_HOSTS.entries()) {
    const isLast = index === CCA_HOSTS.length - 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const raw = await postImage(host, accessToken, body, controller.signal);
      const parsed = collectImages(parseSseChunks(raw));
      if (parsed.images.length === 0) {
        const detail = [parsed.blockReason ? `blockReason ${parsed.blockReason}` : null, ...parsed.text].filter(Boolean).join(" ");
        throw new UpstreamError(
          `이미지가 안 왔다${detail ? `: ${detail}` : ". 프롬프트가 필터에 막혔을 수 있다"}`,
          502,
          detail,
        );
      }
      return { images: parsed.images, text: parsed.text, ...(parsed.usage === undefined ? {} : { usage: parsed.usage }), host, model };
    } catch (err) {
      lastError = err;
      const retryable =
        !isLast &&
        ((err instanceof UpstreamError && (err.status === 429 || err.status >= 500)) ||
          (err instanceof Error && err.name === "AbortError"));
      if (!retryable) throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("이미지 생성 실패");
}
