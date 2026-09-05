import { BACKGROUNDS, EXPRESSIONS, parseScript, validBackgroundUrl, type Artwork, type Scene, type VnScript } from "@vnmaker/content";

export const DEFAULT_ART_DIRECTION = "서정적인 현대 한국의 미술대학. 정교한 애니메이션 배경 미술, 손으로 그린 질감, 깊은 원근과 풍부한 소품. 젖은 청보라 밤과 따뜻한 앰버 실내광의 대비. 인물의 의상과 머리 모양은 장면마다 일관되게 유지. 화면 하단에는 대사를 위한 여백. 글자·로고·워터마크 없음.";
export const ART_RECOVERY_KEY = "vnmaker.studio.art-recovery.v1";
export interface RecoveredArtwork { readonly asset: Artwork; readonly projectTitle: string }

/** A small local receipt survives project replacement and never embeds image data. */
export function recoveredArtwork(): RecoveredArtwork[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(ART_RECOVERY_KEY) ?? "[]");
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return [];
      const entry = row as Record<string, unknown>;
      const raw = entry["asset"];
      if (!raw || typeof raw !== "object" || typeof entry["projectTitle"] !== "string") return [];
      const asset = raw as Record<string, unknown>;
      if (typeof asset["id"] !== "string" || typeof asset["name"] !== "string" || !validBackgroundUrl(asset["url"]) || !["background", "cg", "character"].includes(String(asset["kind"]))) return [];
      return [{ asset: raw as Artwork, projectTitle: entry["projectTitle"] }];
    }).slice(0, 20);
  } catch { return []; }
}

export function rememberArtwork(asset: Artwork, projectTitle: string): RecoveredArtwork[] {
  const next = [{ asset, projectTitle }, ...recoveredArtwork().filter(row => row.asset.id !== asset.id)].slice(0, 20);
  try { localStorage.setItem(ART_RECOVERY_KEY, JSON.stringify(next)); } catch { /* The normal project save reports storage quota errors separately. */ }
  return next;
}

export const CURATED_ART: readonly Artwork[] = [
  { id: "curated-nocturne-atrium", name: "Nocturne · 비 내린 아트리움", kind: "background", url: "/assets/art/nocturne-atrium.png", prompt: "비 내린 유리 아트리움, 청보라 야경과 앰버 빛, 섬세한 반사와 깊은 원근." },
  { id: "curated-atelier", name: "Afterglow · 황금빛 아틀리에", kind: "background", url: "/assets/art/atelier-golden-hour.png", prompt: "황금빛이 번지는 미술 작업실. 미완성 캔버스와 붓, 정교한 사물과 공기감." },
  { id: "curated-rain-confession", name: "Blue hour · 빗속의 고백", kind: "cg", url: "/assets/art/rain-confession-cg.png", prompt: "비 내리는 밤, 가까워진 두 사람의 감정을 담은 영화적인 이벤트 일러스트." },
];

export function libraryAssets(script: VnScript): Artwork[] {
  if (script.assetLibraryMode === "project") return [...(script.assets ?? [])];
  const base: Artwork[] = [
    ...CURATED_ART,
    ...Object.entries(BACKGROUNDS).map(([id, name]) => ({ id: `builtin-bg-${id}`, name, kind: "background" as const, url: `/assets/bg/${id}.png` })),
    ...script.characters.flatMap(character => EXPRESSIONS.map(expression => ({ id: `builtin-${character.id}-${expression}`, name: `${character.name} · ${expression}`, kind: "character" as const, characterId: character.id, expression, url: `/assets/sprite/${character.id}-${expression}.png` }))),
  ];
  return [...(script.assets ?? []), ...base.filter(asset => !script.assets?.some(saved => saved.id === asset.id))];
}

export function assetUsage(script: VnScript, asset: Artwork): number {
  if (asset.kind === "character") return script.characters.filter(character => Object.values(character.expressionImages ?? {}).includes(asset.url)).length;
  return script.scenes.filter(scene => scene.backgroundUrl === asset.url || scene.cgUrl === asset.url || scene.lines.some(line=>line.cgUrl === asset.url || line.backgroundUrl === asset.url) || (!scene.backgroundUrl && asset.url === `/assets/bg/${scene.background}.png`)).length;
}

export function registerArtwork(script: VnScript, asset: Artwork): VnScript {
  return parseScript({ ...script, assets: [...(script.assets ?? []).filter(row => row.id !== asset.id), asset] });
}

