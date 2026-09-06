import type { Scene, VnScript } from "@vnmaker/content";

export function duplicateScene(script: VnScript, sceneId: string, newId: string): VnScript {
  const scene=script.scenes.find(scene=>scene.id===sceneId);
  if(!scene || script.scenes.some(scene=>scene.id===newId)) throw new Error("복제할 장면 ID를 확인하세요.");
  const copy={...structuredClone(scene),id:newId,chapter:`${scene.chapter||scene.id} · 복사`};
  const {choices:_choices,ending:_ending,...original}=scene;
  return {...script,scenes:script.scenes.flatMap(row=>row.id===sceneId?[{...original,next:newId},copy]:[row])};
}

/** Changing outline order does not implicitly rewrite a branching story. */
export function moveScene(script: VnScript, sceneId: string, toIndex: number): VnScript {
  const from=script.scenes.findIndex(scene=>scene.id===sceneId);
  if(from<0) throw new Error("이동할 장면이 없습니다.");
  const to=Math.max(0,Math.min(script.scenes.length-1,toIndex));
  if(from===to)return script;
  const scenes=[...script.scenes]; const [scene]=scenes.splice(from,1);scenes.splice(to,0,scene!);
  return {...script,scenes};
}

type SceneExit = Pick<Scene, "next" | "choices" | "ending">;
function removalRouting(script: VnScript, sceneId: string, replacement: string): { inheritExit?: SceneExit; choiceTarget?: string } {
  const removed = script.scenes.find(scene => scene.id === sceneId);
  const chosen = script.scenes.find(scene => scene.id === replacement);
  if (script.scenes.length < 2 || replacement === sceneId || !removed || !chosen) throw new Error("삭제 후 연결할 다른 장면을 선택하세요.");
  const branches = chosen.choices?.length ? chosen.choices : undefined;
  if (branches?.some(choice => choice.next === sceneId)) {
    // A branch can skip a linear bridge, but cannot contain another menu/ending
    // without inventing a scene or changing the other branches' meaning.
    if (removed.choices?.length || removed.ending || !removed.next) throw new Error("이 장면의 선택지가 자기 자신으로 돌아오게 됩니다. 다른 연결 대상을 선택하세요.");
    if (removed.next === sceneId || removed.next === replacement) throw new Error("삭제 후 선택지가 자기 자신으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
    return { choiceTarget: removed.next };
  }
  if (!branches && !chosen.ending && chosen.next === sceneId) {
    if (removed.choices?.length) {
      if (removed.choices.some(choice => choice.next === sceneId || choice.next === replacement)) throw new Error("삭제 장면의 분기가 다시 이 장면으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
      return { inheritExit: { choices: structuredClone(removed.choices) } };
    }
    if (removed.ending) return { inheritExit: { ending: removed.ending } };
    if (removed.next && removed.next !== sceneId && removed.next !== replacement) return { inheritExit: { next: removed.next } };
    throw new Error("이어받을 다음 장면이나 엔딩이 없습니다. 다른 연결 대상을 선택하세요.");
  }
  return {};
}

/** Explain candidates that would introduce a direct self-loop before committing. */
export function sceneRemovalIssue(script: VnScript, sceneId: string, replacement: string): string | null {
  try { removalRouting(script, sceneId, replacement); return null; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Retarget incoming links. When the selected replacement points to the deleted
 * scene itself, splice that scene's exit instead of creating a new self-loop. */
export function removeScene(script: VnScript, sceneId: string, replacement: string): VnScript {
  const routing = removalRouting(script, sceneId, replacement);
  return {
    ...script, start: script.start === sceneId ? replacement : script.start,
    scenes: script.scenes.filter(scene => scene.id !== sceneId).map(scene => {
      if (scene.id === replacement && routing.inheritExit) {
        const { choices: _choices, next: _next, ending: _ending, ...body } = scene;
        return { ...body, ...routing.inheritExit };
      }
      const { next: previousNext, ...body } = scene;
      // With a menu/ending, `next` was inactive. Remove this stale field if it
      // would become a self-loop, preserving the effective menu/ending.
      const next = previousNext === sceneId ? scene.id === replacement ? undefined : replacement : previousNext;
      return {
        ...body, ...(next !== undefined ? { next } : {}),
        ...(scene.choices ? { choices: scene.choices.map(choice => choice.next === sceneId ? { ...choice, next: scene.id === replacement ? routing.choiceTarget! : replacement } : choice) } : {}),
      };
    }),
    ...(script.assets ? { assets: script.assets.map(asset => { if (asset.sceneId !== sceneId) return asset; const { sceneId: _scene, ...rest } = asset; return rest; }) } : {}),
  };
}
