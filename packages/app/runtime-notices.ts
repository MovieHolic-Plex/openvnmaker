import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";

/** Inventory the emitted player's module graph, not the editor's dependency list. */
export async function runtimeNotices(appRoot: string, moduleIds: Iterable<string>) {
  const repository = await realpath(resolve(appRoot, "../.."));
  const owners = new Set<string>([repository]);
  async function owner(file: string): Promise<string> {
    let directory = dirname(await realpath(file));
    for (;;) {
      try {
        const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
        if (typeof metadata.name === "string") return directory;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const parent = dirname(directory);
      if (parent === directory) throw new Error(`No package owns runtime module: ${file}`);
      directory = parent;
    }
  }
  for (const id of new Set(moduleIds)) {
    if (id === "\0rolldown/runtime.js") {
      const require = createRequire(await realpath(resolve(appRoot, "node_modules/vite/package.json")));
      owners.add(await owner(require.resolve("rolldown")));
    } else if (id.startsWith("\0")) {
      throw new Error(`Unclassified runtime module requires license review: ${JSON.stringify(id)}`);
    } else {
      const file = id.split("?")[0]!;
      if (!isAbsolute(file)) throw new Error(`Unexpected runtime module: ${id}`);
      if (file.replaceAll("\\", "/").includes("/node_modules/")) owners.add(await owner(file));
      else {
        const local = relative(repository, await realpath(file));
        if (local === ".." || local.startsWith("../") || local.startsWith("..\\") || isAbsolute(local))
          throw new Error(`Runtime source outside repository requires license review: ${id}`);
      }
    }
  }
  const components = [];
  for (const directory of owners) {
    const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
    const names = (await readdir(directory, { withFileTypes: true }))
      .filter(entry => entry.isFile() && /^(?:licen[cs]e|copying|notice|third[-_]party[-_]licen[cs]e)(?:$|[._-])/i.test(entry.name))
      .map(entry => entry.name).sort();
    if (!names.length) throw new Error(`Missing license files for bundled package ${metadata.name}@${metadata.version}`);
    const notices = [];
    for (const name of names) {
      const bytes = await readFile(resolve(directory, name));
      notices.push({ file: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) });
    }
    components.push({ name: String(metadata.name), version: String(metadata.version), declaredLicense: metadata.license ?? null, notices });
  }
  components.sort((a, b) => a.name.localeCompare(b.name, "en") || a.version.localeCompare(b.version, "en"));
  const scope = "Standalone web player module graph, including generated Rolldown runtime. Excludes editor-only dependencies, game media and native SDK. This inventory is not a legal clearance of a game.";
  return new Map<string, Uint8Array>([
    ["THIRD_PARTY_NOTICES.txt", Buffer.from(`${scope}\n\n${components.map(component => `${component.name}@${component.version}\n\n${component.notices.map(notice => `--- ${notice.file} ---\n${notice.text}`).join("\n\n")}`).join("\n\n====================\n\n")}`)],
    ["RUNTIME_COMPONENTS.json", Buffer.from(JSON.stringify({ version: 1, scope, components: components.map(component => ({ ...component, notices: component.notices.map(({ text: _text, ...notice }) => notice) })) }, null, 2))],
  ]);
}
