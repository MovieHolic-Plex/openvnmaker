import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.VNMAKER_APP_PORT ?? 5173);

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
    command: `pnpm --filter @vnmaker/app exec vite build --config ../../tests/e2e/server/e2e-preview.config.ts && pnpm --filter @vnmaker/app exec vite preview --config ../../tests/e2e/server/e2e-preview.config.ts --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
