import { expect, test, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { parseScript } from "../../packages/content/src/index.js";
import { canonicalHash, parseProductionDocument, parseProjectHead } from "../../packages/harness/src/index.js";
import { collectProjectAssets } from "../../packages/app/src/studio/exportBundle.js";
import { ProjectRepository } from "../../packages/app/src/studio/projectRepository.js";
import { freezeReleaseSnapshot } from "../../packages/app/src/studio/releaseSnapshot.js";
import { buildWebReleaseBundle, releaseSaveNamespace } from "../../packages/app/src/studio/harness/webRelease.js";
import { crc32 } from "../../packages/app/src/studio/zip.js";

const PRIVATE_CANARIES = [
  "PRIVATE_CANARY_TOKEN_DO_NOT_RELEASE",
  "ya29.OAUTH_TOKEN_CANARY",
  "candidate:release-e2e:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
] as const;
const ORACLE = {
  title: "Pinned web release",
  firstLine: "The atrium is quiet.",
  choice: "Take the shard",
  afterChoice: "The shard ending.",
  ending: "Oracle ending A",
  flag: { shard: true },
} as const;
const types: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".mp3": "audio/mpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

async function unzip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const files = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const length = view.getUint16(offset + 26, true);
    const extra = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length));
    const start = offset + 30 + length + extra;
    const body = bytes.slice(start, start + size);
    if (crc32(body) !== view.getUint32(offset + 14, true)) throw new Error(`crc ${name}`);
    files.set(name, body);
    offset = start + size;
  }
  return files;
}

async function materialize(files: Map<string, Uint8Array>, directory: string) {
  await mkdir(directory, { recursive: true });
  for (const [path, bytes] of files) {
    const full = resolve(directory, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }
}

async function distFetcher(): Promise<typeof fetch> {
  const root = resolve("packages/app/dist/export-runtime");
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as {
    files: { path: string; size: number; sha256: string }[];
  };
  const files = new Map<string, Uint8Array>();
  files.set("manifest.json", await readFile(resolve(root, "manifest.json")));
  for (const file of manifest.files) files.set(file.path, await readFile(resolve(root, file.path)));
  return (async input => {
    const path = String(input);
    if (!path.startsWith("/export-runtime/")) return new Response("missing", { status: 404 });
    const bytes = files.get(path.slice("/export-runtime/".length));
    if (bytes === undefined) return new Response("missing", { status: 404 });
    return new Response(Buffer.from(bytes));
  }) as typeof fetch;
}

async function pinnedGame() {
  const background = "/assets/bg/title.png";
  const script = parseScript({
    title: ORACLE.title, subtitle: "", start: "start", characters: [],
    artDirection: PRIVATE_CANARIES[0],
    assets: [{
      id: "bg-title", name: "Title", kind: "background", url: background, compositing: "opaque",
      prompt: PRIVATE_CANARIES[1], provenance: { creator: "Public", source: "Fixture", license: "Test", credit: "Public" },
    }],
    scenes: [
      {
        id: "start", background: "title", backgroundUrl: background,
        lines: [{ speaker: null, text: ORACLE.firstLine }],
        choices: [
          { text: ORACLE.choice, next: "end", set: { shard: true } },
          { text: "Walk away", next: "other" },
        ],
      },
      {
        id: "end", background: "title", backgroundUrl: background,
        lines: [{ speaker: null, text: ORACLE.afterChoice, when: { all: ["shard"] } }],
        ending: ORACLE.ending,
      },
      {
        id: "other", background: "title", backgroundUrl: background,
        lines: [{ speaker: null, text: "The other ending." }],
        ending: "Oracle ending B",
      },
    ],
  });
  const productionDocument = parseProductionDocument({
    version: 1, brief: PRIVATE_CANARIES[2], castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: ORACLE.title, subtitle: "", bible: "", start: "start", scenes: [] },
    artDirection: [], referenceBindings: [],
  });
  const head = parseProjectHead({
    projectId: "web-release-e2e", lineageId: "00000000-0000-4000-8000-000000000031",
    revision: 0, scriptHash: await canonicalHash(script), productionHash: await canonicalHash(productionDocument),
  });
  const repository = new ProjectRepository({ head, script, productionDocument });
  const assets = new Map<string, Uint8Array>();
  for (const path of collectProjectAssets(script)) {
    assets.set(path, await readFile(resolve("packages/app/public", path.slice(1))));
  }
  const release = await freezeReleaseSnapshot({ repository, readAssetBytes: async path => assets.get(path) });
  return { release, assets, script };
}

