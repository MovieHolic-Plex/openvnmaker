import { audioFormat, audioPath, auditScript, characterImage, parseScript, validBackgroundUrl, type SpriteDirection, type VnScript } from "@vnmaker/content";
import { createZip, type ZipEntry } from "./zip.js";
import { mediaCredits } from "./mediaCredits.js";

export interface ExportProgress { readonly phase: "player" | "assets" | "zip"; readonly complete: number; readonly total: number; readonly path?: string }
interface ExportOptions {
  readonly fetcher?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ExportProgress) => void;
  /** 독립 플레이어 런타임의 주소 앞부분. 기본 /export-runtime — losia 호스팅 스튜디오는 /make/export-runtime. */
  readonly runtimeBase?: string;
}
interface RuntimeManifest { version: number; entry: string; stylesheets: string[]; files: { path: string; size: number; sha256: string }[] }
const encode = (text: string) => new TextEncoder().encode(text);
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, value => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!);
async function sha256(bytes: Uint8Array) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }

/** Include registered art and every possible scene/line cue, including conditional branches. */
export function collectProjectAssets(script: VnScript): string[] {
  const paths = new Set<string>(["/assets/audio/bgm/main-theme.mp3", "/assets/audio/sfx/ui-click.mp3", "/assets/audio/sfx/ui-hover.mp3"]);
  const image = (url: string | null | undefined) => { if (url) { if (!validBackgroundUrl(url)) throw new Error(`안전하지 않은 이미지 주소: ${url}`); paths.add(url); } };
  const expression = (id: string, expression = "neutral") => {
    const actor = script.characters.find(character => character.id === id);
    image(characterImage(actor,expression));
  };
  const placement = (sprites: readonly SpriteDirection[] | undefined) => {
    // poseUrl 은 캐릭터 없는 독립 배치에도 붙는다 — 캐릭터 유무와 무관하게 수집해야보낸 ZIP 이 그 파일을 잃지 않는다.
    for (const sprite of sprites ?? []) { image(sprite.poseUrl); if (sprite.character) expression(sprite.character, sprite.expression); }
  };
  for (const asset of script.assets ?? []) image(asset.url);
  for (const asset of script.audioAssets ?? []) paths.add(asset.url);
  // 타이틀 음악도 수집한다 — 커스텀 업로드(/assets/user/)는 빠지면보낸 작품이 조용히 묵음이 된다.
  if (script.titleBgm) paths.add(audioPath(script.titleBgm, "bgm"));
  for (const actor of script.characters) { for (const url of Object.values(actor.expressionImages ?? {})) image(url); for (const set of Object.values(actor.outfitImages ?? {})) for (const url of Object.values(set ?? {})) image(url); }
  for (const scene of script.scenes) {
    image(scene.backgroundUrl ?? `/assets/bg/${scene.background}.png`); image(scene.cgUrl); placement(scene.sprites);
    if (scene.bgm) paths.add(audioPath(scene.bgm,"bgm"));
    for (const line of scene.lines) {
      image(line.backgroundUrl); image(line.cgUrl); placement(line.sprites);
      if (line.expression && line.speaker) expression(line.speaker, line.expression);
      if (line.bgm) paths.add(audioPath(line.bgm,"bgm"));
      if (line.sfx) paths.add(audioPath(line.sfx,"sfx"));
      if (line.voice) paths.add(line.voice);
    }
  }
  return [...paths].sort();
}

