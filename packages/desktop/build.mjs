/**
 * 데스크톱 번들 빌드.
 *
 * 메인 프로세스를 esbuild 로 한 파일에 담는다. pnpm 워크스페이스는 심링크로 의존성을 두는데,
 * electron-builder 는 그 심링크를 따라가며 패키징할 때 자주 깨진다. 한 파일로 말아 두면
 * 패키징이 `dist/` 만 담으면 끝난다(네이티브 모듈이 없어 가능한 방법이다).
 */
import { build } from "esbuild";
import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const appDist = join(here, "..", "app", "dist");

const exists = async (path) => { try { await stat(path); return true; } catch { return false; } };

if (!(await exists(join(appDist, "studio.html")))) {
  console.error(`빌드한 웹 자산이 없습니다: ${appDist}\n먼저 'pnpm --filter @vnmaker/app build' 를 실행하세요.`);
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const result = await build({
  entryPoints: [join(here, "src", "main.ts")],
  outfile: join(out, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // electron 은 런타임이 제공한다. 번들에 넣으면 안 된다.
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
  banner: {
    // ESM 번들 안에서 CJS 전용 패키지가 require 를 찾는 경우를 위한 다리.
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
});
if (result.errors.length) process.exit(1);

// 정적 자산: 플레이어(index.html)·스튜디오(studio.html)·에셋·export-runtime·서비스 워커.
await cp(appDist, join(out, "web"), { recursive: true });

// `open` 패키지는 리눅스에서 자기 폴더의 xdg-open 스크립트를 찾는다. 번들되면 경로가 dist 로 바뀌므로 같이 옮긴다.
// (윈도우·맥은 OS 명령을 쓰므로 이 파일이 없어도 된다.)
try {
  const xdg = fileURLToPath(await import.meta.resolve("open/xdg-open"));
  await cp(xdg, join(out, "xdg-open"));
} catch {
  await writeFile(join(out, "xdg-open"), "#!/bin/sh\nexec xdg-open \"$@\"\n", { mode: 0o755 });
}

// 리눅스 창 아이콘은 런타임에 파일로 읽는다. buildResources 는 앱 안에 들어가지 않으므로 여기서 복사한다.
await cp(join(here, "build", "icon.png"), join(out, "icon.png"));

console.log(`데스크톱 번들 완료: ${out}`);
