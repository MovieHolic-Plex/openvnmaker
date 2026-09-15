import { characterImage, type Character, type VnScript } from "@vnmaker/content";
import { ArtImage } from "../components/ArtImage.js";
/** `actor` 를 직접 주면 원고 전체를 받지 않아도 되어 대사 줄 목록이 memo 로 건너뛸 수 있다. */
export function ActorAvatar({script,actor:given,id}:{script?:VnScript;actor?:Character|undefined;id:string|null}){
  const actor=given??script?.characters.find(actor=>actor.id===id);
  const source=characterImage(actor);
  return source?<ArtImage src={source} chromaKey={actor?.chromaKey} alt=""/>:<span className="narration-symbol">{actor?actor.name.slice(0,1):id==="me"?"나":"T"}</span>;
}
