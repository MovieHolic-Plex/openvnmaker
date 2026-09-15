/**
 * 개발 실행: Vite 개발 서버를 띄우고 그 주소로 Electron 창을 연다.
 * 개발 서버는 이미 `/api/*` 와 `/api/native-build/*` 를 같은 오리진에 붙여 주므로
 * 데스크톱 쪽 로컬 서버는 쓰지 않는다(핫 리로드를 그대로 쓰기 위해서다).
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.VNMAKER_APP_PORT ?? 5173);
const URL_ = `http://127.0.0.1:${PORT}`;
const children = [];

function stopAll(code) {
  for (const child of children) { try { child.kill(); } catch { /* 이미 죽었다 */ } }
  process.exit(code);
}
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || res.status < 500) return;
    } catch { /* 아직 안 떴다 */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`개발 서버가 ${url} 에서 응답하지 않습니다.`);
}

const vite = spawn("pnpm", ["--filter", "@vnmaker/app", "dev", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], { stdio: "inherit", shell: process.platform === "win32" });
children.push(vite);
vite.on("exit", (code) => { if (code) stopAll(code ?? 1); });

await waitForServer(`${URL_}/studio.html`);

const electron = spawn(require("electron"), ["."], {
  stdio: "inherit",
  env: { ...process.env, VNMAKER_DESKTOP_DEV_URL: URL_ },
});
children.push(electron);
electron.on("exit", (code) => stopAll(code ?? 0));
