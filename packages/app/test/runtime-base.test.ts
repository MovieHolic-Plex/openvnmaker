import assert from "node:assert/strict";
import { test } from "node:test";
import { bgmSrc, sfxSrc } from "../src/audio/paths.js";
import { configureRuntimeBase, resolveRuntimeAsset, RuntimeAssetPathError } from "../src/storage/runtimeBase.js";

test("studio-assets stay unchanged when no export base is configured", () => {
  // Given: existing bundled, imported, and generated studio references.
  const paths = ["/assets/bg/title.png", "/api/image/file/generated.png", `/assets/user/${"a".repeat(64)}.wav`];
  // When: paths cross the runtime boundary in studio context.
  const resolved = paths.map(path => resolveRuntimeAsset(path));
  // Then: studio API URLs and logical audio IDs retain their existing meaning.
  assert.deepEqual(resolved, paths);
  assert.equal(bgmSrc("daily"), "/assets/audio/bgm/daily.mp3");
  assert.equal(sfxSrc("ui-click"), "/assets/audio/sfx/ui-click.mp3");
  assert.equal(bgmSrc(paths[2] ?? ""), paths[2]);
});

for (const base of ["/", "/games/medium/"]) {
  test(`package-base-assets resolve inside ${base} when logical asset paths are supplied`, () => {
    // Given: the same manuscript paths at either deployment location.
    const packageBase = new URL(base, "https://games.example");
    const paths = ["/assets/bg/title.png", "assets/exported/cover.png", "./assets/sprite/actor.png", "/assets/audio/bgm/daily.mp3", `/assets/user/${"a".repeat(64)}.wav`];
    const originals = [...paths];
    // When: paths are resolved for the standalone package.
    const resolved = paths.map(path => resolveRuntimeAsset(path, packageBase));
    // Then: URLs remain package-owned, and manuscript strings are untouched.
    assert.deepEqual(resolved, paths.map(path => base + path.replace(/^(?:\.\/|\/)/, "")));
    assert.deepEqual(paths, originals);
  });
}

for (const source of [
  "../outside.png", "/assets/../outside.png", "assets/a/../../outside.png",
  "/assets/%2e%2e/outside.png", "/assets/%252e%252e/outside.png", "assets/a%2fb.png",
  String.raw`assets\..\outside.png`, "//evil.example/art.png", "https://evil.example/art.png",
  "/api/image/file/generated.png", "api/image/file/generated.png", "/outside.png",
  "data:image/png;base64,AA==", "blob:https://games.example/id", "file:///C:/secret.png",
  "assets/image.png?redirect=/api/private", "assets/image.png#fragment", " assets/image.png",
  "assets/a\nb.png", "assets/image.png\n", "assets/image.png\r", "assets//image.png", "", "assets/./image.png",
]) {
  test(`reject-escaping-assets rejects ${JSON.stringify(source)} when exported`, () => {
    // Given: an untrusted path and a nested package base.
    const base = new URL("https://games.example/games/medium/");
    // When / Then: resolving an escaping path fails before any request can be made.
    assert.throws(() => resolveRuntimeAsset(source, base), RuntimeAssetPathError);
  });
}

test("package-base-assets applies the export entry base to audio when boot configures it", () => {
  // Given: the real export entry's URL, independent of document route or hostname identity.
  configureRuntimeBase("https://games.example/games/medium/player-build.js?cache=1");
  // When: BGM, SFX and imported audio paths cross their shared adapter.
  const resolved = [bgmSrc("daily"), sfxSrc("ui-click"), bgmSrc(`/assets/user/${"b".repeat(64)}.ogg`)];
  // Then: all requests belong to the package instead of the origin root.
  assert.deepEqual(resolved, [
    "/games/medium/assets/audio/bgm/daily.mp3",
    "/games/medium/assets/audio/sfx/ui-click.mp3",
    `/games/medium/assets/user/${"b".repeat(64)}.ogg`,
  ]);
});
