import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runtimeNotices } from "../runtime-notices.js";

test("actual installed runtime packages retain exact notices, versions and deterministic inventory", async () => {
  const root = resolve(import.meta.dirname, "..");
  const modules = [resolve(root, "src/export/export-player.tsx"), resolve(root, "node_modules/react/index.js"), "\0rolldown/runtime.js"];
  const files = await runtimeNotices(root, modules);
  assert.deepEqual(files, await runtimeNotices(root, [...modules].reverse()));
  const inventory = JSON.parse(new TextDecoder().decode(files.get("RUNTIME_COMPONENTS.json")));
  assert.deepEqual(inventory.components.map((component: {name: string}) => component.name), ["react", "rolldown", "vnmaker"]);
  assert.equal(inventory.components[0].version, JSON.parse(await readFile(resolve(root, "node_modules/react/package.json"), "utf8")).version);
  const notices = new TextDecoder().decode(files.get("THIRD_PARTY_NOTICES.txt"));
  assert.ok(notices.includes(await readFile(resolve(root, "node_modules/react/LICENSE"), "utf8")));
  assert.ok(inventory.components[1].notices.some((notice: {file: string}) => notice.file === "THIRD-PARTY-LICENSE"));
  assert.ok(!JSON.stringify(inventory).includes(root));
  await assert.rejects(runtimeNotices(root, ["\0unknown/runtime.js"]), /requires license review/);
});
