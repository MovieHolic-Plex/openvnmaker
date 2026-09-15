/**
 * openvnmaker 저장소 에셋 소스.
 *
 * 잡는 결함:
 * - 카탈로그가 깨졌거나 버전이 다를 때 조용히 빈 목록을 보여 주면, 사용자는 '자산이 없다'고 읽는다.
 * - 경로가 그대로 주소로 조립된다. `..` 이나 절대 경로를 받으면 저장소 밖을 부르게 된다.
 * - 앱이 에셋을 함께 서빙하는데도 CDN 을 먼저 부르면, 오프라인에서 못 쓰고 e2e 가 네트워크에 묶인다.
 * - 같은 오리진에 없을 때(에셋을 뺀 빌드·포크) 받침 주소로 넘어가지 못하면 스토어 전체가 멈춘다.
 * - 목록 실패를 캐시에 남기면 '다시 시도'가 영원히 같은 실패를 돌려준다.
 * - 설치 규칙은 losia 와 같은 형식을 쓴다 — 매니페스트가 그 형식을 벗어나면 설치가 깨진다.
 */
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { fetchRepoManifest, resetRepoCatalog, searchRepoAssets } from "../src/api/repoStore.js";

const CATALOG = {
  spec: "openvnmaker-catalog/1",
  items: [
    { id: "cast-seorin", kind: "character", name: "한서린", tags: ["인물"], license: "downloadable", thumb: "catalog/thumbs/cast-seorin.webp", files: [{ role: "expression:neutral", path: "assets/art/seorin-neutral.png", mime: "image/png" }] },
    { id: "stage-rain", kind: "stage", name: "비가 머문 유리별관", tags: ["배경"], license: "downloadable", files: [{ role: "base", path: "assets/art/nocturne-atrium.png", mime: "image/png" }] },
    { id: "sound-rain", kind: "sound", name: "비 내리는 날", tags: ["배경음"], license: "downloadable", files: [{ role: "audio", path: "assets/audio/bgm/rain.mp3", mime: "audio/mpeg" }] },
  ],
};

/** fetch 를 갈아끼운다. 실제 네트워크를 타면 테스트가 GitHub 상태에 묶인다. */
function stubFetch(handler: (url: string) => Response | Promise<Response>): string[] {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    return await handler(url);
  }) as typeof fetch;
  return seen;
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => { resetRepoCatalog(); });

test("카탈로그를 받아 종류로 거르고 전체 개수를 함께 돌려준다", async () => {
  stubFetch(() => ok(CATALOG));
  const all = await searchRepoAssets({});
  assert.equal(all.total, 3);
  const stages = await searchRepoAssets({ kind: "stage" });
  assert.equal(stages.total, 1);
  assert.equal(stages.items[0]?.name, "비가 머문 유리별관");
});

test("이름과 태그로 검색한다", async () => {
  stubFetch(() => ok(CATALOG));
  assert.equal((await searchRepoAssets({ q: "유리" })).total, 1);
  assert.equal((await searchRepoAssets({ q: "배경음" })).total, 1, "태그도 검색 대상이다");
  assert.equal((await searchRepoAssets({ q: "없는말" })).total, 0);
});

test("에셋을 함께 서빙하는 앱에서는 같은 오리진만 부른다", async () => {
  const seen = stubFetch(() => ok(CATALOG));
  const found = await searchRepoAssets({ kind: "character" });
  assert.deepEqual(seen, ["/catalog/assets.json"], "CDN 을 먼저 부르면 오프라인에서 못 쓴다");
  assert.equal(found.items[0]?.thumb, "/catalog/thumbs/cast-seorin.webp");
  const manifest = await fetchRepoManifest("cast-seorin");
  assert.equal(manifest.spec, "losia-asset/1", "설치 규칙은 losia 형식을 그대로 쓴다");
  assert.equal(manifest.files[0]?.url, "/assets/art/seorin-neutral.png");
});

test("저장소 밖을 가리키는 경로는 버린다", async () => {
  stubFetch(() => ok({
    spec: "openvnmaker-catalog/1",
    items: [
      { id: "escape", kind: "stage", name: "탈출", files: [{ role: "base", path: "../../etc/passwd" }] },
      { id: "absolute", kind: "stage", name: "절대", files: [{ role: "base", path: "/etc/passwd" }] },
      { id: "fine", kind: "stage", name: "정상", files: [{ role: "base", path: "assets/bg/title.png" }] },
    ],
  }));
  const found = await searchRepoAssets({});
  assert.deepEqual(found.items.map(item => item.id), ["fine"]);
});

test("버전이 다른 목록은 빈 목록이 아니라 오류로 알린다", async () => {
  stubFetch(() => ok({ spec: "openvnmaker-catalog/99", items: [] }));
  await assert.rejects(searchRepoAssets({}), /지원하지 않는 에셋 목록 버전/);
});

test("같은 오리진에 없으면 CDN 으로, 그것도 죽으면 raw 로 넘어간다", async () => {
  const seen = stubFetch(url => url.startsWith("/") || url.includes("jsdelivr") ? new Response("nope", { status: 404 }) : ok(CATALOG));
  const found = await searchRepoAssets({});
  assert.equal(found.total, 3);
  assert.deepEqual(seen.map(url => url.startsWith("/") ? "self" : new URL(url).host), ["self", "cdn.jsdelivr.net", "raw.githubusercontent.com"]);
  // 받침 주소를 쓸 때는 파일도 그 주소에서 받아야 한다.
  const manifest = await fetchRepoManifest("stage-rain");
  assert.match(manifest.files[0]?.url ?? "", /^https:\/\/raw\.githubusercontent\.com\/.*packages\/app\/public\/assets\/art\//);
});

test("모든 주소가 실패하면 캐시에 남기지 않아 다시 시도가 가능하다", async () => {
  stubFetch(() => new Response("down", { status: 500 }));
  await assert.rejects(searchRepoAssets({}), /에셋 목록을 받지 못했습니다/);
  stubFetch(() => ok(CATALOG));
  assert.equal((await searchRepoAssets({})).total, 3, "실패가 캐시되면 여기서 같은 오류가 다시 난다");
});

test("없는 자산은 매니페스트를 만들지 않는다", async () => {
  stubFetch(() => ok(CATALOG));
  await assert.rejects(fetchRepoManifest("없음"), /찾지 못했습니다/);
});
