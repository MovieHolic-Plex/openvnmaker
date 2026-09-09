import { BACKGROUNDS, BGM } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { sceneCharacters } from "./production-duration.js";
import { MEDIUM_SCENE_LIMITS } from "./production-limits.js";
import { sceneExits } from "./production-graph.js";
import type { ProductionPlan, SceneBeat } from "./production-types.js";

const promptCast = (characters: VnScript["characters"]) =>
  characters.map(character => ({ id: character.id, name: character.name.slice(0, 60), bio: character.bio.slice(0, 300) }));

function approvedBackgrounds(script: VnScript): readonly string[] {
  const owned = script.assets?.filter(asset => asset.kind === "background").map(asset => asset.id) ?? [];
  return owned.length ? owned : Object.keys(BACKGROUNDS);
}

export function makeOutlinePrompt(brief: string, targetMinutes: number, script: VnScript): string {
  const backgrounds = approvedBackgrounds(script);
  return `당신은 한국어 장편 비주얼 노벨의 책임 작가다. 유효한 JSON만 출력한다. 목표는 독자가 하나의 경로로 엔딩에 도달할 때 ${targetMinutes}분인 작품이다. 모든 분기의 총합을 플레이 시간으로 세지 않는다. 사용자 작품 기획: ${brief.slice(0, 2200)}\n현재 인물(이 ID만 사용): ${JSON.stringify(promptCast(script.characters))}\n승인된 배경 ID만 사용: ${JSON.stringify(backgrounds)}\n기존 샘플의 대학·인물 설정을 하드코딩하지 말고 승인된 기획·설정집·자산 목록만 사용한다. 6개 이상의 챕터, ${MEDIUM_SCENE_LIMITS.min}–${MEDIUM_SCENE_LIMITS.max}개 씬, 씬마다 3–7분. 공통 이야기와 유의미한 선택지, 적어도 두 엔딩을 구성한다. 모든 시작→엔딩 경로의 targetMinutes 합은 ${targetMinutes}분의 100–120%이고, 분기는 다른 결과를 만들되 초반에 합류시키거나 충분한 길이를 유지한다. 반복·도달 불가능 씬·없는 연결은 금지. 각 씬은 next/choices/ending 중 하나만 사용. 감정 변화, 복선, 갈등, 반전, 결말을 구체적으로 배분. bible은 설정·인물 동기·말투·시간선·복선 회수 원칙이며 3000자 이하. artDirection은 풍부한 배경, 시간대, 조명, 핵심 소품, 카메라, 이벤트 CG 소재를 명시. 출력 스키마: {title:string,subtitle:string,bible:string,start:string,scenes:[{id:"scene_01",chapter:"01. 챕터명",title:string,summary:string,artDirection:string,targetMinutes:number,background:"유효한 배경ID",next?:string,choices?:[{text:string,next:string}],ending?:string}]}. 각 summary는 200자 이하, artDirection은 160자 이하. 아직 대사를 집필하지 말고 장편 전체 설계만 출력.`;
}

export function makeDraftPrompt(plan: ProductionPlan, beat: SceneBeat, extend = false): string {
  const ancestors = new Set<string>();
  const collect = (id: string) => {
    for (const prior of plan.outline.scenes) {
      if (sceneExits(prior).includes(id) && !ancestors.has(prior.id)) {
        ancestors.add(prior.id);
        collect(prior.id);
      }
    }
  };
  collect(beat.id);
  const prior = plan.outline.scenes.filter(scene => ancestors.has(scene.id)).slice(-10).map(scene => ({
    id: scene.id,
    planned: scene.summary.slice(0, 220),
    written: plan.jobs[scene.id]?.draft?.summary.slice(0, 300),
    continuity: plan.jobs[scene.id]?.draft?.continuity.slice(-4).map(fact => fact.slice(0, 140)),
  }));
  const existing = plan.jobs[beat.id]?.draft;
  const targetCharacters = Math.ceil(beat.targetMinutes * plan.charsPerMinute);
  const remaining = extend && existing ? Math.max(320, targetCharacters - sceneCharacters(existing.scene)) : targetCharacters;
  const compactBeat = {
    ...beat,
    title: beat.title.slice(0, 80),
    chapter: beat.chapter.slice(0, 80),
    summary: beat.summary.slice(0, 400),
    artDirection: beat.artDirection.slice(0, 260),
    ...(beat.choices ? { choices: beat.choices.map(choice => ({ text: choice.text.slice(0, 100), next: choice.next })) } : {}),
  };
  const prompt = `당신은 한국어 비주얼 노벨 작가다. 유효한 JSON만 출력. 작품 ${plan.outline.title}. 기획: ${plan.brief.slice(0, 900)}\n설정집: ${plan.outline.bible.slice(0, 2500)}\n인물: ${JSON.stringify(promptCast(plan.characters))}\n앞선 조상 씬 맥락(합류점에서는 모든 경로에서 성립하는 사실만 사용): ${JSON.stringify(prior)}\n현재 씬 설계: ${JSON.stringify(compactBeat)}\n${extend && existing ? `분량 보강: 기존 씬의 뒷부분 ${JSON.stringify(existing.scene.lines.slice(-6).map(line => ({ speaker: line.speaker, text: line.text.slice(0, 120) })))}. 기존 대사를 반복하지 말고 결말 직전 상황에서 자연스럽게 이어 쓴다. 기존 대사의 사실관계와 결말을 뒤집지 않는다.` : "이번 씬의 시작부터 다음 연결 직전까지 충분한 사건과 감정 변화로 집필한다."}\n이번 출력 대사 text의 공백 제외 총 글자 수는 최소 ${remaining}, 권장 ${Math.ceil(remaining * 1.1)}자다. ${Math.max(20, Math.ceil(remaining / 48))}줄 이상, 각 줄은 읽기 쉬운 25–85자. 요약·시간 점프로 분량을 생략하거나 같은 문장을 반복하지 않는다. 모든 선택지로 이어질 맥락을 만들고 실제 선택 결과는 다음 씬에 맡긴다. speaker는 ${JSON.stringify(plan.characters.map(character => character.id))} 또는 "me" 또는 null. expression은 neutral/smile/sad/surprised. bgm은 ${JSON.stringify(Object.keys(BGM))}. 출력: {lines:[{speaker,text,expression?,sfx?,shake?}],sprites?:[{slot:"left"|"center"|"right",character:인물ID,expression:"neutral"}],bgm?:string,transition?:"fade"|"dissolve",summary:"이번 씬에서 실제 발생한 사건 250자 이내",continuity:["새로 확인된 사실·소지품·관계·미회수 복선 각각 100자 이내, 최대 5개"]}. scene id/출구/이미지 경로를 만들지 않는다.`;
  let bounded = prompt;
  while (bounded.length > 16000 && prior.length) {
    const previousContext = JSON.stringify(prior);
    prior.shift();
    bounded = bounded.replace(previousContext, JSON.stringify(prior));
  }
  if (bounded.length > 16000) throw new Error("집필 프롬프트가 너무 큽니다. 선택지와 인물 설정을 줄여 주세요.");
  return bounded;
}
