/**
 * losia.online 게시 프록시 — 작품 ZIP(POST /api/works)과 에셋(POST /api/assets).
 *
 * 왜 게이트웨이를 거치나: 브라우저가 losia 를 직접 부르면 CORS 에 막히고,
 * 개인 토큰(la_…)을 프런트 코드가 들고 있으면 스크립트에 새어나간다. 게이트웨이가
 * 토큰을 로컬 파일(0600)에 보관하고 업로드에 Bearer 를 붙여 중계한다.
 *
 * 업로드는 버퍼링 없이 스트리밍한다 — 수백 MB ZIP 을 메모리에 두 번 올리지 않는다.
 * 계약: losia/docs/openvnmaker-contract.md
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { GatewayDeps } from "../app.js";
import {
  LOSIA_TIMEOUT_MS,
  LOSIA_UPLOAD_TIMEOUT_MS,
  losiaAssetMaxBytes,
  losiaBaseUrl,
  losiaWorkMaxBytes,
} from "../config.js";
import { createFileLosiaTokenStore, LOSIA_TOKEN_PATTERN } from "../auth/losiaToken.js";

const MULTIPART = "multipart/form-data";

function uploadSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(LOSIA_UPLOAD_TIMEOUT_MS)]);
}

/**
 * 토큰 검증: /api/works 는 인증(401)을 본문 형식(400)보다 먼저 본다.
 * multipart 가 아닌 빈 POST 는 부수효과 없이 "토큰이 살아 있는가" 만 답한다.
 */
async function verifyToken(
  upstream: typeof fetch,
  token: string,
  signal: AbortSignal,
): Promise<"ok" | "invalid" | "unreachable"> {
  try {
    const response = await upstream(`${losiaBaseUrl()}/api/works`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: "",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(LOSIA_TIMEOUT_MS)]),
    });
    await response.arrayBuffer().catch(() => undefined);
    if (response.status === 401 || response.status === 403) return "invalid";
    if (response.status === 400 || response.status === 413 || response.status === 415) return "ok";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export function losiaRoutes({ losiaFetch, losiaTokens }: GatewayDeps): Hono {
  const routes = new Hono();
  const upstream = losiaFetch ?? fetch;
  const tokens = losiaTokens ?? createFileLosiaTokenStore();

  routes.get("/losia/status", async (c) => {
    const token = await tokens.read();
    return c.json({ configured: token !== null, baseUrl: losiaBaseUrl() });
  });

  routes.put("/losia/token", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "JSON 본문이 필요합니다" }, 400);
    }
    const token = typeof body === "object" && body !== null ? (body as { token?: unknown })["token"] : undefined;
    if (typeof token !== "string" || !LOSIA_TOKEN_PATTERN.test(token)) {
      return c.json({ error: "토큰 형식이 올바르지 않습니다. la_ 로 시작하는 개인 토큰을 붙여 넣으세요" }, 400);
    }
    const check = await verifyToken(upstream, token, c.req.raw.signal);
    if (check === "invalid") return c.json({ error: "losia 가 토큰을 받아들이지 않았습니다. 폐기되지 않은 토큰인지 확인하세요" }, 401);
    if (check === "unreachable") return c.json({ error: "스토어에 연결하지 못했습니다. losia.online 상태를 확인하세요" }, 502);
    await tokens.write(token);
    return c.json({ ok: true });
  });

  routes.delete("/losia/token", async (c) => {
    await tokens.clear();
    return c.json({ ok: true });
  });

  /**
   * multipart 본문을 있는 그대로 losia 에 중계한다. 들어온 바이트를 세어 상한을 넘으면 끊는다 —
   * content-length 가 없는 chunked 업로드도 프록시가 무한정 흘리지 않는다.
   */
  async function forwardUpload(c: Context, path: string, maxBytes: number): Promise<Response> {
    const token = await tokens.read();
    if (!token) return c.json({ error: "losia 토큰이 없습니다. 먼저 토큰을 등록하세요" }, 401);
    const contentType = c.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith(MULTIPART)) {
      return c.json({ error: "multipart/form-data 만 받습니다" }, 400);
    }
    const raw = c.req.raw.body;
    if (!raw) return c.json({ error: "업로드 본문이 없습니다" }, 400);
    const declared = Number(c.req.header("content-length") ?? "0") || 0;
    if (declared > maxBytes) return c.json({ error: "업로드가 너무 큽니다" }, 413);

    let exceeded = false;
    let size = 0;
    const counted = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = raw.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
              exceeded = true;
              controller.error(new Error("losia upload exceeded limit"));
              return;
            }
            controller.enqueue(value);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": contentType };
    if (declared > 0) headers["content-length"] = String(declared);
    let response: Response;
    try {
      response = await upstream(`${losiaBaseUrl()}${path}`, {
        method: "POST",
        headers,
        body: counted,
        redirect: "error",
        signal: uploadSignal(c.req.raw.signal),
        // Node fetch(undici)는 스트림 본문에 duplex 지정이 필요하다. 표준 타입에는 아직 없다.
        duplex: "half",
      } as RequestInit);
    } catch {
      if (exceeded) return c.json({ error: "업로드가 너무 큽니다" }, 413);
      return c.json({ error: "스토어에 올리지 못했습니다. losia.online 상태를 확인하세요" }, 502);
    }
    const text = await response.text();
    try {
      return c.json(JSON.parse(text) as unknown, response.status as 200);
    } catch {
      return new Response(text, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "text/plain" } });
    }
  }

  routes.post("/losia/works", c => forwardUpload(c, "/api/works", losiaWorkMaxBytes()));
  routes.post("/losia/assets", c => forwardUpload(c, "/api/assets", losiaAssetMaxBytes()));

  return routes;
}
