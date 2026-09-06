import { parseScript, validCharacterKey, type Character, type SpriteDirection, type VnScript } from "@vnmaker/content";

export function addCharacter(script:VnScript,id:string,name:string):VnScript {
  if(!validCharacterKey(id))throw new Error("ID는 영문자로 시작하는 64자 이하의 영문·숫자·하이픈·밑줄을 사용하세요.");
  if(script.characters.some(actor=>actor.id===id))throw new Error("이미 사용 중인 캐릭터 ID입니다.");
  return parseScript({...script,characters:[...script.characters,{id,name:name.trim(),bio:"",color:"#b6d7e8",expressionImages:{}}]});
}
export function updateCharacter(script:VnScript,next:Character):VnScript { return parseScript({...script,characters:script.characters.map(actor=>actor.id===next.id?next:actor)}); }
/** The confirmation UI explicitly describes conversion to narration and actor exits. */
export function removeCharacter(script:VnScript,id:string):VnScript {
  const remove=(rows:readonly SpriteDirection[]|undefined)=>rows?.map(row=>row.character===id?{slot:row.slot,character:null}:row);
  return parseScript({...script,characters:script.characters.filter(actor=>actor.id!==id),
    scenes:script.scenes.map(scene=>({...scene,...(scene.sprites?{sprites:remove(scene.sprites)}:{}),lines:scene.lines.map(line=>{
      const {expression,...body}=line;
      return {...(line.speaker===id?{...body,speaker:null}:line),...(line.sprites?{sprites:remove(line.sprites)}:{})};
    })})),
    ...(script.assets?{assets:script.assets.map(asset=>{if(asset.characterId!==id)return asset;const {characterId,...rest}=asset;return rest;})}:{}),
  });
}
