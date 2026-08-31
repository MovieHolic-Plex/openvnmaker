import { script } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { compileNode, helloNode } from "@vnmaker/ir";

/** W1–2: 모델 한 줄을 IR 노드로 만든 뒤 PLAY 스크립트로 컴파일한다. */
export function helloScript(text: string): VnScript {
  return compileNode(helloNode(text), script.characters);
}
