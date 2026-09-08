import { resolve } from "node:path";
import { build, type InlineConfig } from "./vite-api.ts";

export const FIXTURE_MODULES = [
  "/src/studio/projects.ts",
  "/src/studio/exportBundle.ts",
  "/src/studio/projectFolder.ts",
  "/src/storage/projectAssets.ts",
] as const;

export type FixtureModulePath = (typeof FIXTURE_MODULES)[number];

const SOURCE = {
  "/src/studio/projects.ts": "src/studio/projects.ts",
  "/src/studio/exportBundle.ts": "src/studio/exportBundle.ts",
  "/src/studio/projectFolder.ts": "src/studio/projectFolder.ts",
  "/src/storage/projectAssets.ts": "src/storage/projectAssets.ts",
} as const satisfies Record<FixtureModulePath, string>;

function chunkCode(url: string, result: Awaited<ReturnType<typeof build>>): string {
  const outputs = Array.isArray(result) ? result : [result];
  const chunks: string[] = [];
  for (const output of outputs) {
    if (!("output" in output)) throw new Error(`Fixture build produced no output for ${url}`);
    for (const item of output.output) {
      if (item.type === "chunk") chunks.push(item.code);
    }
  }
  const code = chunks[0];
  if (chunks.length !== 1 || code === undefined) {
    throw new Error(`Fixture ${url} must be a single ES module, got ${String(chunks.length)}`);
  }
  return code;
}

export async function compileFixtureBridge(appRoot: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const url of FIXTURE_MODULES) {
    const config = {
      configFile: false,
      root: appRoot,
      publicDir: false,
      logLevel: "warn",
      build: {
        write: false,
        emptyOutDir: false,
        sourcemap: false,
        minify: false,
        target: "es2022",
        lib: {
          entry: resolve(appRoot, SOURCE[url]),
          formats: ["es"],
          fileName: () => "fixture.js",
        },
        rollupOptions: {
          output: { codeSplitting: false },
        },
      },
    } satisfies InlineConfig;
    files.set(url, Buffer.from(chunkCode(url, await build(config))));
  }
  return files;
}
