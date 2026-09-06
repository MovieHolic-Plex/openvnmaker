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
