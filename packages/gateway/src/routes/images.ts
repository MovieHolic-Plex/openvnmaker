import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { generateImage } from "../cca/images.js";
import { codexAvailable, codexGenerateImage, codexModelName } from "../codex/images.js";
import { readImage, saveImage, timestampName } from "../images/store.js";
import { GENERATE_PROMPT_MAX, IMAGE_ASPECT_RATIOS, IMAGE_MODEL, IMAGE_SIZES, imageBackend } from "../config.js";

interface GenerateBody {
  readonly prompt?: unknown;
  readonly backend?: unknown;
  readonly model?: unknown;
  readonly aspectRatio?: unknown;
  readonly imageSize?: unknown;
  readonly name?: unknown;
}

const ASPECTS = new Set<string>(IMAGE_ASPECT_RATIOS);
const SIZES = new Set<string>(IMAGE_SIZES);

export function imageRoutes({ store, codexImage }: GatewayDeps): Hono {
  const routes = new Hono();
  const runCodexImage = codexImage ?? codexGenerateImage;

  /**
   * agy 로 이미지를 뽑는다. 프롬프트만 필수다.
   * 응답에 base64 를 담지 않는다 — 파일로 저장하고 url 을 준다(수 MB 를 JSON 에 싣지 않는다).
   */
  routes.post("/image/generate", async (c) => {
    let body: GenerateBody;
    try {
      body = await c.req.json<GenerateBody>();
    } catch {
      return c.json({ error: "JSON 본문이 필요하다" }, 400);
    }

    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (prompt === "") return c.json({ error: "prompt 가 필요하다" }, 400);
    if (prompt.length > GENERATE_PROMPT_MAX) return c.json({ error: "prompt 가 너무 길다" }, 400);

    if (body.aspectRatio !== undefined && !ASPECTS.has(String(body.aspectRatio))) {
      return c.json({ error: `aspectRatio 는 ${IMAGE_ASPECT_RATIOS.join(", ")} 중 하나여야 한다` }, 400);
    }
    if (body.imageSize !== undefined && !SIZES.has(String(body.imageSize))) {
      return c.json({ error: `imageSize 는 ${IMAGE_SIZES.join(", ")} 중 하나여야 한다` }, 400);
    }

    const backend = body.backend === "agy" || body.backend === "codex" ? body.backend : imageBackend();
    if (backend === "codex") {
      // codex 는 자격증명을 자기가 들고 있다 — 게이트웨이 OAuth 를 요구하지 않는다.
      // model 은 `codex -m` 패스스루다. 셸이 아니라 argv 라 주입은 안 되지만
      // 이상한 id 가 로그와 모델 표시를 오염시키지 않게 토큰 형태만 받는다.
      const codexModel = typeof body.model === "string" && body.model !== "" ? body.model : undefined;
      if (codexModel !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(codexModel)) {
        return c.json({ error: "model 은 codex 모델 id 형태여야 한다" }, 400);
      }
      try {
        const result = await runCodexImage({
          prompt,
          ...(typeof body.aspectRatio === "string" ? { aspectRatio: body.aspectRatio } : {}),
          ...(typeof body.imageSize === "string" ? { imageSize: body.imageSize } : {}),
          ...(codexModel === undefined ? {} : { model: codexModel }),
          signal: c.req.raw.signal,
        });
        const baseName = typeof body.name === "string" && body.name !== "" ? body.name : timestampName();
        const saved = await Promise.all(
          result.images.map((image, index) =>
            saveImage(image.data, image.mimeType, result.images.length > 1 ? `${baseName}-${index + 1}` : baseName),
          ),
        );
        return c.json({
          backend: "codex",
          model: result.model,
          host: result.host,
          images: saved,
          ...(result.text.length > 0 ? { text: result.text.join(" ") } : {}),
          ...(result.usage === undefined ? {} : { usage: result.usage }),
          quotaShared: true,
          unofficial: false,
        });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
    }

    // 모델 패스스루를 열어두면 임의 모델 id 로 같은 쿼터 통을 소진할 수 있다.
    if (body.model !== undefined && body.model !== IMAGE_MODEL) {
      return c.json({ error: `model 은 ${IMAGE_MODEL} 만 된다` }, 400);
    }

    let access: string;
    let projectId: string;
    try {
      const fresh = await ensureFreshAccess(store);
      if (!fresh) return c.json({ error: "로그인이 필요하다" }, 401);
      access = fresh.credentials.access;
      projectId = fresh.credentials.projectId;
    } catch (err) {
      return c.json({ error: `토큰 갱신 실패: ${err instanceof Error ? err.message : String(err)}` }, 502);
    }
    // project 는 이 경로의 하드 요구다. 없으면 업스트림이 400 을 준다.
    if (!projectId) return c.json({ error: "자격증명에 projectId 가 없다. 다시 로그인해라" }, 409);

    try {
      const result = await generateImage(access, {
        prompt,
        projectId,
        ...(typeof body.model === "string" && body.model !== "" ? { model: body.model } : {}),
        ...(typeof body.aspectRatio === "string" ? { aspectRatio: body.aspectRatio } : {}),
        ...(typeof body.imageSize === "string" ? { imageSize: body.imageSize } : {}),
      });

      const baseName = typeof body.name === "string" && body.name !== "" ? body.name : timestampName();
      const saved = await Promise.all(
        result.images.map((image, index) =>
          saveImage(image.data, image.mimeType, result.images.length > 1 ? `${baseName}-${index + 1}` : baseName),
        ),
      );

      return c.json({
        model: result.model,
        host: result.host,
        images: saved,
        ...(result.text.length > 0 ? { text: result.text.join(" ") } : {}),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
        // 이 두 줄은 UI 가 지워도 되는 장식이 아니다. 사용자에게 보여야 한다.
        quotaShared: true,
        unofficial: true,
      });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  /** 기본 모델과 허용 비율. UI 가 하드코딩하지 않도록 게이트웨이가 알려준다. */
  routes.get("/image/config", async (c) => {
    // 두 백엔드를 모두 알려준다. UI 는 codex(로컬 ChatGPT)와 agy(Google/Gemini) 중 고를 수 있다.
    const [codexReady, codexModel] = await Promise.all([codexAvailable().catch(() => false), codexModelName().catch(() => "codex")]);
    const backends = [
      { id: "codex", model: codexModel, available: codexReady, authRequired: false, unofficial: false },
      { id: "agy", model: IMAGE_MODEL, available: true, authRequired: true, unofficial: true },
    ];
    const active = imageBackend();
    const primary = backends.find(b => b.id === active) ?? backends[0]!;
    return c.json({
      backend: active,
      model: primary.model,
      aspectRatios: IMAGE_ASPECT_RATIOS,
      imageSizes: IMAGE_SIZES,
      quotaShared: true,
      unofficial: primary.unofficial,
      authRequired: primary.authRequired,
      available: primary.available,
      backends,
    });
  });

  /** 저장된 이미지 서빙. 고정 디렉터리 안에서만 찾는다. */
  routes.get("/image/file/:name", async (c) => {
    // <img> 태그는 헤더를 못 달아 스튜디오 헤더로는 못 막는다 — 사이트 간 임베드만 거른다.
    // 이름이 타임스탬프라 추측 가능하니 외부 사이트에서 박는 것 자체를 차단한다.
    if (c.req.header("sec-fetch-site") === "cross-site") {
      return c.json({ error: "같은 컴퓨터의 편집기에서만 이미지를 열 수 있다" }, 403);
    }
    const file = await readImage(c.req.param("name"));
    if (!file) return c.json({ error: "없는 이미지다" }, 404);
    // Buffer 를 그대로 넘기면 Hono 의 Uint8Array<ArrayBuffer> 타입과 안 맞는다.
    return c.body(new Uint8Array(file.bytes), 200, { "Content-Type": file.mimeType, "Cache-Control": "no-store" });
  });

  return routes;
}
