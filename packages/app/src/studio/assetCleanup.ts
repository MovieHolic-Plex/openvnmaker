import type {VnScript} from "@vnmaker/content";
import {collectProjectAssets} from "./exportBundle.js";
import {listProjects} from "./projects.js";
import {listAllVersionScripts} from "./versions.js";
import {deleteAssets} from "../storage/projectAssets.js";

/** 작품들이 참조하는 보관함(/assets/user/) 파일 주소. 검증된 원고만 넘겨야 한다(collectProjectAssets 는 이상한 주소에서 던진다). */
export function referencedUserAssets(scripts:readonly VnScript[]):Set<string>{
  const referenced=new Set<string>();
  for(const script of scripts){
    let paths:string[];
    try{paths=collectProjectAssets(script);}catch{continue;}
    for(const path of paths)if(path.startsWith("/assets/user/"))referenced.add(path);
  }
  return referenced;
}
export function unreferencedUserAssets(candidates:readonly string[],scripts:readonly VnScript[]):string[]{
  const referenced=referencedUserAssets(scripts);
  return [...new Set(candidates)].filter(path=>path.startsWith("/assets/user/")&&!referenced.has(path));
}
/**
 * 보관함 파일은 작품 사이에서 주소로 공유된다. 어떤 작품(보관함의 다른 작품·현재 원고·버전 기록)도 더 쓰지 않는 파일만 지운다.
 * 현재 작품은 아직 저장 전인 최신 원고로 센다. 손상된 보관함 기록이 있으면 그 기록이 무엇을 참조하는지 알 수 없으므로 지우지 않는다.
 * extraRefs 에는 실행 취소/다시 실행 이력의 원고를 넣는다 — 지운 카드를 Ctrl+Z 로 되돌렸을 때 파일이 남아 있어야 한다.
 */
export async function removeUnreferencedAssets(candidates:readonly string[],current:{id:string;script:VnScript},extraRefs:readonly VnScript[]=[]):Promise<{removed:string[];kept:string[]}>{
  const userPaths=[...new Set(candidates)].filter(path=>path.startsWith("/assets/user/"));
  if(!userPaths.length)return {removed:[],kept:[]};
  const listing=await listProjects();
  if(listing.damagedCount)return {removed:[],kept:userPaths};
  // 버전 기록을 읽지 못하면 참조를 모르는 상태에서 지우는 셈이다 — 손상 기록과 같은 이유로 전부 남긴다.
  const versions=await listAllVersionScripts().catch(()=>null);
  if(versions===null)return {removed:[],kept:userPaths};
  const scripts=[current.script,...extraRefs,...listing.projects.filter(row=>row.id!==current.id).map(row=>row.script),...versions];
  const removed=unreferencedUserAssets(userPaths,scripts);
  if(removed.length)await deleteAssets(removed);
  return {removed,kept:userPaths.filter(path=>!removed.includes(path))};
}