async function serve(directory: string, prefix: "" | "/games/medium/"): Promise<{ server: Server; origin: string; missing: string[] }> {
  const missing: string[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (prefix) {
        const trimmed = prefix.slice(0, -1);
        if (pathname === trimmed) {
          response.writeHead(302, { Location: prefix }).end();
          return;
        }
        if (!pathname.startsWith(prefix)) {
          if (pathname !== "/favicon.ico") missing.push(pathname);
          response.writeHead(404).end("not found");
          return;
        }
        pathname = pathname.slice(prefix.length - 1);
      }
      const path = resolve(directory, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!path.startsWith(directory + sep)) { response.writeHead(403).end(); return; }
      try {
        const body = await readFile(path);
        response.setHeader("Content-Type", types[extname(path)] ?? "application/octet-stream");
        response.setHeader("Cache-Control", "no-store");
        response.end(body);
      } catch {
        if (pathname !== "/favicon.ico") missing.push(url.pathname);
        response.writeHead(404).end("not found");
      }
    })().catch(() => response.writeHead(500).end());
  });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server failed");
  return { server, origin: `http://127.0.0.1:${address.port}`, missing };
}

async function playthrough(page: Page, origin: string, base: "/" | "/games/medium/", namespace: string, oracle: typeof ORACLE) {
  const leaks: string[] = [];
  const errors: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) leaks.push(url.href);
  });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("vnmaker:settings", JSON.stringify({ textSpeed: 5, bgmVolume: 0, sfxVolume: 0, voiceVolume: 0 }));
  });
  await page.goto(`${origin}${base}`);
  await expect(page.getByRole("heading", { name: oracle.title, exact: true })).toBeVisible();
  await page.getByTestId("start-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(oracle.firstLine);
  await page.getByTestId("advance-button").click();
  await expect(page.getByTestId("choice-0")).toHaveText(oracle.choice);
  await page.getByTestId("choice-0").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(oracle.afterChoice);
  await page.getByTestId("save-button").click();
  await page.getByTestId("slot-save-0").click();
  await page.reload();
  await expect(page.getByTestId("continue-button")).toBeEnabled();
  await page.getByTestId("continue-button").click();
  await expect(page.getByTestId("dialogue-text")).toHaveText(oracle.afterChoice);
  await page.getByTestId("skip-button").click();
  await expect(page.getByTestId("ending-title")).toHaveText(oracle.ending);
  const flags = await page.evaluate(() => window.__vn?.flags ?? {});
  expect(flags).toEqual(oracle.flag);
  const saved = await page.evaluate(key => localStorage.getItem(key), `vnmaker:save:${namespace}`);
  expect(saved).toContain(oracle.afterChoice);
  expect(leaks).toEqual([]);
  expect(errors).toEqual([]);
}

test("root-and-subpath-playthrough", async ({ browser }, testInfo) => {
  const { release, assets } = await pinnedGame();
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: await distFetcher() });
  const files = await unzip(bundle.blob);
  const directory = testInfo.outputPath("unpacked");
  await materialize(files, directory);
  const componentsPath = resolve(directory, "RUNTIME_COMPONENTS.json");
  const components = JSON.parse(await readFile(componentsPath, "utf8")) as { components: { name: string }[] };
  expect(components.components.map(component => component.name)).toEqual(["react", "react-dom", "rolldown", "scheduler", "vnmaker"]);
  expect(await canonicalHash(parseScript(JSON.parse(await readFile(resolve(directory, "project.json"), "utf8"))))).toBe(release.publicScriptHash);
  const namespace = releaseSaveNamespace(release);
  expect(bundle.projectNamespace).toBe(namespace);
  const root = await serve(directory, "");
  const nested = await serve(directory, "/games/medium/");
  const cleanup: string[] = [];
  try {
    const rootContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const nestedContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    cleanup.push("contexts");
    try {
      await playthrough(await rootContext.newPage(), root.origin, "/", namespace, ORACLE);
      await playthrough(await nestedContext.newPage(), nested.origin, "/games/medium/", namespace, ORACLE);
    } finally {
      await rootContext.close();
      await nestedContext.close();
    }
    expect(root.missing.filter(path => !path.endsWith("favicon.ico"))).toEqual([]);
    expect(nested.missing.filter(path => !path.endsWith("favicon.ico"))).toEqual([]);
  } finally {
    await new Promise<void>(done => root.server.close(() => done()));
    await new Promise<void>(done => nested.server.close(() => done()));
    cleanup.push("servers");
    await writeFile(testInfo.outputPath("cleanup.json"), JSON.stringify({ cleanup, namespace }, null, 2));
  }
});

test("reject-missing-media-and-private-leak", async () => {
  const { release, assets } = await pinnedGame();
  const dropped = "/assets/bg/title.png";
  const incomplete = new Map(assets);
  incomplete.delete(dropped);
  await expect(buildWebReleaseBundle(release, { assets: incomplete, fetcher: await distFetcher() })).rejects.toThrow(dropped);
  const bundle = await buildWebReleaseBundle(release, { assets, fetcher: await distFetcher() });
  const files = await unzip(bundle.blob);
  const payload = [...files.entries()].map(([path, bytes]) => `${path}\n${new TextDecoder().decode(bytes)}`).join("\n");
  for (const canary of PRIVATE_CANARIES) expect(payload).not.toContain(canary);
  expect(payload).not.toContain("ya29.");
  expect([...files.keys()].some(path => path.startsWith("api/") || path.includes("gateway"))).toBe(false);
});
