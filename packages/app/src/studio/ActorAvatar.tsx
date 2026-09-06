import { characterImage, type VnScript } from "@vnmaker/content";
import { ArtImage } from "../components/ArtImage.js";
export function ActorAvatar({script,id}:{script:VnScript;id:string|null}){
  const actor=script.characters.find(actor=>actor.id===id);
  const source=characterImage(actor);
  return source?<ArtImage src={source} chromaKey={actor?.chromaKey} alt=""/>:<span className="narration-symbol">{actor?actor.name.slice(0,1):id==="me"?"나":"T"}</span>;
}
