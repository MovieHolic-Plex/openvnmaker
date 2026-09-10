import type { Artwork, Scene, Transition, VnScript } from "@vnmaker/content";
import { assertNever } from "@vnmaker/harness";
import { shouldApplyLegacyGreenKey } from "./harness/assetReviewModel.js";

export const NATIVE_PARITY_FIELDS = [
  "dialogue", "conditions", "add", "sprites", "CG", "framing", "voice", "BGM", "SFX", "fades", "credits", "save", "load",
] as const;
export type NativeParityField = typeof NATIVE_PARITY_FIELDS[number];
export type NativeParityStatus = "supported" | "unsupported" | "fixed";
export type NativeParityRow = { readonly field: NativeParityField; readonly status: NativeParityStatus; readonly notes: string };
export type NativeExportBlock = {
  readonly code: "choice-cond" | "unresolved-cg";
  readonly message: string;
};

/** Ren'Py testcases wait on a presented interaction, never a wall-clock pause. */
export const VN_WAIT_READY_LINE = "    $ vn_wait_ready()";

export function nativeApplySpriteKey(compositing: Artwork["compositing"], chromaKey: string | undefined): boolean {
  return shouldApplyLegacyGreenKey(compositing) && chromaKey !== undefined;
}

export function nativeTransition(kind: Transition): string | null {
  switch (kind) {
    case "none": return null;
    case "fade": return "fade";
    case "dissolve": return "dissolve";
    case "flash": return "Fade(0.1, 0.0, 0.3, color='#ffffff')";
    case "fadeToBlack": return "Fade(0.5, 0.2, 0.5, color='#000000')";
    default: return assertNever(kind);
  }
}

export function nativeCgUrl(scene: Pick<Scene, "cg" | "cgUrl">, assets: VnScript["assets"]): string | undefined {
  if (scene.cgUrl) return scene.cgUrl;
  if (scene.cg === undefined) return undefined;
  const asset = assets?.find(row => row.id === scene.cg);
  if (asset === undefined) throw new Error(`Ren'Py 내보내기: 장면 CG '${scene.cg}'에 해당하는 자산이 없습니다.`);
  return asset.url;
}

export function nativeExportBlocks(script: VnScript): readonly NativeExportBlock[] {
  const blocks: NativeExportBlock[] = [];
  for (const scene of script.scenes) {
    for (const choice of scene.choices ?? []) {
      if (choice.cond) {
        blocks.push({
          code: "choice-cond",
          message: "Ren'Py 내보내기: 선택지 cond 표현식은 아직 지원하지 않습니다.",
        });
      }
    }
    if (scene.cg === undefined) continue;
    try {
      nativeCgUrl(scene, script.assets);
    } catch (error) {
      blocks.push({
        code: "unresolved-cg",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return blocks;
}

export function nativeParityMatrix(script: VnScript): readonly NativeParityRow[] {
  const blocks = nativeExportBlocks(script);
  const condBlocked = blocks.some(block => block.code === "choice-cond");
  const cgBlocked = blocks.some(block => block.code === "unresolved-cg");
  return NATIVE_PARITY_FIELDS.map(field => rowFor(field, condBlocked, cgBlocked));
}

function rowFor(field: NativeParityField, condBlocked: boolean, cgBlocked: boolean): NativeParityRow {
  switch (field) {
    case "dialogue": return { field, status: "supported", notes: "escaped speaker text" };
    case "conditions": return {
      field, status: condBlocked ? "unsupported" : "supported",
      notes: condBlocked ? "choice.cond rejected" : "line.when and choice.when",
    };
    case "add": return { field, status: "supported", notes: "numeric add with rollback snapshot" };
    case "sprites": return { field, status: "fixed", notes: "true-alpha skips legacy green key" };
    case "CG": return {
      field, status: cgBlocked ? "unsupported" : "fixed",
      notes: cgBlocked ? "unresolved scene.cg" : "cgHide and scene.cg id",
    };
    case "framing": return { field, status: "supported", notes: "wide/close/cinematic" };
    case "voice": return { field, status: "supported", notes: "voice channel" };
    case "BGM": return { field, status: "supported", notes: "fade in/out" };
    case "SFX": return { field, status: "supported", notes: "renpy.sound.play" };
    case "fades": return { field, status: "fixed", notes: "exhaustive transition including fadeToBlack" };
    case "credits": return { field, status: "supported", notes: "about screen" };
    case "save": return { field, status: "supported", notes: "Ren'Py save; preview saves excluded" };
    case "load": return { field, status: "supported", notes: "Ren'Py load; preview saves excluded" };
    default: return assertNever(field);
  }
}
