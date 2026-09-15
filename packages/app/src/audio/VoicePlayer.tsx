import {useEffect,useRef,useState} from "react";
import {assetUrl} from "../assetUrl.js";
export function VoicePlayer({source,cue,volume,paused,unlocked,onDone}:{source:string|undefined;cue:string;volume:number;paused:boolean;unlocked:boolean;onDone:(cue:string)=>void}){
  const ref=useRef<HTMLAudioElement>(null),done=useRef(onDone);done.current=onDone;
  const [error,setError]=useState(false);
  useEffect(()=>{const audio=ref.current;if(!audio)return;audio.pause();setError(false);audio.currentTime=0;
    const finish=()=>done.current(cue),failed=()=>{setError(true);finish();};audio.addEventListener("ended",finish);audio.addEventListener("error",failed);
    return ()=>{audio.pause();audio.removeEventListener("ended",finish);audio.removeEventListener("error",failed);};
  },[source,cue]);
  useEffect(()=>{const audio=ref.current;if(!audio)return;let cancelled=false;if(!source||paused||!unlocked)audio.pause();else void audio.play().catch(error=>{if(!cancelled&&error.name!=="AbortError"){setError(true);done.current(cue);}});return()=>{cancelled=true;};},[source,cue,paused,unlocked]);
  useEffect(()=>{if(ref.current)ref.current.volume=Math.max(0,Math.min(1,volume));},[volume]);
  return <><audio ref={ref} data-testid="voice-audio" preload="auto" {...(source?{src:assetUrl(source)}:{})}/>{error&&<span role="status" className="voice-playback-error">보이스 파일을 재생하지 못했습니다.</span>}</>;
}
