import { test, expect } from "@playwright/test";

const VITE_JSX_RUNTIME = "**/node_modules/.vite/deps/react_jsx-dev-runtime.js*";
const FIXTURE_MODULES = [
  "/src/studio/projects.ts",
  "/src/studio/exportBundle.ts",
  "/src/studio/projectFolder.ts",
  "/src/storage/projectAssets.ts",
] as const;

function isViteDevTransport(url: string): boolean {
  const path = new URL(url).pathname;
  return path.startsWith("/node_modules/.vite/") || path === "/@vite/client" || path.startsWith("/@react-refresh") || path === "/src/main.tsx" || path === "/src/App.tsx";
}

test("player mounts when the original Vite JSX runtime module is blocked", async ({ page }, testInfo) => {
  const viteTransport: string[] = [];
  await page.route(VITE_JSX_RUNTIME, route => route.abort("connectionfailed"));
  page.on("request", request => {
    if (isViteDevTransport(request.url())) viteTransport.push(new URL(request.url()).pathname);
  });
  await page.addInitScript(() => {
    sessionStorage.setItem("vnmaker.previewScript", JSON.stringify({
      title: "모듈 전달", subtitle: "", start: "s", characters: [],
      scenes: [{ id: "s", background: "title", lines: [{ speaker: null, text: "마운트" }], ending: "끝" }],
    }));
  });
  await page.goto("/?preview=1");
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.getByTestId("skip-button")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("mounted-player.png") });
  expect(viteTransport).toEqual([]);
  const fixture = await page.evaluate(async path => {
    const module = await import(path);
    return {
      saveProject: typeof module["saveProject"],
      activateProject: typeof module["activateProject"],
      newProject: typeof module["newProject"],
    };
  }, FIXTURE_MODULES[0]);
  expect(fixture).toEqual({ saveProject: "function", activateProject: "function", newProject: "function" });
  for (const path of FIXTURE_MODULES) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"] ?? "").toMatch(/javascript|ecmascript/);
  }
});
