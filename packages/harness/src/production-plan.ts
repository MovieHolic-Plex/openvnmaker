import { auditScript, parseScript } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { DEFAULT_READING_SPEED } from "./production-limits.js";
import { PRODUCTION_MINUTE_LIMITS } from "./production-limits.js";
import { sceneExits } from "./production-graph.js";
import { requiredObject, requiredText } from "./production-json.js";
import { parseOutline } from "./production-parse.js";
import { sceneCharacters } from "./production-duration.js";
import type { DraftJob, ProductionPlan, ProductionTiming, SceneDraft, StudioOutline } from "./production-types.js";

const detachArtwork = (assets: NonNullable<VnScript["assets"]>) =>
  assets.map(({ sceneId: _oldScene, ...asset }) => asset);

export function createPlan(
  outline: StudioOutline,
  base: VnScript,
  brief: string,
  targetMinutes: number,
  charsPerMinute: number,
  timing: ProductionTiming,
): ProductionPlan {
  const speed = Number.isFinite(charsPerMinute) ? charsPerMinute : DEFAULT_READING_SPEED;
  return {
    version: 1,
    id: timing.id(),
    baseFingerprint: fingerprint(base),
    baseTitle: base.title,
    characters: structuredClone(base.characters),
    ...(base.artDirection ? { sourceArtDirection: base.artDirection } : {}),
    ...(base.assets ? { sourceAssets: structuredClone(detachArtwork(base.assets)) } : {}),
    brief, targetMinutes, charsPerMinute: speed, outline,
    jobs: Object.fromEntries(outline.scenes.map(scene => [scene.id, { status: "pending" as const }])),
    createdAt: timing.now(),
  };
}

function fingerprint(script: VnScript): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(script)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}

export function planDraftScript(plan: ProductionPlan): VnScript {
  return {
    title: plan.outline.title, subtitle: plan.outline.subtitle, start: plan.outline.start, characters: plan.characters,
    ...(plan.sourceArtDirection ? { artDirection: plan.sourceArtDirection } : {}),
    ...(plan.sourceAssets ? { assets: plan.sourceAssets } : {}),
    scenes: plan.outline.scenes.map(beat => plan.jobs[beat.id]?.draft?.scene ?? {
      id: beat.id, background: beat.background, lines: [],
      ...(beat.next ? { next: beat.next } : {}),
      ...(beat.choices?.length ? { choices: beat.choices } : {}),
      ...(beat.ending ? { ending: beat.ending } : {}),
    }),
  };
}

export function assembleProduction(plan: ProductionPlan): VnScript {
  if (plan.outline.scenes.some(beat => !plan.jobs[beat.id]?.draft)) {
    throw new Error("모든 씬의 초안을 집필한 뒤 작품에 적용할 수 있습니다.");
  }
  const script = parseScript(planDraftScript(plan));
  const issues = auditScript(script);
  const first = issues[0];
  if (first !== undefined) throw new Error(`원고 검증 실패: ${first.message}`);
  return script;
}

export function restoreProduction(value: unknown, timing: ProductionTiming): ProductionPlan {
  const row = requiredObject(value);
  if (row["version"] !== 1) throw new Error("지원하지 않는 장편 체크포인트 버전입니다.");
  const targetMinutes = row["targetMinutes"];
  const charsPerMinute = row["charsPerMinute"];
  if (typeof targetMinutes !== "number" || targetMinutes < PRODUCTION_MINUTE_LIMITS.min || targetMinutes > PRODUCTION_MINUTE_LIMITS.max
    || typeof charsPerMinute !== "number" || charsPerMinute < 120 || charsPerMinute > 800) {
    throw new Error("분량 또는 읽기 속도 설정이 올바르지 않습니다.");
  }
  const outline = parseOutline(row["outline"], targetMinutes);
  const sourceAssets = Array.isArray(row["sourceAssets"])
    ? row["sourceAssets"].map(entry => {
      const asset = requiredObject(entry);
      const { sceneId: _oldScene, ...rest } = asset;
      return rest;
    })
    : row["sourceAssets"];
  const check = parseScript({
    title: "checkpoint", subtitle: "", start: "check", characters: row["characters"],
    ...(row["sourceArtDirection"] ? { artDirection: row["sourceArtDirection"] } : {}),
    ...(sourceAssets ? { assets: sourceAssets } : {}),
    scenes: [{ id: "check", background: "title", lines: [{ speaker: null, text: "check" }], ending: "check" }],
  });
  const rawJobs = requiredObject(row["jobs"]);
  const jobs: Record<string, DraftJob> = {};
  for (const beat of outline.scenes) {
    const item = requiredObject(rawJobs[beat.id]);
    let draft: SceneDraft | undefined;
    if (item["draft"] !== undefined) {
      const saved = requiredObject(item["draft"]);
      const parsed = parseScript({ ...check, start: beat.id, scenes: [saved["scene"]] });
      const scene = parsed.scenes[0];
      if (scene === undefined || scene.id !== beat.id || JSON.stringify(sceneExits(scene)) !== JSON.stringify(sceneExits(beat)) || scene.ending !== beat.ending) {
        throw new Error("체크포인트의 원고 연결이 설계와 다릅니다.");
      }
      if (scene.lines.some(line => !line.text.trim())) throw new Error("체크포인트에 빈 대사가 있습니다.");
      const continuityRaw = saved["continuity"];
      if (!Array.isArray(continuityRaw) || continuityRaw.length > 8) throw new Error("연속성 기록을 읽지 못했습니다.");
      draft = {
        scene,
        summary: requiredText(saved["summary"], "요약", 600),
        continuity: continuityRaw.map(entry => requiredText(entry, "연속성", 200)),
        model: typeof saved["model"] === "string" ? saved["model"] : "",
        updatedAt: typeof saved["updatedAt"] === "number" ? saved["updatedAt"] : 0,
      };
    }
    const status: DraftJob["status"] = draft
      ? sceneCharacters(draft.scene) >= beat.targetMinutes * charsPerMinute ? "ready" : "short"
      : item["status"] === "error" ? "error" : "pending";
    jobs[beat.id] = { status, ...(draft ? { draft } : {}), ...(typeof item["error"] === "string" ? { error: item["error"] } : {}) };
  }
  return {
    version: 1,
    id: requiredText(row["id"], "계획 ID", 100),
    baseFingerprint: requiredText(row["baseFingerprint"], "원본 확인값", 100),
    baseTitle: requiredText(row["baseTitle"], "원본 제목", 200),
    characters: check.characters,
    ...(check.artDirection ? { sourceArtDirection: check.artDirection } : {}),
    ...(check.assets ? { sourceAssets: check.assets } : {}),
    brief: requiredText(row["brief"], "기획", 2200),
    targetMinutes, charsPerMinute, outline, jobs,
    createdAt: typeof row["createdAt"] === "number" ? row["createdAt"] : timing.now(),
  };
}
