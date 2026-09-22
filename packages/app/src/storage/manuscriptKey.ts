/** Stable comparison for JSON manuscript snapshots; object key order is irrelevant. */
export function manuscriptKey(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(manuscriptKey).join(",")}]`;
  if(value && typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>`${JSON.stringify(key)}:${manuscriptKey(v)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}

/** 원고 보관함 키로 쓰는 짧은 지문. FNV-1a 64비트 — edition.ts 의 판정과 같은 폭이다. */
export function manuscriptFingerprint(value:unknown):string {
  let hash=0xcbf29ce484222325n;
  for(const char of manuscriptKey(value))hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)!))*0x100000001b3n);
  return hash.toString(36);
}
