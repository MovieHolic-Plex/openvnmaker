import {useRef,useState} from "react";
import type {AudioAsset,VnScript} from "@vnmaker/content";
import {importAudio} from "../storage/projectAudio.js";
import "./audio-library.css";
import {MediaProvenanceEditor} from "./MediaProvenanceEditor.js";
import {removeUnreferencedAssets} from "./assetCleanup.js";
import {audioInUse} from "./assets.js";
import {readActiveProjectId} from "./projects.js";
import {LosiaAssetPublish} from "./LosiaAssetPublish.js";
import {StorePanel} from "./StorePanel.js";
export function AudioOptions({script,kind,current}:{script:VnScript;kind:AudioAsset["kind"];current?:string|undefined}){
  const rows=script.audioAssets?.filter(asset=>asset.kind===kind)??[];
  return <>{current?.startsWith("/assets/user/")&&!rows.some(asset=>asset.url===current)&&<option value={current}>현재 지정된 음원</option>}<optgroup label="내 음원">{rows.map(asset=><option key={asset.id} value={asset.url}>{asset.name}</option>)}</optgroup></>;
}
export function AudioLibrary({script,onChange,projectEpoch=0,undoTrail}:{script:VnScript;onChange:(script:VnScript)=>void;projectEpoch?:number|undefined;undoTrail?:readonly VnScript[]|undefined}){
  const [kind,setKind]=useState<AudioAsset["kind"]>("bgm"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [query,setQuery]=useState(""),[page,setPage]=useState(0);
  const [libraryOpen,setLibraryOpen]=useState(false);
  const [storeOpen,setStoreOpen]=useState(false);
  const matching=(script.audioAssets??[]).filter(asset=>asset.name.toLowerCase().includes(query.toLowerCase()));
  const lastPage=Math.max(0,Math.ceil(matching.length/40)-1),activePage=Math.min(page,lastPage);
  const input=useRef<HTMLInputElement>(null),latest=useRef(script);latest.current=script;
  const used=(url:string)=>audioInUse(script,url);
  async function add(files:FileList|null){if(!files?.length)return;const before=script;setBusy(true);setError("");try{
    if((script.audioAssets?.length??0)+files.length>5000)throw new Error("음원은 최대 5,000개까지 등록할 수 있습니다.");
    const rows=await importAudio(Array.from(files));
    if(latest.current!==before){
      // 보관은 이미 커밋됐다 — 아무도 참조하지 않는 업로드만 정리한다(같은 해시 파일을 다른 작품이 쓰면 남는다).
      await removeUnreferencedAssets(rows.map(row=>row.path),{id:readActiveProjectId(),script:latest.current}).catch(()=>({removed:[],kept:[]}));
      throw new Error("가져오는 동안 작품이 변경됐습니다. 파일은 현재 작품에 적용하지 않고 보관함에서 정리했습니다. 다시 등록하세요.");
    }
    onChange({...script,audioAssets:[...(script.audioAssets??[]),...rows.map(row=>({id:crypto.randomUUID(),name:row.originalName,kind,url:row.path,duration:row.duration}))]});
  }catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);if(input.current)input.current.value="";}}
  /** 목록에서 빼고, 어떤 작품·버전도 더 쓰지 않는 보관함 파일이면 지운다. 이전에는 IndexedDB blob 이 영원히 남았다. */
  async function remove(asset:AudioAsset){
    const next={...script,audioAssets:script.audioAssets!.filter(row=>row.id!==asset.id)};onChange(next);setNotice("");
    if(!asset.url.startsWith("/assets/user/"))return;
    try{const result=await removeUnreferencedAssets([asset.url],{id:readActiveProjectId(),script:next},undoTrail);setNotice(result.removed.length?`‘${asset.name}’ 파일을 보관함에서 삭제했습니다.`:`‘${asset.name}’을(를) 목록에서 뺐습니다. 다른 작품·버전 기록·실행 취소 이력이 같은 파일을 써서 파일은 남겼습니다.`);}
    catch(error){setNotice(`목록에서 뺐지만 보관함 파일 정리는 실패했습니다: ${error instanceof Error?error.message:String(error)}`);}
  }
  return <details className="line-direction audio-library" onToggle={event=>setLibraryOpen(event.currentTarget.open)}><summary>내 음원 보관함 · {script.audioAssets?.length??0}</summary><label className="field-help">작품 음악 페이드 (초)<input aria-label="작품 음악 페이드 (초)" type="number" min="0" max="10" step="0.1" value={script.musicFadeSeconds??1.2} onChange={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value)&&value>=0&&value<=10)onChange({...script,musicFadeSeconds:value});}}/></label><p className="field-help">음악 시작·교체·정지에 적용합니다. 0초는 즉시 전환, 기본은 1.2초입니다. 웹과 네이티브 출력에 전달됩니다.</p><p className="field-help">MP3·Ogg·16비트 PCM WAV를 원본 그대로 보관합니다. 파일당 50MB·30분, 한 번에 합계 200MB까지 지원합니다.</p>
    <select aria-label="가져올 음원 종류" disabled={busy} value={kind} onChange={event=>setKind(event.target.value as AudioAsset["kind"])}><option value="bgm">배경음악</option><option value="sfx">효과음</option><option value="voice">보이스</option></select>
    <input ref={input} hidden type="file" multiple accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav" data-testid="audio-import-files" onChange={event=>void add(event.target.files)}/><button className="studio-button full-width" disabled={busy} type="button" onClick={()=>input.current?.click()}>{busy?"음원 확인 중…":"음원 파일 선택"}</button>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status" data-testid="audio-remove-notice">{notice}</p>}
    <input aria-label="음원 검색" placeholder="음원 이름 검색" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/>
    {matching.slice(activePage*40,(activePage+1)*40).map(asset=><article key={asset.id}><strong>{asset.name}</strong><span>{asset.kind==="bgm"?"배경음악":asset.kind==="sfx"?"효과음":"보이스"} · {asset.duration<10?asset.duration.toFixed(1):Math.round(asset.duration)}초</span><audio controls preload="none" src={asset.url} aria-label={`${asset.name} 미리 듣기`}/><button type="button" className="text-button" disabled={used(asset.url)||busy} title={used(asset.url)?"장면과 대사의 음원 지정을 먼저 해제하세요.":"보관함에서 제거"} onClick={()=>void remove(asset)}>보관함에서 제거</button><LosiaAssetPublish target={{type:"audio",asset}} script={script} buttonClass="text-button"/><MediaProvenanceEditor value={asset.provenance} onChange={provenance=>onChange({...script,audioAssets:script.audioAssets!.map(row=>row.id===asset.id?{...row,provenance}:row)})}/></article>)}
    {matching.length>40&&<div className="audio-pages"><button type="button" disabled={!activePage} onClick={()=>setPage(activePage-1)}>이전</button><span>{activePage+1} / {lastPage+1}</span><button type="button" disabled={activePage===lastPage} onClick={()=>setPage(activePage+1)}>다음</button></div>}
    <details className="line-direction" onToggle={event=>setStoreOpen(event.currentTarget.open)}><summary>스토어에서 음원 가져오기</summary>{libraryOpen&&storeOpen&&<StorePanel fixedKind="sound" active panelTestId="audio-store-panel" script={script} projectEpoch={projectEpoch} onChange={onChange}/>}</details>
  </details>;
}
