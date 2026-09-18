/**
 * losia 게시 클라이언트.
 *
 * 잡는 결함:
 * - 게이트웨이가 없으면 status 가 무한 대기하거나 멈춰선 안 된다 → unreachable 로 떨어진다.
 * - losia 에 호스팅된 스튜디오(/make)에서는 프록시가 없다 — 같은 오리진 /api/works 를 써야
 *   게시가 된다. 프록시만 기다리면 호스팅 스튜디오에서 게시 버튼이 영원히 죽는다.
 * - 업로드 경로가 섞이면 로컬에서는 토큰 없이 직통을 치고(401), 호스팅에서는 없는 프록시를 친다.
 * - 서버가 slug/playUrl 을 빼먹은 응답을 주면 링크 없는 성공처럼 보이면 안 된다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchLosiaStatus, publishLosiaAsset, publishLosiaWork } from "../src/api/losia.js";

interface Seen { readonly url: string; readonly method: string; readonly hasStudioHeader: boolean; readonly form: FormData | null }

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    seen.push({
      url,
      method: init?.method ?? "GET",
      hasStudioHeader: headers.has("x-vnmaker-studio"),
      form: init?.body instanceof FormData ? init.body : null,
    });
    return await handler(url, init);
  }) as typeof fetch;
  return seen;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("로컬 스튜디오: 게이트웨이 프록시 상태를 읽는다", async () => {
  const seen = stubFetch(url => url === "/api/losia/status" ? ok({ configured: true, baseUrl: "https://losia.test" }) : new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.deepEqual(status, { reachable: true, configured: true, direct: false, baseUrl: "https://losia.test", signIn: "/login" });
  assert.deepEqual(seen.map(s => s.url), ["/api/losia/status"]);
});

test("호스팅 스튜디오: 능력 기술서의 host:losia 가 세션 로그인 직통 모드다", async () => {
  const seen = stubFetch(url =>
    url === "/.well-known/openvnmaker.json" ? ok({ spec: "openvnmaker-host/1", host: "losia", gateway: true, auth: { authenticated: true, signIn: "/login" } })
      : new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.deepEqual(status, { reachable: true, configured: true, direct: true, baseUrl: "", signIn: "/login" });
  assert.deepEqual(seen.map(s => s.url), ["/api/losia/status", "/.well-known/openvnmaker.json"]);
});

test("능력 기술서에 host 식별자가 없으면 직통을 추정하지 않고 엔드포인트를 실측한다", async () => {
  // gateway:false 문서만으로는 losia 인지 알 수 없다 — 예전에는 이걸 직통으로 보고
  // /api/works 없는 정적 호스트에서도 direct:true 를 선언해 게시가 조용히 실패했다.
  const seen = stubFetch(url =>
    url === "/.well-known/openvnmaker.json" ? ok({ spec: "openvnmaker-host/1", gateway: false, auth: { authenticated: true } })
      : new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.equal(status.direct, false);
  assert.deepEqual(seen.map(s => s.url), ["/api/losia/status", "/.well-known/openvnmaker.json", "/api/works?take=1"]);
});

test("능력 기술서 조회가 실패하면 직통을 추정하지 않고 닫는다", async () => {
  const seen = stubFetch(url => {
    if (url === "/api/losia/status") return new Response("nf", { status: 404 });
    if (url === "/.well-known/openvnmaker.json") throw new Error("network down");
    return ok({ items: [], total: 0 });
  });
  const status = await fetchLosiaStatus();
  assert.equal(status.reachable, false);
  assert.equal(status.direct, false);
  assert.ok(!seen.some(s => s.url === "/api/works?take=1"), "조회 실패 시 스니핑으로 넘어가면 안 된다");
});

test("호스팅 스튜디오(구형): 기술서가 없으면 /api/works 와 세션으로 직통 모드를 추정한다", async () => {
  const seen = stubFetch(url =>
    url === "/api/works?take=1" ? ok({ items: [], total: 0 })
      : url === "/api/auth/session" ? ok({ user: { handle: "qa" } })
      : new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.deepEqual(status, { reachable: true, configured: true, direct: true, baseUrl: "", signIn: "/login" });
  assert.deepEqual(seen.map(s => s.url), ["/api/losia/status", "/.well-known/openvnmaker.json", "/api/works?take=1", "/api/auth/session"]);
});

test("호스팅 스튜디오: 미로그인 세션이면 configured=false 다", async () => {
  stubFetch(url =>
    url === "/api/works?take=1" ? ok({ items: [], total: 0 })
      : url === "/api/auth/session" ? ok({})
      : new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.equal(status.direct, true);
  assert.equal(status.configured, false);
});

test("정적 호스팅: 프록시도 losia 도 없으면 unreachable 이다", async () => {
  stubFetch(() => new Response("nf", { status: 404 }));
  const status = await fetchLosiaStatus();
  assert.equal(status.reachable, false);
  assert.equal(status.configured, false);
});

test("게이트웨이가 아예 꺼져 있으면 unreachable 이다", async () => {
  stubFetch(() => { throw new Error("ECONNREFUSED"); });
  const status = await fetchLosiaStatus();
  assert.equal(status.reachable, false);
});

test("작품 게시는 프록시 경로에 편집기 헤더와 필드를 함께 올린다", async () => {
  const seen = stubFetch(() => ok({ ok: true, slug: "rainy", playUrl: "/play/rainy" }));
  const result = await publishLosiaWork(new Blob(["zip"]), "rainy-play.zip", { slug: "rainy", title: "비 오는 날", description: "소개" });
  assert.equal(result.slug, "rainy");
  assert.equal(seen[0]!.url, "/api/losia/works");
  assert.equal(seen[0]!.method, "POST");
  assert.equal(seen[0]!.hasStudioHeader, true, "프록시 경로는 CSRF 헤더가 필요하다");
  assert.equal(seen[0]!.form?.get("slug"), "rainy");
  assert.equal(seen[0]!.form?.get("title"), "비 오는 날");
  assert.equal(seen[0]!.form?.get("description"), "소개");
  assert.ok(seen[0]!.form?.get("file") instanceof Blob);
});

test("직통 모드는 같은 오리진 /api/works 로 올리고 빈 필드는 생략한다", async () => {
  const seen = stubFetch(() => ok({ ok: true, slug: "auto", playUrl: "/play/auto" }));
  await publishLosiaWork(new Blob(["zip"]), "auto-play.zip", { title: "제목" }, { direct: true });
  assert.equal(seen[0]!.url, "/api/works");
  assert.equal(seen[0]!.hasStudioHeader, false, "직통은 세션 쿠키로 인증한다");
  assert.equal(seen[0]!.form?.get("slug"), null);
  assert.equal(seen[0]!.form?.get("description"), null);
});

test("직통 모드의 401 은 로그인 안내로 바꾼다", async () => {
  stubFetch(() => Response.json({ error: "로그인이 필요합니다" }, { status: 401 }));
  await assert.rejects(() => publishLosiaWork(new Blob(["z"]), "x.zip", {}, { direct: true }), /로그인/);
});

test("업로드 오류는 서버 메시지를 보존한다", async () => {
  stubFetch(() => Response.json({ error: "slug가 이미 사용 중입니다" }, { status: 409 }));
  await assert.rejects(() => publishLosiaWork(new Blob(["z"]), "x.zip", {}), /slug가 이미 사용 중/);
});

test("slug·playUrl 없는 성공 응답은 실패로 본다", async () => {
  stubFetch(() => ok({ ok: true }));
  await assert.rejects(() => publishLosiaWork(new Blob(["z"]), "x.zip", {}), /응답/);
});

test("에셋 게시는 meta·roles·files 를 files 순서에 맞춰 올린다", async () => {
  const seen = stubFetch(() => Response.json({ ok: true, id: "st12345678" }, { status: 201 }));
  const files = [
    { role: "base", blob: new Blob(["png1"], { type: "image/png" }), filename: "base.png" },
    { role: "expression:미소", blob: new Blob(["png2"], { type: "image/png" }), filename: "expression-미소.png" },
  ];
  const result = await publishLosiaAsset(
    { kind: "character", name: "테스트 인물", tags: ["qa"], license: "downloadable", generator: "uploaded", nsfw: false, existingIp: false, realPerson: false },
    files,
  );
  assert.equal(result.id, "st12345678");
  assert.equal(seen[0]!.url, "/api/losia/assets");
  assert.equal(seen[0]!.hasStudioHeader, true);
  const form = seen[0]!.form!;
  const meta = JSON.parse(String(form.get("meta"))) as { kind: string; name: string };
  assert.equal(meta.kind, "character");
  assert.equal(meta.name, "테스트 인물");
  assert.deepEqual(JSON.parse(String(form.get("roles"))), ["base", "expression:미소"]);
  assert.equal(form.getAll("files").length, 2);
});

test("에셋 게시 직통 모드는 같은 오리진 /api/assets 를 친다", async () => {
  const seen = stubFetch(() => Response.json({ ok: true, id: "st87654321" }, { status: 201 }));
  await publishLosiaAsset(
    { kind: "sound", name: "음원", tags: [], license: "attribution", generator: "uploaded", nsfw: false, existingIp: false, realPerson: false },
    [{ role: "audio", blob: new Blob(["mp3"], { type: "audio/mpeg" }), filename: "audio.mp3" }],
    { direct: true },
  );
  assert.equal(seen[0]!.url, "/api/assets");
  assert.equal(seen[0]!.hasStudioHeader, false);
});

test("에셋 게시 직통 401 은 로그인 안내로, 프록시 오류는 서버 메시지를 보존한다", async () => {
  stubFetch(() => Response.json({ error: "unauthorized" }, { status: 401 }));
  const meta = { kind: "stage" as const, name: "x", tags: [], license: "downloadable" as const, generator: "uploaded", nsfw: false, existingIp: false, realPerson: false };
  const file = [{ role: "base", blob: new Blob(["p"]), filename: "base.png" }];
  await assert.rejects(() => publishLosiaAsset(meta, file, { direct: true }), /로그인/);
  await assert.rejects(() => publishLosiaAsset(meta, file), /unauthorized/);
});
