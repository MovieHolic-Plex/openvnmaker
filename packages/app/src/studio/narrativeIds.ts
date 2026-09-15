import type {VnScript} from "@vnmaker/content";

/**
 * Preserve existing identities; new or copied entries receive fresh scene-local IDs.
 * `previous` 를 주면 그 원고에 그대로 남아 있는 씬(같은 객체)은 이미 검사한 것으로 보고 건너뛴다 —
 * 키 입력 한 번에 바뀌는 씬은 하나뿐인데 장편 전체의 줄을 다시 훑을 이유가 없다.
 */
export function withNarrativeIds(script:VnScript,createId:()=>string=()=>crypto.randomUUID(),previous?:VnScript):VnScript {
  let changed=false;
  const settled=previous?new Map(previous.scenes.map(scene=>[scene.id,scene])):undefined;
  const scenes=script.scenes.map(scene=>{
    if(settled?.get(scene.id)===scene)return scene;
    let sceneChanged=false;
    function identify<T extends {readonly id?:string}>(items:readonly T[]):readonly T[]{
      const used=new Set<string>(),reserved=new Set(items.flatMap(item=>item.id?[item.id]:[]));
      return items.map(item=>{
        if(item.id && !used.has(item.id)){used.add(item.id);return item;}
        let id="";
        for(let attempt=0;attempt<100;attempt++){id=createId();if(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(id)&&!reserved.has(id)&&!used.has(id))break;id="";}
        if(!id)throw new Error("새 대사 식별자를 만들지 못했습니다.");
        used.add(id);sceneChanged=true;return {...item,id};
      });
    }
    const lines=identify(scene.lines),choices=scene.choices?identify(scene.choices):undefined;
    if(!sceneChanged)return scene;
    changed=true;return {...scene,lines,...(choices?{choices}:{})};
  });
  return changed?{...script,scenes}:script;
}
