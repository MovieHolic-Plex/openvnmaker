import { applyChoiceFlags, choiceAllowed, choiceEffectError, lineAllowed } from "../../content/src/index.js";
import type { StoryFlags, VnScript } from "../../content/src/index.js";
import { canonicalJson } from "./canonical.js";
import { countCharacters } from "./production-duration.js";
import type { RouteDistinguishing, RoutePathReport } from "./validation-contracts.js";

export type BrokenLink = { readonly sceneId: string; readonly target: string };
export type WalkedPath = {
  readonly pathId: string;
  readonly sceneIds: readonly string[];
  readonly flags: StoryFlags;
  readonly endingId: string | null;
  readonly endingTitle: string | null;
  readonly characterCount: number;
  readonly lineTexts: readonly string[];
};

export type RouteWalk = {
  readonly exceededBound: boolean;
  readonly unverifiedPaths: readonly string[];
  readonly paths: readonly WalkedPath[];
  readonly brokenLinks: readonly BrokenLink[];
  readonly closedChoiceScenes: readonly string[];
  readonly effectErrors: readonly BrokenLink[];
  readonly deadEnds: readonly string[];
};

type Frame = {
  readonly id: string;
  readonly flags: StoryFlags;
  readonly chars: number;
  readonly scenes: readonly string[];
  readonly texts: readonly string[];
};

function pathKey(id: string, flags: StoryFlags): string {
  return `${id}:${canonicalJson(flags)}`;
}

function enqueue(
  queue: Frame[], written: ReadonlySet<string>, planned: ReadonlySet<string>, brokenLinks: BrokenLink[],
  sceneId: string, target: string, flags: StoryFlags, chars: number, scenes: readonly string[], texts: readonly string[],
): void {
  if (written.has(target)) {
    queue.push({ id: target, flags, chars, scenes, texts });
    return;
  }
  if (!planned.has(target)) brokenLinks.push({ sceneId, target });
}

export function walkRoutes(
  script: VnScript,
  planned: ReadonlySet<string>,
  bound: number,
): RouteWalk {
  const byId = new Map(script.scenes.map(scene => [scene.id, scene]));
  const written = new Set(script.scenes.map(scene => scene.id));
  const queue: Frame[] = [{ id: script.start, flags: script.flags ?? {}, chars: 0, scenes: [], texts: [] }];
  const seen = new Set<string>();
  const paths: WalkedPath[] = [];
  const brokenLinks: BrokenLink[] = [];
  const closedChoiceScenes: string[] = [];
  const effectErrors: BrokenLink[] = [];
  const deadEnds: string[] = [];
  const unverifiedPaths: string[] = [];
  let exceededBound = false;
  for (let index = 0; index < queue.length; index += 1) {
    if (seen.size >= bound) {
      exceededBound = true;
      for (let rest = index; rest < queue.length; rest += 1) {
        const frame = queue[rest];
        if (frame !== undefined) unverifiedPaths.push(`unverified:${pathKey(frame.id, frame.flags)}`);
      }
      break;
    }
    const state = queue[index];
    if (state === undefined) continue;
    const key = pathKey(state.id, state.flags);
    if (seen.has(key)) continue;
    seen.add(key);
    const scene = byId.get(state.id);
    if (scene === undefined) {
      brokenLinks.push({ sceneId: state.scenes[state.scenes.length - 1] ?? state.id, target: state.id });
      continue;
    }
    const lines = scene.lines.filter(line => lineAllowed(line, state.flags));
    const chars = state.chars + lines.reduce((sum, line) => sum + countCharacters(line.text), 0);
    const texts = [...state.texts, ...lines.map(line => line.text)];
    const scenes = [...state.scenes, scene.id];
    if (scene.choices?.length) {
      for (const choice of scene.choices) {
        const error = choiceEffectError(choice, state.flags);
        if (error !== undefined && !choice.disable) {
          effectErrors.push({ sceneId: scene.id, target: choice.next });
        }
      }
      const available = scene.choices.filter(choice => choiceAllowed(choice, state.flags));
      if (!available.length) closedChoiceScenes.push(scene.id);
      for (const choice of available) {
        enqueue(queue, written, planned, brokenLinks, scene.id, choice.next,
          applyChoiceFlags(state.flags, choice), chars, scenes, texts);
      }
      continue;
    }
    if (scene.ending !== undefined) {
      paths.push({
        pathId: scenes.join(">"), sceneIds: scenes, flags: state.flags, endingId: scene.id,
        endingTitle: scene.ending, characterCount: chars, lineTexts: texts,
      });
      continue;
    }
    if (scene.next === undefined) {
      deadEnds.push(scene.id);
      continue;
    }
    enqueue(queue, written, planned, brokenLinks, scene.id, scene.next, state.flags, chars, scenes, texts);
  }
  return {
    exceededBound, unverifiedPaths, paths, brokenLinks, closedChoiceScenes, effectErrors, deadEnds,
  };
}

export function routeReports(walk: RouteWalk, charsPerMinute: number): readonly RoutePathReport[] {
  return walk.paths.map(path => {
    const dialogueFingerprint = canonicalJson(path.lineTexts);
    const outcomeFingerprint = canonicalJson({
      flags: path.flags, endingTitle: path.endingTitle, dialogue: path.lineTexts,
    });
    return {
      pathId: path.pathId, sceneIds: path.sceneIds, flags: path.flags, endingId: path.endingId,
      endingTitle: path.endingTitle, characterCount: path.characterCount,
      estimatedMinutes: charsPerMinute > 0 ? path.characterCount / charsPerMinute : null,
      dialogueFingerprint, outcomeFingerprint,
    };
  });
}

export function distinguishingOf(paths: readonly RoutePathReport[]): RouteDistinguishing {
  if (paths.length < 2) return "none";
  const flags = new Set(paths.map(path => canonicalJson(path.flags)));
  const dialogues = new Set(paths.map(path => path.dialogueFingerprint));
  const endings = new Set(paths.map(path => path.endingTitle ?? ""));
  if (flags.size > 1 || dialogues.size > 1) return "conditions-and-dialogue";
  if (endings.size > 1) return "ending-count-only";
  return "none";
}
