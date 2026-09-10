import { parseScript, type LineCondition, type MediaProvenance, type SpriteDirection, type VnScript } from "@vnmaker/content";
import { canonicalHash, parseReleaseSnapshot, type ReleaseSnapshot } from "@vnmaker/harness";
import { collectProjectAssets } from "./exportBundle.js";
import type { ProjectRepository } from "./projectRepository.js";
import { ProjectStorageError } from "./projects.js";

export type ReadAssetBytes = (path: string) => Promise<Uint8Array | undefined>;

export type FreezeReleaseSnapshotInput = {
  readonly repository: ProjectRepository;
  readonly readAssetBytes: ReadAssetBytes;
};

const EXPORTER_VERSION = "1";
const RUNTIME_VERSION = "1";

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Public game projection: allowlist playable fields and public credit; drop authoring-only metadata. */
export function projectPublicScript(script: VnScript): VnScript {
  return parseScript({
    title: script.title,
    subtitle: script.subtitle,
    start: script.start,
    characters: script.characters.map(character => ({
      id: character.id,
      name: character.name,
      color: character.color,
      bio: character.bio,
      ...(character.outfits === undefined ? {} : { outfits: [...character.outfits] }),
      ...(character.expressionImages === undefined ? {} : { expressionImages: { ...character.expressionImages } }),
      ...(character.chromaKey === undefined ? {} : { chromaKey: character.chromaKey }),
    })),
    scenes: script.scenes.map(scene => ({
      id: scene.id,
      background: scene.background,
      lines: scene.lines.map(line => ({
        speaker: line.speaker,
        text: line.text,
        ...(line.id === undefined ? {} : { id: line.id }),
        ...(line.expression === undefined ? {} : { expression: line.expression }),
        ...(line.sfx === undefined ? {} : { sfx: line.sfx }),
        ...(line.voice === undefined ? {} : { voice: line.voice }),
        ...(line.shake === undefined ? {} : { shake: line.shake }),
        ...(line.cgHide === undefined ? {} : { cgHide: line.cgHide }),
        ...(line.cgUrl === undefined ? {} : { cgUrl: line.cgUrl }),
        ...(line.backgroundUrl === undefined ? {} : { backgroundUrl: line.backgroundUrl }),
        ...(line.when === undefined ? {} : { when: projectWhen(line.when) }),
        ...(line.sprites === undefined ? {} : { sprites: line.sprites.map(projectSprite) }),
        ...(line.framing === undefined ? {} : { framing: line.framing }),
        ...(line.bgm === undefined ? {} : { bgm: line.bgm }),
      })),
      ...(scene.chapter === undefined ? {} : { chapter: scene.chapter }),
      ...(scene.backgroundUrl === undefined ? {} : { backgroundUrl: scene.backgroundUrl }),
      ...(scene.cgUrl === undefined ? {} : { cgUrl: scene.cgUrl }),
      ...(scene.hideSprites === undefined ? {} : { hideSprites: scene.hideSprites }),
      ...(scene.framing === undefined ? {} : { framing: scene.framing }),
      ...(scene.bgm === undefined ? {} : { bgm: scene.bgm }),
      ...(scene.cg === undefined ? {} : { cg: scene.cg }),
      ...(scene.transition === undefined ? {} : { transition: scene.transition }),
      ...(scene.sprites === undefined ? {} : { sprites: scene.sprites.map(projectSprite) }),
      ...(scene.choices === undefined ? {} : {
        choices: scene.choices.map(choice => ({
          text: choice.text,
          next: choice.next,
          ...(choice.id === undefined ? {} : { id: choice.id }),
          ...(choice.affection === undefined ? {} : { affection: choice.affection }),
          ...(choice.cond === undefined ? {} : { cond: choice.cond }),
          ...(choice.when === undefined ? {} : { when: projectWhen(choice.when) }),
          ...(choice.set === undefined ? {} : { set: { ...choice.set } }),
          ...(choice.add === undefined ? {} : { add: { ...choice.add } }),
          ...(choice.disable === undefined ? {} : { disable: choice.disable }),
        })),
      }),
      ...(scene.next === undefined ? {} : { next: scene.next }),
      ...(scene.ending === undefined ? {} : { ending: scene.ending }),
    })),
    ...(script.nativeSaveId === undefined ? {} : { nativeSaveId: script.nativeSaveId }),
    ...(script.credits === undefined ? {} : {
      credits: script.credits.map(credit => ({ role: credit.role, names: credit.names })),
    }),
    ...(script.flags === undefined ? {} : { flags: { ...script.flags } }),
    ...(script.musicFadeSeconds === undefined ? {} : { musicFadeSeconds: script.musicFadeSeconds }),
    ...(script.assets === undefined ? {} : {
      assets: script.assets.map(asset => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        url: asset.url,
        ...(asset.compositing === undefined ? {} : { compositing: asset.compositing }),
        ...(asset.provenance === undefined ? {} : { provenance: projectProvenance(asset.provenance) }),
        ...(asset.sceneId === undefined ? {} : { sceneId: asset.sceneId }),
        ...(asset.characterId === undefined ? {} : { characterId: asset.characterId }),
        ...(asset.expression === undefined ? {} : { expression: asset.expression }),
      })),
    }),
    ...(script.audioAssets === undefined ? {} : {
      audioAssets: script.audioAssets.map(asset => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        url: asset.url,
        duration: asset.duration,
        ...(asset.provenance === undefined ? {} : { provenance: projectProvenance(asset.provenance) }),
      })),
    }),
  });
}

