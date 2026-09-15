/** Serialize JSON-valued records without invoking toJSON or dropping unsupported fields. */
export function serializeLibraryArchive(records:unknown[]):string {
  const seen=new WeakSet<object>();
  function check(value:unknown,depth:number):void {
    if(depth>200)throw new Error("기록의 중첩이 너무 깊어 JSON으로 보존하지 못했습니다.");
    if(value===null || typeof value==="string" || typeof value==="boolean")return;
    if(typeof value==="number" && Number.isFinite(value) && !Object.is(value,-0))return;
    if(typeof value!=="object" || !value)throw new Error("JSON으로 정확히 보존할 수 없는 값이 있습니다. 원본 보관함은 유지됩니다.");
    if(seen.has(value))throw new Error("반복 참조가 있어 JSON으로 정확히 보존하지 못했습니다.");
    seen.add(value);
    if(Array.isArray(value)){
      if(Object.keys(value).length!==value.length)throw new Error("JSON으로 보존할 수 없는 배열입니다.");
      for(let i=0;i<value.length;i++){if(!Object.hasOwn(value,i))throw new Error("비어 있는 배열 항목이 있습니다.");check(value[i],depth+1);}
    }else{
      if(Object.getPrototypeOf(value)!==Object.prototype && Object.getPrototypeOf(value)!==null)throw new Error("JSON 이외의 저장 형식이 있어 원본 다운로드를 중단했습니다.");
      for(const key of Reflect.ownKeys(value)){
        const property=Object.getOwnPropertyDescriptor(value,key)!;
        if(typeof key!=="string" || !property.enumerable || !("value" in property))throw new Error("JSON으로 보존할 수 없는 필드입니다.");
        check(property.value,depth+1);
      }
    }
  }
  check(records,0);
  return JSON.stringify({format:"vnmaker-library-archive",version:1,records},null,2);
}

export interface LibraryArchive { readonly version:1; readonly records:readonly unknown[] }
export const LIBRARY_ARCHIVE_FORMAT="vnmaker-library-archive";
/** 「보관함 원본 JSON」인지 판별한다. 일반 원고 JSON 이면 null. 형식은 맞는데 내용이 깨졌으면 오류. */
export function parseLibraryArchive(text:string):LibraryArchive {
  let value:unknown;
  try{value=JSON.parse(text);}catch{throw new Error("보관함 원본 JSON을 읽지 못했습니다.");}
  if(!isLibraryArchive(value))throw new Error("보관함 원본 JSON 형식이 아닙니다.");
  if(value.version!==1)throw new Error(`지원하지 않는 보관함 원본 버전입니다: ${String(value.version)}`);
  if(!Array.isArray(value.records))throw new Error("보관함 원본에 기록 목록이 없습니다.");
  if(value.records.length>500)throw new Error("보관함 원본의 기록이 500개를 넘습니다.");
  return {version:1,records:value.records};
}
export function isLibraryArchive(value:unknown):value is {format:string;version:unknown;records:unknown} {
  return !!value && typeof value==="object" && !Array.isArray(value) && (value as Record<string,unknown>)["format"]===LIBRARY_ARCHIVE_FORMAT;
}