/** Rebase generated gateway images to package-owned files; keep the source project untouched. */
export function rebaseProjectAssets(script: VnScript, replacements: ReadonlyMap<string, string>): VnScript {
  const replace = (url: string) => replacements.get(url) ?? url;
  const sprites = (rows: readonly SpriteDirection[] | undefined) => rows?.map(row => row.poseUrl ? { ...row, poseUrl: replace(row.poseUrl) } : row);
  return parseScript({
    ...script,
    ...(script.titleBgm?{titleBgm:replace(script.titleBgm)}:{}),
    ...(script.audioAssets?{audioAssets:script.audioAssets.map(asset=>({...asset,url:replace(asset.url)}))}:{}),
    ...(script.assets ? { assets: script.assets.map(asset => ({ ...asset, url: replace(asset.url) })) } : {}),
    characters: script.characters.map(character => ({ ...character, ...(character.expressionImages ? { expressionImages: Object.fromEntries(Object.entries(character.expressionImages).map(([expression, url]) => [expression, url ? replace(url) : url])) } : {}), ...(character.outfitImages ? { outfitImages: Object.fromEntries(Object.entries(character.outfitImages).map(([outfit, set]) => [outfit, Object.fromEntries(Object.entries(set ?? {}).map(([expression, url]) => [expression, url ? replace(url) : url]))])) } : {}) })),
    scenes: script.scenes.map(scene => ({
      ...scene, ...(scene.bgm?{bgm:replace(scene.bgm)}:{}), ...(scene.backgroundUrl ? { backgroundUrl: replace(scene.backgroundUrl) } : {}), ...(scene.cgUrl ? { cgUrl: replace(scene.cgUrl) } : {}), ...(scene.sprites ? { sprites: sprites(scene.sprites) } : {}),
      lines: scene.lines.map(line => ({ ...line, ...(line.bgm?{bgm:replace(line.bgm)}:{}), ...(line.sfx?{sfx:replace(line.sfx)}:{}), ...(line.voice?{voice:replace(line.voice)}:{}), ...(line.backgroundUrl ? { backgroundUrl: replace(line.backgroundUrl) } : {}), ...(line.cgUrl ? { cgUrl: replace(line.cgUrl) } : {}), ...(line.sprites ? { sprites: sprites(line.sprites) } : {}) })),
    })),
  });
}

function validMedia(path: string, bytes: Uint8Array): boolean {
  if (/\.png$/i.test(path)) return bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (/\.jpe?g$/i.test(path)) return bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (/\.webp$/i.test(path)) return bytes.length > 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (/\.(mp3|ogg|wav)$/i.test(path)) {try{return path.endsWith(`.${audioFormat(bytes).extension}`);}catch{return false;}}
  return false;
}
function runtimeManifest(value: unknown): RuntimeManifest {
  const m = value as RuntimeManifest;
  const path = (value: unknown) => typeof value === "string" && (value === "RUNTIME_COMPONENTS.json" || /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(js|css|txt)$/.test(value));
  if (!m || m.version !== 1 || !path(m.entry) || !Array.isArray(m.stylesheets) || !m.stylesheets.every(path) || !Array.isArray(m.files) || !m.files.length || m.files.length > 50 || !m.files.every(file => path(file.path) && Number.isSafeInteger(file.size) && file.size > 0 && /^[a-f0-9]{64}$/.test(file.sha256))) throw new Error("배포 플레이어 정보가 올바르지 않습니다. 앱을 다시 빌드해주세요.");
  const files = new Set(m.files.map(file => file.path));
  if (files.size !== m.files.length || !files.has(m.entry) || m.stylesheets.some(path => !files.has(path))) throw new Error("배포 플레이어 파일이 누락되었습니다.");
  return m;
}

/**
 * index.html 을 더블클릭(file://)하면 브라우저가 모듈 스크립트를 CORS 로 막아 플레이어가 아예 실행되지 않는다 —
 * 플레이어 안의 "정적 서버에서 열어달라" 안내도 그 뒤에 있어 절대 보이지 않았다. 모듈 앞에 놓인 이 고전 스크립트는
 * file:// 에서도 실행되므로 README 안내를 화면에 바로 띄운다. 외부 주소는 참조하지 않는다(오프라인·외부 요청 없음 계약).
 */
