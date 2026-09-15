#!/usr/bin/env node
/**
 * openvnmaker 에셋 카탈로그 생성기.
 *
 *   node tools/asset-catalog/build.mjs
 *
 * 저장소가 공개라 raw.githubusercontent 와 jsDelivr 모두 `Access-Control-Allow-Origin: *`
 * 로 파일을 준다. 그래서 브라우저가 게이트웨이 없이 바로 받을 수 있고, 이 파일은 그때
 * 필요한 목록 하나를 만든다 — 항목마다 매니페스트를 따로 받지 않도록 파일 목록까지 담는다.
 *
 * 이름과 종류는 파일명에서 추측하지 않고 샘플 원고(rain-blank.json)에 적힌 값을 그대로 쓴다.
 * 원고가 배경·CG·인물을 이미 한글 이름으로 분류해 두었기 때문이다. 원고에 없는 음원만
 * 아래 표에서 이름을 가져온다.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
/** 앱이 그대로 서빙하는 폴더. 카탈로그 경로는 전부 이 폴더 기준이다. */
const PUBLIC_ROOT = "packages/app/public";
const ASSET_ROOT = `${PUBLIC_ROOT}/assets`;
const OUT = join(root, PUBLIC_ROOT, "catalog", "assets.json");

/** 원고에 없는 음원의 표시 이름. 파일명을 그대로 보여 주면 고를 수가 없다. */
const AUDIO_NAMES = {
  "bgm/main-theme.mp3": ["메인 테마", "bgm"],
  "bgm/rain.mp3": ["비 내리는 날", "bgm"],
  "bgm/daily.mp3": ["평범한 하루", "bgm"],
  "bgm/warm.mp3": ["따뜻한 오후", "bgm"],
  "bgm/ending.mp3": ["엔딩", "bgm"],
  "sfx/rain-loop.mp3": ["빗소리 루프", "sfx"],
  "sfx/footsteps.mp3": ["발소리", "sfx"],
  "sfx/door-open.mp3": ["문 열리는 소리", "sfx"],
  "sfx/page-turn.mp3": ["책장 넘기는 소리", "sfx"],
  "sfx/brush-stroke.mp3": ["붓질", "sfx"],
  "sfx/cicada.mp3": ["매미 소리", "sfx"],
  "sfx/heartbeat.mp3": ["심장 박동", "sfx"],
  "sfx/phone-buzz.mp3": ["휴대폰 진동", "sfx"],
  "sfx/ui-click.mp3": ["UI 클릭", "sfx"],
  "sfx/ui-hover.mp3": ["UI 호버", "sfx"],
};

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav" };
const mimeFor = (path) => MIME[path.slice(path.lastIndexOf("."))] ?? "application/octet-stream";