/** Applying one art asset leaves the story, exits and other character expressions intact. */
export function applyArtwork(script: VnScript, sceneId: string, asset: Artwork): VnScript {
  let next = registerArtwork(script, asset);
  if (asset.kind === "character") {
    if (!asset.characterId) throw new Error("먼저 캐릭터를 선택하세요.");
    next = { ...next, characters: next.characters.map(character => character.id === asset.characterId ? { ...character, expressionImages: { ...character.expressionImages, [asset.expression ?? "neutral"]: asset.url } } : character) };
  } else {
    if (!script.scenes.some(scene => scene.id === sceneId)) throw new Error("이미지를 적용할 장면을 찾을 수 없습니다.");
    next = { ...next, scenes: next.scenes.map(scene => {
      if (scene.id !== sceneId) return scene;
      if (asset.kind === "cg") return { ...scene, cgUrl: asset.url, framing: "cinematic" as const };
      const { cgUrl: _cg, hideSprites: _hidden, ...rest } = scene;
      return { ...rest, backgroundUrl: asset.url };
    }) };
  }
  return parseScript(next);
}

export function sceneArtBrief(script: VnScript, scene: Scene, kind: Artwork["kind"] = "background"): string {
  const setting = BACKGROUNDS[scene.background as keyof typeof BACKGROUNDS] ?? scene.background;
  const cast = script.characters.filter(character => scene.sprites?.some(sprite => sprite.character === character.id)).map(character => `${character.name}: ${character.bio}`).join("; ");
  if (scene.artBrief?.trim()) return scene.artBrief;
  return `${scene.chapter || scene.id}. ${setting}. ${kind === "cg" ? "인물의 관계가 드러나는 결정적인 순간을 하나의 완성된 이벤트 CG로 연출." : "인물 없는 넓은 배경. 서사에 맞는 시간대, 날씨와 소품을 강조."} ${scene.lines.slice(0, 4).map(line => line.text).join(" ").slice(0, 750)}${kind === "cg" && cast ? ` 등장인물: ${cast}` : ""}`;
}

export function artPrompt(script: VnScript, scene: Scene, kind: Artwork["kind"], brief: string, characterId?: Artwork["characterId"], expression?: Artwork["expression"]): string {
  const character = script.characters.find(row => row.id === characterId);
  const role = kind === "character" ? `A single visual novel character sprite, full body, centered, consistent proportions, isolated on a plain neutral background. Character: ${character?.name ?? ""}; ${character?.bio ?? ""}. Expression: ${expression ?? "neutral"}. Do not draw other people. The background will require removal before a transparent sprite is ready.` : kind === "cg" ? "Create one full-frame visual novel event CG with emotionally expressive characters and an intricate environment. Compose the whole image as a finished illustration, with clear focal hierarchy." : "Create a richly detailed visual novel environment background with no people, layered foreground, midground and background, believable lighting, atmospheric depth and narrative props.";
  return `${role}\nART DIRECTION:\n${script.artDirection?.trim() || DEFAULT_ART_DIRECTION}\nSCENE: ${scene.chapter || scene.id}\nSHOT BRIEF:\n${brief}\nPremium hand-painted anime illustration. No typography, dialogue box, interface, logo, watermark, contact sheet or collage. Keep important details clear of the lower 22% dialogue area.`.slice(0, 12_000);
}

export function pendingArtScenes(script: VnScript): Scene[] {
  return script.scenes.filter(scene => !scene.backgroundUrl && !scene.cgUrl && !script.assets?.some(asset => asset.sceneId === scene.id && asset.kind !== "character"));
}

export function createGeneratedArtwork(kind: Artwork["kind"], scene: Scene, result: { url: string; name: string }, prompt: string, characterId?: Artwork["characterId"], expression?: Artwork["expression"]): Artwork {
  if (!validBackgroundUrl(result.url)) throw new Error("이미지 서버가 유효하지 않은 파일 주소를 반환했습니다.");
  return { id: `art-${crypto.randomUUID()}`, name: `${scene.chapter || scene.id} · ${kind === "cg" ? "CG" : kind === "character" ? "캐릭터" : "배경"}`, kind, url: result.url, prompt, sceneId: scene.id, createdAt: new Date().toISOString(), ...(characterId ? { characterId } : {}), ...(expression ? { expression } : {}) };
}
