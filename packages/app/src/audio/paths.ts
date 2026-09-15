import {audioPath} from "@vnmaker/content";
import {assetUrl} from "../assetUrl.js";
export function bgmSrc(id: string): string {
  return assetUrl(audioPath(id,"bgm"));
}

export function sfxSrc(id: string): string {
  return assetUrl(audioPath(id,"sfx"));
}
