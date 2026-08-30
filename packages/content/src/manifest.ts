/**
 * 에셋 매니페스트. 이미지 생성·오디오 생성·시나리오 작성이 모두 이 id 목록만 사용한다.
 * 여기 없는 id 를 시나리오가 참조하면 content 체커가 실패한다.
 * 파일 경로 규칙:
 *   배경   packages/app/public/assets/bg/<id>.png
 *   스프라이트 packages/app/public/assets/sprite/<characterId>-<expression>.png
 *   BGM    packages/app/public/assets/audio/bgm/<id>.ogg
 *   효과음 packages/app/public/assets/audio/sfx/<id>.ogg
 */

export const BACKGROUNDS = {
  "title": "타이틀 아트 — 여름 오후의 대학 캠퍼스 전경",
  "campus-gate": "정문과 은행나무 길, 여름 낮",
  "lawn-sunset": "중앙 잔디광장, 해질녘",
  "art-studio": "미술대 실기실, 이젤과 물감 얼룩",
  "library-window": "도서관 창가 열람석, 창밖에 비",
  "campus-cafe": "학내 카페 창가 자리, 오후",
  "corridor-rain": "강의동 복도, 창밖 장맛비",
  "rooftop-night": "공대 건물 옥상, 도시 야경",
  "riverside-dusk": "캠퍼스 뒤 천변 벤치, 노을",
} as const;

export const CHARACTERS = ["seorin", "dohyun", "mirae"] as const;
export const EXPRESSIONS = ["neutral", "smile", "sad", "surprised"] as const;

export const BGM = {
  "main-theme": "타이틀. 잔잔한 피아노 + 현 패드",
  "daily": "일상. 밝은 일렉피아노",
  "rain": "비. 낮은 패드와 물방울 음",
  "warm": "감정. 따뜻한 피아노 + 스트링",
  "ending": "엔딩. 넓은 리버브 피아노",
} as const;

export const SFX = {
  "ui-click": "UI 클릭",
  "ui-hover": "UI 호버",
  "page-turn": "종이 넘김",
  "door-open": "문 열림",
  "footsteps": "발소리",
  "rain-loop": "빗소리 루프",
  "cicada": "매미 소리",
  "phone-buzz": "휴대폰 진동",
  "brush-stroke": "붓질",
  "heartbeat": "심장 박동",
} as const;

export type BackgroundId = keyof typeof BACKGROUNDS;
export type BgmId = keyof typeof BGM;
export type SfxId = keyof typeof SFX;

export const backgroundIds = Object.keys(BACKGROUNDS) as BackgroundId[];
export const bgmIds = Object.keys(BGM) as BgmId[];
export const sfxIds = Object.keys(SFX) as SfxId[];
export const spriteFiles = CHARACTERS.flatMap((c) => EXPRESSIONS.map((e) => `${c}-${e}`));
