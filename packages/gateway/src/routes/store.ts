/**
 * losia.online 에셋 스토어 프록시.
 *
 * 브라우저는 losia.online 을 직접 부를 수 없다(CORS). 로컬 게이트웨이가 서버사이드로 대신 부르고,
 * 결과만 같은 오리진(/api/*)으로 넘긴다. 앱의 기존 코드가 전부 같은 오리진을 보는 이유와 같다.
 *
 * 원본 배포 금지(embedded) 등급은 이 프록시에서 강제한다 — 클라이언트를 고쳐도 우회할 수 없다.
 * 계약: losia/docs/vnmaker-contract.md
 */
import { Hono } from "hono";
import type { GatewayDeps } from "../app.js";
import { LOSIA_FILE_MAX_BYTES, LOSIA_TAKE_MAX, LOSIA_TIMEOUT_MS, losiaBaseUrl } from "../config.js";

const KINDS = new Set(["stage", "character", "sound"]);
const SORTS = new Set(["new", "use", "name"]);
/** losia 자산 id 는 소문자/숫자 slug 다(st…, ch…, 그리고 `164e5130e5` 처럼 접두사 없는 것도 있다). 경로로 조립되므로 형식을 좁힌다. */
const ASSET_ID = /^[a-z0-9][a-z0-9-]{5,39}$/;
/** role 은 `expression:슬픔` 처럼 콜론과 한글을 포함한다. 경계만 본다. */
const ROLE = /^[\p{L}\p{N}_:~\-. ]{1,80}$/u;

interface LosiaFile { readonly role?: unknown; readonly url?: unknown; readonly mime?: unknown }
interface LosiaManifest { readonly license?: unknown; readonly files?: unknown }

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** 업스트림 실패는 전부 여기로 모은다. 스토어가 죽어도 게이트웨이는 살아 있어야 한다. */
function upstreamFailure(status: number): { status: 404 | 502; body: { error: string } } {
  if (status === 404) return { status: 404, body: { error: "스토어에서 자산을 찾지 못했습니다" } };
  return { status: 502, body: { error: "스토어에 연결하지 못했습니다. losia.online 상태를 확인하세요" } };
}

function requestSignal(signal: AbortSignal): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(LOSIA_TIMEOUT_MS)]);
}

