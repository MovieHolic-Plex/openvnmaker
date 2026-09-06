/** Stable comparison for JSON manuscript snapshots; object key order is irrelevant. */
export function manuscriptKey(value:unknown):string {
  if(Array.isArray(value))return `[${value.map(manuscriptKey).join(",")}]`;
  if(value && typeof value==="object")return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,v])=>`${JSON.stringify(key)}:${manuscriptKey(v)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}
