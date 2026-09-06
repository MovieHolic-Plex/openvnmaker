import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";

const [first, second, ...extra] = process.argv.slice(2);
if (!first || !second || extra.length) throw new Error("Usage: node tools/audio/verify-reproduction.mjs <first-directory> <second-directory>");
const roots = [resolve(first), resolve(second)];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const manifests = roots.map(root => JSON.parse(readFileSync(join(root, "generation.json"), "utf8")));
assert.deepEqual(manifests[0], manifests[1], "Generation inputs or output records differ");
assert.ok(manifests[0].files.length > 0, "Empty reproduction is not evidence");
const seen = new Set();
for (const file of manifests[0].files) {
  assert.match(file.path, /^(bgm|sfx)\/[a-z0-9-]+\.mp3$/);
  assert.ok(!seen.has(file.path)); seen.add(file.path);
  for (const root of roots) {
    const bytes = readFileSync(join(root, file.path));
    assert.equal(bytes.length, file.bytes);
    assert.equal(hash(bytes), file.sha256, file.path);
  }
}
console.log(`Verified ${seen.size} MP3 files: matching generation records and actual bytes in both directories.`);