export function storeRoutes({ losiaFetch }: GatewayDeps): Hono {
  const routes = new Hono();
  const upstream = losiaFetch ?? fetch;

  async function manifest(id: string, signal: AbortSignal): Promise<LosiaManifest | { readonly error: 404 | 502 }> {
    let response: Response;
    try {
      response = await upstream(`${losiaBaseUrl()}/api/assets/${id}/manifest`, { signal: requestSignal(signal), redirect: "error" });
    } catch {
      return { error: 502 };
    }
    if (!response.ok) return { error: response.status === 404 ? 404 : 502 };
    try {
      const body = (await response.json()) as unknown;
      if (!body || typeof body !== "object") return { error: 502 };
      return body as LosiaManifest;
    } catch {
      return { error: 502 };
    }
  }

  /** 카탈로그 검색. 허용한 파라미터만 업스트림으로 넘기고 take 는 상한을 둔다. */
  routes.get("/store/catalog", async (c) => {
    const query = c.req.query();
    const kind = query["kind"];
    if (kind !== undefined && kind !== "" && !KINDS.has(kind)) {
      return c.json({ error: "kind 는 stage, character, sound 중 하나여야 한다" }, 400);
    }
    const sort = query["sort"];
    if (sort !== undefined && sort !== "" && !SORTS.has(sort)) {
      return c.json({ error: "sort 는 new, use, name 중 하나여야 한다" }, 400);
    }
    const params = new URLSearchParams();
    if (kind) params.set("kind", kind);
    if (sort) params.set("sort", sort);
    for (const key of ["q", "tag", "tags", "shared"]) {
      const value = query[key];
      if (value !== undefined && value !== "") params.set(key, value.slice(0, 200));
    }
    params.set("take", String(clampInt(query["take"], 24, 1, LOSIA_TAKE_MAX)));
    params.set("skip", String(clampInt(query["skip"], 0, 0, 100_000)));

    let response: Response;
    try {
      response = await upstream(`${losiaBaseUrl()}/api/assets?${params.toString()}`, { signal: requestSignal(c.req.raw.signal), redirect: "error" });
    } catch {
      return c.json(upstreamFailure(502).body, 502);
    }
    if (!response.ok) {
      const failure = upstreamFailure(response.status);
      return c.json(failure.body, failure.status);
    }
    try {
      return c.json((await response.json()) as unknown);
    } catch {
      return c.json(upstreamFailure(502).body, 502);
    }
  });

  /** 매니페스트 원문. 앱이 files[].role 로 설치 계획을 세운다. */
  routes.get("/store/assets/:id/manifest", async (c) => {
    const id = c.req.param("id");
    if (!ASSET_ID.test(id)) return c.json({ error: "자산 id 형식이 올바르지 않습니다" }, 400);
    const body = await manifest(id, c.req.raw.signal);
    if ("error" in body) {
      const failure = upstreamFailure(body.error);
      return c.json(failure.body, failure.status);
    }
    return c.json(body);
  });

  /**
   * 원본 파일 중계. 설치가 실제로 쓰는 경로다.
   * embedded 는 원본을 배포하지 않으므로 여기서 거부한다(계약 §라이선스).
   */
  routes.get("/store/assets/:id/files/:role", async (c) => {
    const id = c.req.param("id");
    if (!ASSET_ID.test(id)) return c.json({ error: "자산 id 형식이 올바르지 않습니다" }, 400);
    let role: string;
    try {
      role = decodeURIComponent(c.req.param("role"));
    } catch {
      return c.json({ error: "역할 이름을 해석하지 못했습니다" }, 400);
    }
    if (!ROLE.test(role)) return c.json({ error: "역할 이름 형식이 올바르지 않습니다" }, 400);

    const body = await manifest(id, c.req.raw.signal);
    if ("error" in body) {
      const failure = upstreamFailure(body.error);
      return c.json(failure.body, failure.status);
    }
    if (body.license === "embedded") {
      return c.json({ error: "embedded 등급은 원본 파일을 배포하지 않습니다. 미리보기만 볼 수 있습니다" }, 403);
    }
    const files = Array.isArray(body.files) ? (body.files as LosiaFile[]) : [];
    const file = files.find(row => row && typeof row === "object" && row.role === role);
    if (!file) return c.json({ error: "매니페스트에 없는 역할입니다" }, 404);
    if (typeof file.url !== "string" || file.url === "") {
      return c.json({ error: "이 등급은 원본 파일 주소를 제공하지 않습니다" }, 403);
    }
    let target: URL;
    try {
      target = new URL(file.url);
    } catch {
      return c.json({ error: "파일 주소가 올바르지 않습니다" }, 502);
    }
    // 매니페스트가 임의 호스트를 가리키면 로컬 게이트웨이가 그대로 프록시가 된다 — 스토어 오리진만 허용한다.
    if (target.origin !== new URL(losiaBaseUrl()).origin) {
      return c.json({ error: "스토어 밖의 파일 주소는 받아오지 않습니다" }, 502);
    }
    let response: Response;
    try {
      response = await upstream(target.href, { signal: requestSignal(c.req.raw.signal), redirect: "error" });
    } catch {
      return c.json(upstreamFailure(502).body, 502);
    }
    if (!response.ok) {
      const failure = upstreamFailure(response.status);
      return c.json(failure.body, failure.status);
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > LOSIA_FILE_MAX_BYTES) {
      return c.json({ error: "파일이 너무 큽니다" }, 413);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > LOSIA_FILE_MAX_BYTES) {
      return c.json({ error: "파일이 너무 큽니다" }, 413);
    }
    const mime = response.headers.get("content-type") ?? (typeof file.mime === "string" ? file.mime : "application/octet-stream");
    return new Response(bytes, { headers: { "content-type": mime, "content-length": String(bytes.byteLength), "cache-control": "no-store" } });
  });

  return routes;
}
