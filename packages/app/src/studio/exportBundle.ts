import { audioFormat, audioPath, auditScript, characterImage, parseScript, validBackgroundUrl, type SpriteDirection, type VnScript } from "@vnmaker/content";
import { createZip, type ZipEntry } from "./zip.js";
import { mediaCredits } from "./mediaCredits.js";

export interface ExportProgress { readonly phase: "player" | "assets" | "zip"; readonly complete: number; readonly total: number; readonly path?: string }
interface ExportOptions {
  readonly fetcher?: typeof fetch; readonly signal?: AbortSignal; readonly onProgress?: (progress: ExportProgress) => void;
  readonly projectNamespace?: string; readonly extraEntries?: readonly ZipEntry[]; readonly readmeText?: string;
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
    for (const sprite of sprites ?? []) if (sprite.character) { image(sprite.poseUrl); expression(sprite.character, sprite.expression); }
  };
  for (const asset of script.assets ?? []) image(asset.url);
  for (const asset of script.audioAssets ?? []) paths.add(asset.url);
  for (const actor of script.characters) for (const url of Object.values(actor.expressionImages ?? {})) image(url);
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
    ...(script.audioAssets?{audioAssets:script.audioAssets.map(asset=>({...asset,url:replace(asset.url)}))}:{}),
    ...(script.assets ? { assets: script.assets.map(asset => ({ ...asset, url: replace(asset.url) })) } : {}),
    characters: script.characters.map(character => ({ ...character, ...(character.expressionImages ? { expressionImages: Object.fromEntries(Object.entries(character.expressionImages).map(([expression, url]) => [expression, url ? replace(url) : url])) } : {}) })),
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
  const path = (value: unknown) => typeof value === "string" && (value === "RUNTIME_COMPONENTS.json" || /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(js|css|txt|woff2)$/.test(value));
  if (!m || m.version !== 1 || !path(m.entry) || !Array.isArray(m.stylesheets) || !m.stylesheets.every(path) || !Array.isArray(m.files) || !m.files.length || m.files.length > 50 || !m.files.every(file => path(file.path) && Number.isSafeInteger(file.size) && file.size > 0 && /^[a-f0-9]{64}$/.test(file.sha256))) throw new Error("배포 플레이어 정보가 올바르지 않습니다. 앱을 다시 빌드해주세요.");
  const files = new Set(m.files.map(file => file.path));
  if (files.size !== m.files.length || !files.has(m.entry) || m.stylesheets.some(path => !files.has(path))) throw new Error("배포 플레이어 파일이 누락되었습니다.");
  return m;
}

export async function buildExportBundle(source: VnScript, options: ExportOptions = {}): Promise<{ blob: Blob; filename: string; fileCount: number; projectNamespace: string }> {
  const script = parseScript(structuredClone(source));
  const errors = auditScript(script).filter(issue => issue.severity === "error");
  if (errors.length) throw new Error(`배포 전에 원고 연결을 확인하세요.\n${errors.map(issue => `${issue.sceneId}: ${issue.message}`).join("\n")}`);
  const fetcher = options.fetcher ?? fetch;
  const request = async (url: string) => {
    options.signal?.throwIfAborted();
    const response = await fetcher(url, { signal: options.signal ?? null, cache: "no-store", redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  };
  options.onProgress?.({ phase: "player", complete: 0, total: 1 });
  let runtime: RuntimeManifest;
  try { runtime = runtimeManifest(await (await request("/export-runtime/manifest.json")).json()); }
  catch (error) { options.signal?.throwIfAborted(); throw new Error(`독립 플레이어를 준비하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`); }
  const entries: ZipEntry[] = [];
  for (const file of runtime.files) {
    const bytes = new Uint8Array(await (await request(`/export-runtime/${file.path}`)).arrayBuffer());
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
  const html = `<!doctype html>\n<html lang="ko"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="theme-color" content="#15131d"/><title>${escapeHtml(script.title)}</title>${runtime.stylesheets.map(path => `<link rel="stylesheet" href="./${path}"/>`).join("")}</head><body><div id="root"></div><script type="module" src="./${runtime.entry}"></script></body></html>\n`;
  entries.push({ path: "index.html", bytes: encode(html) }, { path: "project.json", bytes: manuscript });
  for (const extra of options.extraEntries ?? []) {
    if (entries.some(entry => entry.path === extra.path)) throw new Error(`ZIP 파일 경로가 올바르지 않습니다: ${extra.path}`);
    entries.push(extra);
  }
  const projectNamespace = options.projectNamespace ?? `bundle-${(await sha256(manuscript)).slice(0, 16)}`;
  if (options.projectNamespace !== undefined && !/^(?:bundle|release)-[a-f0-9]{16}$/.test(projectNamespace)) throw new Error("배포 정보가 올바르지 않습니다.");
  entries.push({ path: "bundle.json", bytes: encode(JSON.stringify({ version: 1, title: script.title, projectNamespace, createdAt: new Date().toISOString(), files: [...entries].sort((a, b) => a.path.localeCompare(b.path)).map(entry => ({ path: entry.path, bytes: entry.bytes.length })) }, null, 2)) });
  const readme = options.readmeText ?? `${script.title}\n\n이 ZIP은 현재 편집한 원고, 등록 이미지와 모든 연출 파일, 독립 플레이어를 포함합니다.\n\n실행\n1. ZIP을 새 폴더에 모두 풀어주세요.\n2. 그 폴더에서 정적 웹 서버를 실행합니다. Python이 있다면: python -m http.server 8080\n3. 브라우저에서 http://localhost:8080 을 엽니다.\n\n배포\n정적 호스팅 사이트의 루트(/) 또는 하위 경로(/games/medium/)에 이 폴더 전체를 올려주세요. 하위 경로 주소는 끝에 / 가 있어야 합니다.\nindex.html을 file://로 더블클릭하면 브라우저 보안 정책 때문에 원고를 읽을 수 없습니다. 서버 API·앱 로그인·AI 호출은 필요하지 않습니다.\n\n원고와 저장\nproject.json은 내보내기를 누른 순간의 편집 원고입니다. 원본 편집 프로젝트는 변경하지 않습니다. 이 파일은 VN Maker에서 JSON으로 다시 가져올 수 있습니다.\n저장은 이 작품 버전의 ${projectNamespace} 영역을 사용합니다. 다른 작품 및 이전 원고 버전의 저장 기록은 읽지 않습니다. 브라우저와 사이트 주소별로 저장됩니다.\n원고를 수정한 뒤에는 에디터에서 새 ZIP을 만들어주세요. ZIP 안에서 project.json만 바꾸면 버전 구분 정보는 갱신되지 않습니다.\n`;
  entries.push({ path: "README.txt", bytes: encode(readme) });
  options.onProgress?.({ phase: "zip", complete: entries.length, total: entries.length });
  options.signal?.throwIfAborted();
  const blob = createZip(entries.sort((a, b) => a.path.localeCompare(b.path)));
  return { blob, filename: `${script.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim().slice(0, 80) || "visual-novel"}-play.zip`, fileCount: entries.length, projectNamespace };
}
