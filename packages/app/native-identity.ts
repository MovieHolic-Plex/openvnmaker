import {createHash} from "node:crypto";
import {parseScript} from "../content/src/parse.js";
import type {VnScript} from "@vnmaker/content";

/** Legacy CLI inputs retain their original namespace until explicitly pinned. */
export function nativeIdentity(source:VnScript):{identity:string;manuscriptHash:string;stable:boolean}{
  const script=parseScript(source);
  const manuscriptHash=createHash("sha256").update(JSON.stringify(script)).digest("hex");
  return {identity:script.nativeSaveId??manuscriptHash.slice(0,16),manuscriptHash,stable:!!script.nativeSaveId};
}