const FILE_PROTOCOL_GUIDANCE = `if(location.protocol==="file:"){document.addEventListener("DOMContentLoaded",function(){var root=document.getElementById("root");if(!root)return;root.style.cssText="padding:12vh 8vw;color:#eee;background:#15131d;min-height:100vh;font:18px/1.8 system-ui,sans-serif";var title=document.createElement("h1");title.textContent="\uC774 \uD3F4\uB354\uB97C \uC815\uC801 \uC6F9 \uC11C\uBC84\uC5D0\uC11C \uC5F4\uC5B4\uC8FC\uC138\uC694";var detail=document.createElement("p");detail.textContent="index.html\uC744 \uD30C\uC77C\uB85C \uBC14\uB85C \uC5F4\uBA74(file://) \uBE0C\uB77C\uC6B0\uC800 \uBCF4\uC548 \uC815\uCC45 \uB54C\uBB38\uC5D0 \uC791\uD488\uC744 \uC77D\uC744 \uC218 \uC5C6\uC2B5\uB2C8\uB2E4.";var steps=document.createElement("pre");steps.style.cssText="white-space:pre-wrap;color:#cfd6e6";steps.textContent="1. ZIP\uC744 \uD480\uC5B4 \uB454 \uD3F4\uB354\uC5D0\uC11C \uC815\uC801 \uC6F9 \uC11C\uBC84\uB97C \uC2E4\uD589\uD569\uB2C8\uB2E4. Python\uC774 \uC788\uB2E4\uBA74: python -m http.server 8080\\n2. \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C http://localhost:8080 \uC744 \uC5FD\uB2C8\uB2E4.\\n3. \uC790\uC138\uD55C \uC548\uB0B4\uB294 README.txt\uC5D0 \uC788\uC2B5\uB2C8\uB2E4.";root.appendChild(title);root.appendChild(detail);root.appendChild(steps);});}`;

