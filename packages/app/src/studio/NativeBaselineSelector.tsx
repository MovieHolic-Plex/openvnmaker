import {useEffect,useState} from "react";
import type {VnScript} from "@vnmaker/content";
import {NativeCompatibilityCompare} from "./NativeCompatibilityReview.js";

const key=(identity:string)=>`vnmaker.native-baseline.${identity}`;
export function selectedNativeBaseline(identity:string):string|undefined{
  const value=localStorage.getItem(key(identity));
  if(value===null)return undefined;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))throw new Error("저장된 기준 빌드 ID가 올바르지 않습니다. 업데이트 기준을 다시 선택하세요.");
  return value;
}
interface Baseline {id:string;createdAt:string;sha256:string;project?:{title:string}}
interface Listing {jobs:Baseline[];total:number;nextOffset:number|null;unreadable:number}

export function NativeBaselineSelector({identity,open,disabled,revision,script}:{identity:string;open:boolean;disabled:boolean;revision:string;script:VnScript}){
  const[selection,setSelection]=useState(""),[rows,setRows]=useState<Baseline[]>([]),[preferenceError,setPreferenceError]=useState(""),[listingError,setListingError]=useState(""),[loading,setLoading]=useState(false),[next,setNext]=useState<number|null>(null),[total,setTotal]=useState(0),[unreadable,setUnreadable]=useState(0);
  async function fetchPage(offset:number):Promise<Listing>{
    const response=await fetch(`/api/native-build/baselines/${identity}?offset=${offset}`,{headers:{"X-VNMaker-Studio":"1"}});const result=await response.json();if(!response.ok)throw new Error(result.error??"기준 빌드 목록을 읽지 못했습니다.");return result;
  }
  useEffect(()=>{try{setSelection(selectedNativeBaseline(identity)??"");setPreferenceError("");}catch(error){setPreferenceError(error instanceof Error?error.message:String(error));}},[identity]);
  useEffect(()=>{
    if(!open)return;let stale=false;setLoading(true);
    void fetchPage(0).then(result=>{if(!stale){setRows(result.jobs);setNext(result.nextOffset);setTotal(result.total);setUnreadable(result.unreadable);setListingError("");}}).catch(error=>{if(!stale)setListingError(String(error.message));}).finally(()=>{if(!stale)setLoading(false);});
    return()=>{stale=true;};
  },[identity,open,revision]);
  async function more(){setLoading(true);setListingError("");try{const result=await fetchPage(next!);setRows(previous=>[...new Map([...previous,...result.jobs].map(row=>[row.id,row])).values()]);setNext(result.nextOffset);setTotal(result.total);}catch(error){setListingError(error instanceof Error?error.message:String(error));}finally{setLoading(false);}}
  function choose(value:string){try{if(value)localStorage.setItem(key(identity),value);else localStorage.removeItem(key(identity));setSelection(value);setPreferenceError("");}catch(error){setPreferenceError(`기준 선택을 저장하지 못했습니다: ${String(error)}`);}}
  const error=preferenceError||listingError;
  const selected=rows.find(row=>row.id===selection);
  return <section className="native-baseline-selector" aria-label="업데이트 기준">
    <label>업데이트 기준 빌드<select aria-label="업데이트 기준 빌드" value={selection} disabled={disabled} onChange={event=>choose(event.target.value)}>
      <option value="">자동 · 같은 작품의 최근 완료 빌드</option>
      {selection&&!selected&&<option value={selection}>저장된 기준 · {selection} (목록 밖)</option>}
      {rows.map(row=><option key={row.id} value={row.id}>{new Date(row.createdAt).toLocaleString("ko-KR")} · {row.project?.title??"제목 없음"} · {row.id.slice(0,8)}</option>)}
    </select></label>
    <p className="export-bundle-help">{selection?`고정한 기준: ${selection}. 이후 테스트 빌드가 생겨도 이 기준을 유지합니다.`:"빌드할 때 가장 최근에 완료한 같은 작품을 찾습니다. 출시본을 유지하려면 목록에서 해당 빌드를 선택하세요."}</p>
    {selected&&<small>기준 ZIP SHA-256 · {selected.sha256}</small>}
    {loading&&<p role="status">기준 빌드 목록을 확인하고 있습니다…</p>}
    {next!==null&&<button type="button" className="studio-button" disabled={disabled||loading} onClick={()=>void more()}>이전 빌드 더 보기 · {rows.length} / {total}</button>}
    {!loading&&!error&&!rows.length&&!selection&&<p className="export-bundle-help">이 작품의 완료된 빌드 기록이 없습니다. 첫 빌드는 새 기준으로 생성됩니다.</p>}
    {unreadable>0&&<p className="export-bundle-help">읽을 수 없는 기록 {unreadable}개는 목록에서 제외됐습니다. 선택한 기준을 찾지 못하면 다른 기준으로 자동 변경하지 않습니다.</p>}
    {error&&<><p className="export-bundle-error" role="alert">{error}</p><button type="button" className="studio-button" disabled={disabled} onClick={()=>choose("")}>기준 선택 초기화</button></>}
    <NativeCompatibilityCompare script={script} baselineId={selection} disabled={disabled||!!preferenceError}/>
  </section>;
}
