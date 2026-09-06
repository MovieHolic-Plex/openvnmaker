import assert from "node:assert/strict";
import { auditScript, choiceAllowed, type VnScript } from "@vnmaker/content";
import { assertNever, canonicalHash, canonicalJson } from "@vnmaker/harness";
import { reduce } from "../../../packages/app/src/engine/reducer.js";
import { initialState } from "../../../packages/app/src/engine/types.js";
import { byteHash, mediaInventory } from "./media.js";
import type { RouteExpectation } from "./oracle.js";

/** Actual observations use the existing player. Expected values never do. */
export function assertRoute(script: VnScript, expected: RouteExpectation, mode: "advance" | "skipScene" = "skipScene") {
  const scenes = new Map(script.scenes.map(scene => [scene.id, scene]));
  const identities = new Map(script.scenes.flatMap(scene => [
    ...scene.lines.map(line => [`${scene.id}\0${line.text}`, `${scene.id}/line/${line.id}`] as const),
    ...(scene.choices ?? []).map(choice => [`${scene.id}\0\u25b7 ${choice.text}`, `${scene.id}/choice/${choice.id}`] as const),
  ]));
  let state = reduce(script, initialState(script), { type: "start" });
  const visited: string[] = [];
  const choices: { readonly sceneId: string; readonly choiceId: string }[] = [];
  for (let actions = 0; state.phase !== "ending" && actions < 6100; actions++) {
    assert.equal(state.error, null, `ROUTE_RUNTIME:${expected.id}`);
    const scene = scenes.get(state.sceneId);
    assert.ok(scene, `ROUTE_SCENE:${state.sceneId}`);
    switch (state.phase) {
      case "scene":
        if (visited.at(-1) !== state.sceneId) visited.push(state.sceneId);
        state = reduce(script, state, { type: mode });
        break;
      case "choice": {
        const selection = expected.choices[choices.length];
        assert.ok(selection, "UNEXPECTED_CHOICE");
        assert.equal(scene.id, selection.sceneId, "CHOICE_SCENE");
        assert.deepEqual(scene.choices?.filter(choice => choiceAllowed(choice, state.flags)).map(choice => choice.id),
          expected.menus[choices.length], `ROUTE_MENU:${expected.id}`);
        const index = scene.choices?.findIndex(choice => choice.id === selection.choiceId) ?? -1;
        const choice = scene.choices?.[index];
        assert.ok(choice && choiceAllowed(choice, state.flags), "CHOICE_AVAILABLE");
        choices.push({ sceneId: scene.id, choiceId: selection.choiceId });
        state = reduce(script, state, { type: "choose", index });
        break;
      }
      case "title": assert.fail("UNEXPECTED_TITLE");
      default: assertNever(state.phase);
    }
  }
  assert.equal(state.phase, "ending", `ROUTE_FINITE:${expected.id}`);
  assert.equal(state.endingTitle, expected.ending, `ROUTE_ENDING:${expected.id}`);
  assert.equal(state.sceneId, expected.endingSceneId, `ROUTE_ENDING_SCENE:${expected.id}`);
  assert.deepEqual(state.flags, expected.flags, `ROUTE_FLAGS:${expected.id}`);
  assert.deepEqual(visited, expected.visitedSceneIds, `ROUTE_VISITED:${expected.id}`);
  assert.deepEqual(choices, expected.choices, `ROUTE_CHOICES:${expected.id}`);
  const historyIds = state.history.map(entry => identities.get(`${entry.sceneId}\0${entry.text}`));
  assert.deepEqual(historyIds, expected.historyIds, `ROUTE_HISTORY:${expected.id}`);
  return { id: expected.id, ending: state.endingTitle, flags: state.flags, visitedSceneIds: visited,
    choices, historyCount: historyIds.length, historyHash: byteHash(Buffer.from(JSON.stringify(historyIds))) };
}

export async function assertInventory(script: VnScript) {
  const counts = { scenes: script.scenes.length, lines: script.scenes.reduce((sum, scene) => sum + scene.lines.length, 0),
    characters: script.characters.length, endings: script.scenes.filter(scene => scene.ending).length,
    artwork: script.assets?.length ?? 0, audio: script.audioAssets?.length ?? 0 };
  assert.deepEqual(counts, { scenes: 80, lines: 6000, characters: 8, endings: 3, artwork: 120, audio: 20 }, "MEDIUM_EXACT_COUNTS");
  assert.deepEqual(auditScript(script).filter(issue => issue.severity === "error"), [], "MEDIUM_GRAPH");
  const assets = [...(script.assets ?? []), ...(script.audioAssets ?? [])];
  const inventory = mediaInventory();
  assert.deepEqual(assets.map(asset => asset.url.slice(1)).sort(), inventory.map(asset => asset.path).sort(), "ASSET_INVENTORY");
  assert.equal(new Set(inventory.map(asset => asset.hash)).size, 140, "UNIQUE_MEDIA_PAYLOADS");
  const references = new Set([
    ...script.scenes.flatMap(scene => [scene.backgroundUrl, scene.bgm]),
    ...script.characters.flatMap(character => Object.values(character.expressionImages ?? {})),
  ]);
  assert.deepEqual([...references].sort(), assets.map(asset => asset.url).sort(), "ALL_ASSETS_REFERENCED");
  const mediaBytes = inventory.reduce((sum, asset) => sum + asset.bytes.length, 0);
  assert.ok(mediaBytes < 400 * 1024 * 1024, "MEDIA_UNDER_400_MIB");
  const scriptHash = await canonicalHash(script);
  assert.equal(scriptHash, byteHash(Buffer.from(canonicalJson(script))), "SHA256_CANONICAL_BYTES");
  return { counts, scriptHash, mediaBytes, inventory: inventory.map(({ bytes, ...asset }) => ({ ...asset, size: bytes.length })) };
}
