import {audioPath} from "@vnmaker/content";
import {resolveRuntimeAsset} from "../storage/runtimeBase.js";
export function bgmSrc(id: string): string {
  return resolveRuntimeAsset(audioPath(id,"bgm"));
}

export function sfxSrc(id: string): string {
  return resolveRuntimeAsset(audioPath(id,"sfx"));
}