/** 원고의 `/assets/...` URL → public 폴더 기준 경로. 앞의 슬래시를 떼기만 하면 된다. */
const repoPath = (url) => url.replace(/^\//, "");

async function exists(path) { try { await stat(path); return true; } catch { return false; } }

const script = JSON.parse(await readFile(join(root, "packages/content/data/rain-blank.json"), "utf8"));
const items = [];
const skipped = [];

// ── 인물 ────────────────────────────────────────────────────────────────────
// 표정 이미지는 인물 하나로 묶는다. 배우 한 명을 설치하면 표정이 전부 따라와야 쓸 수 있다.
const claimed = new Set();
for (const character of script.characters ?? []) {
  const files = [];
  for (const [expression, url] of Object.entries(character.expressionImages ?? {})) {
    const path = repoPath(url);
    if (!(await exists(join(root, PUBLIC_ROOT, path)))) { skipped.push(`${character.id}:${expression} → ${path}`); continue; }
    claimed.add(url);
    files.push({ role: `expression:${expression}`, path, mime: mimeFor(path) });
  }
  // 원고가 인물 자산으로 분류했지만 표정표에 없는 그림(작업 중·독서 등)은 포즈로 붙인다.
  for (const asset of script.assets ?? []) {
    if (asset.kind !== "character" || claimed.has(asset.url)) continue;
    if (!asset.url.includes(`/${character.id}-`)) continue;
    const path = repoPath(asset.url);
    if (!(await exists(join(root, PUBLIC_ROOT, path)))) { skipped.push(`${asset.id} → ${path}`); continue; }
    claimed.add(asset.url);
    files.push({ role: `pose:${asset.name}`, path, mime: mimeFor(path) });
  }
  if (!files.length) { skipped.push(`${character.id}: 그림 없음`); continue; }
  items.push({
    id: `cast-${character.id}`,
    kind: "character",
    name: character.name,
    tags: ["인물", character.chromaKey ? "크로마키" : "투명배경"],
    license: "downloadable",
    // 원본이 초록 배경이면 그 값을 같이 낸다. 설치할 때 대상 캐릭터에 걸어 주지 않으면 게임에서 초록 상자가 보인다.
    ...(character.chromaKey ? { chromaKey: character.chromaKey } : {}),
    thumb: files[0].path,
    fileCount: files.length,
    files,
  });
}

// ── 무대(배경·이벤트 CG) ────────────────────────────────────────────────────
for (const asset of script.assets ?? []) {
  if (asset.kind !== "background" && asset.kind !== "cg") continue;
  const path = repoPath(asset.url);
  if (!(await exists(join(root, PUBLIC_ROOT, path)))) { skipped.push(`${asset.id} → ${path}`); continue; }
  items.push({
    id: `stage-${asset.id}`,
    kind: "stage",
    name: asset.name,
    tags: [asset.kind === "cg" ? "이벤트 CG" : "배경"],
    license: "downloadable",
    thumb: path,
    fileCount: 1,
    // role 이 `base` 면 배경으로, `cg` 면 이벤트 CG 로 설치된다(losia-asset/1 규칙).
    files: [{ role: asset.kind === "cg" ? "cg" : "base", path, mime: mimeFor(path) }],
  });
}

// 원고가 안 쓰는 기본 배경도 같이 낸다. 새 작품을 시작할 때 쓸 게 있어야 한다.
for (const name of (await readdir(join(root, ASSET_ROOT, "bg"))).sort()) {
  if (name === "title.png") continue;
  const path = `assets/bg/${name}`;
  const slug = name.replace(/\.[^.]+$/, "");
  items.push({
    id: `stage-basic-${slug}`,
    kind: "stage",
    name: `기본 배경 · ${slug}`,
    tags: ["배경", "기본 제공"],
    license: "downloadable",
    thumb: path,
    fileCount: 1,
    files: [{ role: "base", path, mime: mimeFor(path) }],
  });
}

// ── 소리 ────────────────────────────────────────────────────────────────────
for (const [relative, [name, kind]] of Object.entries(AUDIO_NAMES)) {
  const path = `assets/audio/${relative}`;
  if (!(await exists(join(root, PUBLIC_ROOT, path)))) { skipped.push(`audio ${relative}`); continue; }
  items.push({
    id: `sound-${relative.replace(/[/.]/g, "-")}`,
    kind: "sound",
    name,
    tags: [kind === "bgm" ? "배경음" : "효과음"],
    license: "downloadable",
    fileCount: 1,
    // 배경음과 효과음은 role 이 아니라 태그로 갈린다(losia-asset/1 은 `audio` 하나만 안다).
    files: [{ role: "audio", path, mime: mimeFor(path) }],
  });
}

// ── 썸네일 ──────────────────────────────────────────────────────────────────
// 원본 배경은 한 장에 3 MB 까지 간다. 목록에 그대로 걸면 46장을 받느라 화면이 멈춘다.
// ffmpeg 이 있으면 320px webp 로 줄여 같이 커밋하고, 없으면 원본 경로를 그대로 둔다.
const THUMB_DIR = "catalog/thumbs";
const THUMB_OUT = join(root, PUBLIC_ROOT, THUMB_DIR);
let ffmpeg = true;
try { await run("ffmpeg", ["-version"]); } catch { ffmpeg = false; }
if (!ffmpeg) console.log("  ffmpeg 없음 — 썸네일 없이 원본 경로를 쓴다(목록이 무거워진다)");
else {
  await mkdir(THUMB_OUT, { recursive: true });
  for (const item of items) {
    if (!item.thumb) continue;
    const out = `${THUMB_DIR}/${item.id}.webp`;
    // 크로마키 원본은 목록에서도 초록 배경으로 보인다. 썸네일에서만 미리 빼 둔다(원본은 그대로 둔다).
    const filters = item.chromaKey ? `colorkey=${item.chromaKey}:0.32:0.12,scale=320:-2` : "scale=320:-2";
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", join(root, PUBLIC_ROOT, item.thumb), "-vf", filters, "-quality", "80", join(THUMB_OUT, `${item.id}.webp`)]);
    item.thumb = out;
  }
}

const catalog = {
  spec: "openvnmaker-catalog/1",
  repo: "MovieHolic-Plex/openvnmaker",
  // 경로는 앱의 public 폴더 기준이다. 같은 오리진에서는 `/assets/...` 로, CDN 에서는
  // `packages/app/public/` 을 앞에 붙여 쓴다. 절대 주소를 박으면 저장소 이름이 바뀔 때 전부 죽는다.
  pathsAreRelativeTo: "packages/app/public",
  generatedAt: new Date().toISOString().slice(0, 10),
  total: items.length,
  items,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(catalog, null, 2)}\n`);

const byKind = items.reduce((acc, item) => ({ ...acc, [item.kind]: (acc[item.kind] ?? 0) + 1 }), {});
console.log(`카탈로그 ${items.length}개 → ${OUT}`);
console.log(`  인물 ${byKind.character ?? 0} · 무대 ${byKind.stage ?? 0} · 소리 ${byKind.sound ?? 0}`);
console.log(`  파일 ${items.reduce((sum, item) => sum + item.files.length, 0)}개`);
if (skipped.length) console.log(`  건너뜀 ${skipped.length}: ${skipped.join(", ")}`);
