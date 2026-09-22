import type { Scene, VnScript } from "@vnmaker/content";

/** 원본 바로 뒤에 온전한 사본을 넣는다. 원본의 선택지·다음 씬·엔딩은 그대로 두고, 사본도 같은 곳으로 이어진다. */
export function duplicateScene(script: VnScript, sceneId: string, newId: string): VnScript {
  const scene=script.scenes.find(scene=>scene.id===sceneId);
  if(!scene || script.scenes.some(scene=>scene.id===newId)) throw new Error("복제할 장면 ID를 확인하세요.");
  const copy={...structuredClone(scene),id:newId,chapter:`${scene.chapter||scene.id} · 복사`};
  return {...script,scenes:script.scenes.flatMap(row=>row.id===sceneId?[row,copy]:[row])};
}

export const SCENE_ID = /^[a-zA-Z0-9가-힣][a-zA-Z0-9가-힣_-]{0,63}$/;
/**
 * 현재 장면 뒤에 새 장면을 끼워 넣는다. 출구(선택지·조건 경로·엔딩·다음 씬)는 새 장면으로 옮기고
 * 이전 장면은 새 장면을 가리킨다 — routes 를 이전 장면에 남기면 런타임이 그걸 먼저 타서 새 장면에 닿지 않는다.
 * set·cg·아트 브리프 같은 장면 전용 상태는 새 장면에 복사하지 않는다(set 은 진입 때마다 플래그를 다시 쓴다).
 * 무대 연출(배경·음악·입자·틴트·배치)은 같은 무대가 이어진다고 보고 새 장면이 물려받는다.
 */
