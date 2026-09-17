import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 5173 은 사용자 dev 서버가 쓰는 포트다 — 거기로 재사용하면 VNMAKER_PROJECT_DIR 격리가
// 무력화돼 스펙이 실제 프로젝트에 노드/엣지를 심는다. 전용 포트를 쓴다.
const PORT = Number(process.env.VNMAKER_APP_PORT ?? 5199);

// e2e 게이트웨이는 실제 사용자 프로젝트를 건드리지 않도록 전용 그래프 저장소를 쓴다.
// (스펙이 노드/엣지를 직접 심는다 — 기본 ~/.vnmaker/projects/default 와 섞이면 안 된다.)
const E2E_PROJECT_DIR = process.env.VNMAKER_E2E_PROJECT_DIR ?? join(tmpdir(), "vnmaker-e2e-project");
mkdirSync(E2E_PROJECT_DIR, { recursive: true });

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // 오디오 재생을 제스처 없이도 허용한다. BGM currentTime 이 증가하는지 검사하기 위한 것이다.
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
  ],
  webServer: {
    command: `VNMAKER_PROJECT_DIR=${E2E_PROJECT_DIR} pnpm --filter @vnmaker/app dev --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
