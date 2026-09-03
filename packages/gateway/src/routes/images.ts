import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { ensureFreshAccess } from "../auth/tokens.js";
import { generateImage } from "../cca/images.js";
import { readImage, saveImage, timestampName } from "../images/store.js";
import { IMAGE_ASPECT_RATIOS, IMAGE_MODEL } from "../config.js";

interface GenerateBody {
  readonly prompt?: unknown;
  readonly model?: unknown;
  readonly aspectRatio?: unknown;
  readonly imageSize?: unknown;
  readonly name?: unknown;
}

const ASPECTS = new Set<string>(IMAGE_ASPECT_RATIOS);

export function imageRoutes({ store }: GatewayDeps): Hono {
  const routes = new Hono();

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

    if (body.aspectRatio !== undefined && !ASPECTS.has(String(body.aspectRatio))) {
      return c.json({ error: `aspectRatio 는 ${IMAGE_ASPECT_RATIOS.join(", ")} 중 하나여야 한다` }, 400);
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
  routes.get("/image/config", (c) =>
    c.json({ model: IMAGE_MODEL, aspectRatios: IMAGE_ASPECT_RATIOS, quotaShared: true, unofficial: true }),
  );

  /** 저장된 이미지 서빙. 고정 디렉터리 안에서만 찾는다. */
  routes.get("/image/file/:name", async (c) => {
    const file = await readImage(c.req.param("name"));
    if (!file) return c.json({ error: "없는 이미지다" }, 404);
    // Buffer 를 그대로 넘기면 Hono 의 Uint8Array<ArrayBuffer> 타입과 안 맞는다.
    return c.body(new Uint8Array(file.bytes), 200, { "Content-Type": file.mimeType, "Cache-Control": "no-store" });
  });

  return routes;
}