export async function buildExportBundle(source: VnScript, options: ExportOptions = {}): Promise<{ blob: Blob; filename: string; fileCount: number; projectNamespace: string }> {
  const script = parseScript(structuredClone(source));
  const errors = auditScript(script).filter(issue => issue.severity === "error");
  if (errors.length) throw new Error(`배포 전에 원고 연결을 확인하세요.\n${errors.map(issue => `${issue.sceneId}: ${issue.message}`).join("\n")}`);
  const fetcher = options.fetcher ?? fetch;
  // 느린 회선에서 일시적 전송 실패 한 번이 수백 MB 배포 전체를 죽이지 않게 짧게 재시도한다.
  // 4xx 는 재시도해도 같으니 즉시 던지고, 네트워크 오류·5xx·429 만 다시 본다.
  const request = async (url: string) => {
    let last: unknown = new Error("요청이 실패했습니다");
    for (let attempt = 0; attempt < 3; attempt++) {
      options.signal?.throwIfAborted();
      try {
        const response = await fetcher(url, { signal: options.signal ?? null, cache: "no-store", redirect: "error" });
        if (response.ok) return response;
        last = new Error(`HTTP ${response.status}`);
        if (response.status < 500 && response.status !== 429) break;
      } catch (error) {
        options.signal?.throwIfAborted();
        last = error;
      }
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
    throw last;
  };
  options.onProgress?.({ phase: "player", complete: 0, total: 1 });
  const runtimeBase = (options.runtimeBase ?? "/export-runtime").replace(/\/+$/, "");
  let runtime: RuntimeManifest;
  try { runtime = runtimeManifest(await (await request(`${runtimeBase}/manifest.json`)).json()); }
  catch (error) { options.signal?.throwIfAborted(); throw new Error(`독립 플레이어를 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
  const entries: ZipEntry[] = [];
  for (const file of runtime.files) {
    const bytes = new Uint8Array(await (await request(`${runtimeBase}/${file.path}`)).arrayBuffer());
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) throw new Error(`플레이어 파일이 변경되거나 손상되었습니다: ${file.path}. 다시 내보내주세요.`);
    entries.push({ path: file.path, bytes });
  }
  const paths = collectProjectAssets(script);
  const missing: string[] = [];
  const replacements = new Map<string, string>();
  let complete = 0;
  options.onProgress?.({ phase: "assets", complete, total: paths.length });
  // Bound simultaneous image buffers/network requests for rich long-form projects.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
    while (next < paths.length) {
      const path = paths[next++]!;
      try {
        const bytes = new Uint8Array(await (await request(path)).arrayBuffer());
        if (!validMedia(path, bytes)) throw new Error("올바른 이미지·음악 파일이 아닙니다");
        if(path.startsWith("/assets/user/")&&path.split("/").at(-1)!.split(".")[0]!==await sha256(bytes))throw new Error("원본 파일의 내용과 식별자가 다릅니다");
        let packaged = path.slice(1);
        if (path.startsWith("/api/image/file/")) {
          packaged = `assets/exported/${(await sha256(bytes)).slice(0, 16)}-${path.split("/").at(-1)!}`;
          replacements.set(path, `/${packaged}`);
        }
        if (!entries.some(entry => entry.path === packaged)) entries.push({ path: packaged, bytes });
      } catch (error) { options.signal?.throwIfAborted(); missing.push(`${path} — ${error instanceof Error ? error.message : String(error)}`); }
      complete += 1;
      options.onProgress?.({ phase: "assets", complete, total: paths.length, path });
    }
  }));
  options.signal?.throwIfAborted();
  if (missing.length) throw new Error(`파일 ${missing.length}개를 담지 못해 배포를 중단했습니다.\n${missing.sort().join("\n")}`);
  const exported = rebaseProjectAssets(script, replacements);
  const credits = mediaCredits(exported, collectProjectAssets(exported));
  entries.push({ path: "MEDIA_CREDITS.json", bytes: encode(credits.json) }, { path: "MEDIA_CREDITS.txt", bytes: encode(credits.text) });
  const manuscript = encode(JSON.stringify(exported, null, 2));
  const projectNamespace = `bundle-${(await sha256(manuscript)).slice(0, 16)}`;
  const html = `<!doctype html>\n<html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#15131d"/><title>${escapeHtml(script.title)}</title>${runtime.stylesheets.map(path => `<link rel="stylesheet" href="./${path}"/>`).join("")}</head><body><div id="root"></div><script>${FILE_PROTOCOL_GUIDANCE}</script><script type="module" src="./${runtime.entry}"></script></body></html>\n`;
  entries.push({ path: "index.html", bytes: encode(html) }, { path: "project.json", bytes: manuscript });
  entries.push({ path: "bundle.json", bytes: encode(JSON.stringify({ version: 1, title: script.title, projectNamespace, createdAt: new Date().toISOString(), files: [...entries].sort((a, b) => a.path.localeCompare(b.path)).map(entry => ({ path: entry.path, bytes: entry.bytes.length })) }, null, 2)) });
  entries.push({ path: "README.txt", bytes: encode(`${script.title}\n\n이 ZIP은 현재 편집한 원고, 등록 이미지와 모든 연출 파일, 독립 플레이어를 포함합니다.\n\n실행\n1. ZIP을 새 폴더에 모두 풀어주세요.\n2. 그 폴더에서 정적 웹 서버를 실행합니다. Python이 있다면: python -m http.server 8080\n3. 브라우저에서 http://localhost:8080 을 엽니다.\n\n배포\n정적 호스팅에 이 폴더 전체를 통째로 올려주세요. 도메인 루트가 아닌 하위 경로(예: example.com/games/작품/)에 올려도 됩니다.\nindex.html을 file://로 더블클릭하면 브라우저 보안 정책 때문에 원고를 읽을 수 없습니다. 서버 API·앱 로그인·AI 호출은 필요하지 않습니다.\n\n원고와 저장\nproject.json은 내보내기를 누른 순간의 편집 원고입니다. 원본 편집 프로젝트는 변경하지 않습니다. 이 파일은 VN Maker에서 JSON으로 다시 가져올 수 있습니다.\n저장은 이 작품 버전의 ${projectNamespace} 영역을 사용합니다. 다른 작품 및 이전 원고 버전의 저장 기록은 읽지 않습니다. 브라우저와 사이트 주소별로 저장됩니다.\n원고를 수정한 뒤에는 에디터에서 새 ZIP을 만들어주세요. ZIP 안에서 project.json만 바꾸면 버전 구분 정보는 갱신되지 않습니다.\n`) });
  options.onProgress?.({ phase: "zip", complete: entries.length, total: entries.length });
  options.signal?.throwIfAborted();
  const blob = createZip(entries.sort((a, b) => a.path.localeCompare(b.path)));
  return { blob, filename: `${script.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 80) || "visual-novel"}-play.zip`, fileCount: entries.length, projectNamespace };
}