export function insertSceneAfter(script: VnScript, scene: Scene, newId: string): { script: VnScript; movedExit: "선택지" | "조건 연결" | "엔딩" | "다음 씬 연결" | null } {
  const { choices, ending, routes, next: nextId, ...rest } = scene;
  const { id: _id, chapter: _chapter, lines: _lines, set: _set, cg: _cg, cgUrl: _cgUrl, artBrief: _brief, ...stage } = rest;
  // 출구가 여럿 섞여 있으면 런타임 우선순위(선택지 > 조건 경로 > 엔딩 > 다음 씬)의 승자만 옮긴다.
  // 조건 경로와 그 폴백 next 는 한 덩어리다 — 경로만 옮기면 어느 조건도 안 맞을 때 새 장면이 막힌다.
  const exit = choices?.length ? { choices } : routes?.length ? { routes, ...(nextId !== undefined ? { next: nextId } : {}) } : ending !== undefined ? { ending } : nextId !== undefined ? { next: nextId } : {};
  const next: Scene = { ...stage, ...exit, id: newId, chapter: "새로운 장면", lines: [{ speaker: null, text: "이곳에서 새로운 이야기가 시작된다." }] };
  const movedExit = choices?.length ? "선택지" : routes?.length ? "조건 연결" : ending !== undefined ? "엔딩" : nextId !== undefined ? "다음 씬 연결" : null;
  return { movedExit, script: { ...script, scenes: script.scenes.flatMap(row => row.id === scene.id ? [{ ...rest, next: newId }, next] : [row]) } };
}
/** 씬 ID를 바꾸고 시작 위치·다음 씬·선택지 연결·에셋의 대상 씬을 함께 갱신한다. 대사·선택지 ID는 씬 안에서만 유효하므로 그대로다. */
export function renameScene(script: VnScript, from: string, to: string): VnScript {
  const scene=script.scenes.find(scene=>scene.id===from);
  if(!scene) throw new Error("이름을 바꿀 장면을 찾을 수 없습니다.");
  if(from===to) return script;
  if(!SCENE_ID.test(to)) throw new Error("씬 ID는 영문·숫자·한글로 시작하는 64자 이하의 영문·숫자·한글·밑줄·하이픈이어야 합니다.");
  if(script.scenes.some(scene=>scene.id===to)) throw new Error("이미 사용 중인 씬 ID입니다.");
  const link=(id:string|undefined)=>id===from?to:id;
  return {
    ...script, start: script.start===from?to:script.start,
    scenes: script.scenes.map(row=>{
      const next=link(row.next);
      return {...row, id: row.id===from?to:row.id, ...(next!==undefined?{next}:{}), ...(row.routes?{routes:row.routes.map(route=>route.next===from?{...route,next:to}:route)}:{}) , ...(row.choices?{choices:row.choices.map(choice=>choice.next===from?{...choice,next:to}:choice)}:{})};
    }),
    ...(script.assets?{assets:script.assets.map(asset=>asset.sceneId===from?{...asset,sceneId:to}:asset)}:{}),
  };
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

type SceneExit = Pick<Scene, "next" | "choices" | "ending" | "routes">;
/** 씬 종료를 직접 출구(엔딩/다음 씬)로 바꾼다 — 남은 선택지·조건 경로가 고른 출구를 덮지 않게 함께 지운다. */
export function directSceneExit(scene: Scene, value: string): Scene {
  const { choices: _choices, next: _next, ending: _ending, routes: _routes, ...rest } = scene;
  return { ...rest, ...(value === "ending" ? { ending: scene.chapter || "이야기의 끝" } : { next: value }) };
}
/** 선택지를 하나 단다 — 엔딩·다음 씬·조건 경로는 지워 런타임 출구 우선순위(선택지 > 조건 경로 > 엔딩 > 다음)와 맞춘다. */
export function appendChoice(scene: Scene, target: string): Scene {
  const { ending: _ending, next: _next, routes: _routes, ...rest } = scene;
  return { ...rest, choices: [...(scene.choices ?? []), { text: "새로운 선택", next: target }] };
}
function removalRouting(script: VnScript, sceneId: string, replacement: string): { inheritExit?: SceneExit; choiceTarget?: string; routeTarget?: string } {
  const removed = script.scenes.find(scene => scene.id === sceneId);
  const chosen = script.scenes.find(scene => scene.id === replacement);
  if (script.scenes.length < 2 || replacement === sceneId || !removed || !chosen) throw new Error("삭제 후 연결할 다른 장면을 선택하세요.");
  const branches = chosen.choices?.length ? chosen.choices : undefined;
  if (branches?.some(choice => choice.next === sceneId)) {
    // A branch can skip a linear bridge, but cannot contain another menu/ending
    // without inventing a scene or changing the other branches' meaning.
    // 조건 경로가 섞인 장면은 선형 다리가 아니라 건너뛸 수 없다.
    if (removed.choices?.length || removed.routes?.length || removed.ending || !removed.next) throw new Error("이 장면의 선택지가 자기 자신으로 돌아오게 됩니다. 다른 연결 대상을 선택하세요.");
    if (removed.next === sceneId || removed.next === replacement) throw new Error("삭제 후 선택지가 자기 자신으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
    return { choiceTarget: removed.next };
  }
  if (!branches && !chosen.ending && chosen.next === sceneId) {
    // 이어받기는 출구 전체를 교체한다 — 선택한 장면에 다른 조건 경로가 남아 있으면 같이 지워진다.
    if (chosen.routes?.length) throw new Error("선택한 장면에 조건 경로가 있어 출구를 이어받으면 그 경로가 사라집니다. 다른 연결 대상을 선택하세요.");
    if (removed.choices?.length) {
      if (removed.choices.some(choice => choice.next === sceneId || choice.next === replacement)) throw new Error("삭제 장면의 분기가 다시 이 장면으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
      return { inheritExit: { choices: structuredClone(removed.choices) } };
    }
    if (removed.ending) return { inheritExit: { ending: removed.ending } };
    if (removed.routes?.length || removed.next) {
      if (removed.next === sceneId || removed.next === replacement || (removed.routes ?? []).some(route => route.next === sceneId || route.next === replacement)) {
        throw new Error("삭제 후 연결이 자기 자신으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
      }
      // 조건 경로와 그 폴백 next 는 한 덩어리로 물려준다.
      return { inheritExit: { ...(removed.routes?.length ? { routes: structuredClone(removed.routes) } : {}), ...(removed.next ? { next: removed.next } : {}) } };
    }
    throw new Error("이어받을 다음 장면이나 엔딩이 없습니다. 다른 연결 대상을 선택하세요.");
  }
  // 선택한 장면의 조건 경로가 삭제 장면을 가리키면 선형 다리(next 만 있는 장면)만 건너뛸 수 있다.
  if (chosen.routes?.some(route => route.next === sceneId)) {
    if (removed.choices?.length || removed.routes?.length || removed.ending || !removed.next || removed.next === sceneId || removed.next === replacement) {
      throw new Error("삭제 후 조건 경로가 자기 자신으로 돌아옵니다. 다른 연결 대상을 선택하세요.");
    }
    return { routeTarget: removed.next };
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
        const { choices: _choices, next: _next, ending: _ending, routes: _routes, ...body } = scene;
        return { ...body, ...routing.inheritExit };
      }
      const { next: previousNext, ...body } = scene;
      // With a menu/ending, `next` was inactive. Remove this stale field if it
      // would become a self-loop, preserving the effective menu/ending.
      const next = previousNext === sceneId ? scene.id === replacement ? undefined : replacement : previousNext;
      return {
        ...body, ...(next !== undefined ? { next } : {}),
        // choiceTarget 과 routeTarget 은 둘 다 "다리 장면의 출구"다 — 선택지·조건 경로가 같이
        // 삭제 장면을 가리키면 choiceTarget 만 채워지므로 둘 다 거기로 돌린다.
        ...(scene.routes ? { routes: scene.routes.map(route => route.next === sceneId ? { ...route, next: scene.id === replacement ? (routing.routeTarget ?? routing.choiceTarget)! : replacement } : route) } : {}),
        ...(scene.choices ? { choices: scene.choices.map(choice => choice.next === sceneId ? { ...choice, next: scene.id === replacement ? routing.choiceTarget! : replacement } : choice) } : {}),
      };
    }),
    ...(script.assets ? { assets: script.assets.map(asset => { if (asset.sceneId !== sceneId) return asset; const { sceneId: _scene, ...rest } = asset; return rest; }) } : {}),
  };
}