function projectProvenance(provenance: MediaProvenance): MediaProvenance {
  return {
    ...(provenance.creator === undefined ? {} : { creator: provenance.creator }),
    ...(provenance.source === undefined ? {} : { source: provenance.source }),
    ...(provenance.license === undefined ? {} : { license: provenance.license }),
    ...(provenance.credit === undefined ? {} : { credit: provenance.credit }),
  };
}

function projectSprite(sprite: SpriteDirection): SpriteDirection {
  return {
    slot: sprite.slot,
    character: sprite.character,
    ...(sprite.expression === undefined ? {} : { expression: sprite.expression }),
    ...(sprite.poseUrl === undefined ? {} : { poseUrl: sprite.poseUrl }),
  };
}

function projectWhen(when: LineCondition): LineCondition {
  return {
    ...(when.all === undefined ? {} : { all: [...when.all] }),
    ...(when.none === undefined ? {} : { none: [...when.none] }),
    ...(when.compare === undefined ? {} : {
      compare: when.compare.map(rule => ({ flag: rule.flag, op: rule.op, value: rule.value })),
    }),
  };
}

/** Capture the flushed head, pin it across async asset reads, and emit a deterministic public release. */
export async function freezeReleaseSnapshot(input: FreezeReleaseSnapshotInput): Promise<ReleaseSnapshot> {
  if (input.repository.dirty) throw new ProjectStorageError("stale-head");
  const source = input.repository.snapshot;
  const assets = [];
  for (const path of collectProjectAssets(source.script)) {
    const bytes = await input.readAssetBytes(path);
    if (bytes === undefined) throw new ProjectStorageError("missing");
    const hash = await sha256Hex(bytes);
    if (path.startsWith("/assets/user/")) {
      const digest = path.split("/").at(-1)?.split(".")[0];
      if (digest !== hash) throw new ProjectStorageError("damaged");
    }
    assets.push({ path: path.slice(1), hash, size: bytes.byteLength });
  }
  const publicScript = projectPublicScript(source.script);
  const [sourceScriptHash, publicScriptHash, headDigest] = await Promise.all([
    canonicalHash(source.script),
    canonicalHash(publicScript),
    canonicalHash(source.head),
  ]);
  const approval = { kind: "manual-export" as const, headDigest };
  const identity = {
    kind: "release" as const,
    sourceHead: source.head,
    sourceScriptHash,
    publicScriptHash,
    assets,
    approval,
    exporterVersion: EXPORTER_VERSION,
    runtimeVersion: RUNTIME_VERSION,
  };
  return parseReleaseSnapshot({
    ...identity,
    publicScript,
    releaseId: await canonicalHash(identity),
  });
}
