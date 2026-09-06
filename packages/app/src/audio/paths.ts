import {audioPath} from "@vnmaker/content";
export function bgmSrc(id: string): string {
  return audioPath(id,"bgm");
}

export function sfxSrc(id: string): string {
  return audioPath(id,"sfx");
}
