import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const FIXTURE_MODULES = [
  "/src/studio/projects.ts",
  "/src/studio/exportBundle.ts",
  "/src/studio/projectFolder.ts",
  "/src/storage/projectAssets.ts",
  "/src/studio/projectRepository.ts",
  "/src/studio/harness/applyProposal.ts",
] as const;

export type FixtureModulePath = (typeof FIXTURE_MODULES)[number];

const SOURCE = {
  "/src/studio/projects.ts": "src/studio/projects.ts",
  "/src/studio/exportBundle.ts": "src/studio/exportBundle.ts",
  "/src/studio/projectFolder.ts": "src/studio/projectFolder.ts",
  "/src/storage/projectAssets.ts": "src/storage/projectAssets.ts",
  "/src/studio/projectRepository.ts": "src/studio/projectRepository.ts",
  "/src/studio/harness/applyProposal.ts": "src/studio/harness/applyProposal.ts",
} as const satisfies Record<FixtureModulePath, string>;

function asManifest(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Preview manifest is not an object: ${path}`);
  }
  return value as Record<string, unknown>;
}

function hashedAssetFile(entry: unknown, url: string): string {
  if (typeof entry !== "object" || entry === null || !("file" in entry) || typeof entry.file !== "string") {
    throw new Error(`Fixture ${url} missing from preview manifest`);
  }
  const file = entry.file;
  if (!file.startsWith("assets/") || !file.endsWith(".js")) {
    throw new Error(`Fixture ${url} manifest file is not a hashed assets entry: ${file}`);
  }
  return file;
}

export function fixtureReexport(file: string): string {
  return `export * from ${JSON.stringify(`/${file}`)};\n`;
}

export async function compileFixtureBridge(outDir: string): Promise<ReadonlyMap<string, Uint8Array>> {
  const manifestPath = resolve(outDir, ".vite/manifest.json");
  const manifest = asManifest(JSON.parse(await readFile(manifestPath, "utf8")), manifestPath);
  const files = new Map<string, Uint8Array>();
  for (const url of FIXTURE_MODULES) {
    files.set(url, Buffer.from(fixtureReexport(hashedAssetFile(manifest[SOURCE[url]], url))));
  }
  return files;
}
