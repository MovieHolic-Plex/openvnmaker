export type SourceHead = {
  readonly projectId: string;
  readonly lineageId: string;
  readonly revision: number;
  readonly scriptHash: string;
  readonly productionHash: string;
};

export type ProductionCastMember = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly bio: string;
};

export type ProductionCastDraft = {
  readonly name: string;
  readonly color: string;
  readonly bio: string;
};

export type ProductionLine = {
  readonly id: string;
  readonly speaker: string | null;
  readonly text: string;
};

export type ProductionChoice = {
  readonly text: string;
  readonly next: string;
};

export type ProductionBeat = {
  readonly id: string;
  readonly chapterId: string;
  readonly title: string;
  readonly summary: string;
  readonly artDirection: string;
  readonly targetMinutes: number;
  readonly background: string;
  readonly next?: string;
  readonly choices?: readonly ProductionChoice[];
  readonly ending?: string;
};

export type ProductionScene = {
  readonly id: string;
  readonly chapterId: string;
  readonly background: string;
  readonly lines: readonly ProductionLine[];
  readonly next?: string;
  readonly choices?: readonly ProductionChoice[];
  readonly ending?: string;
};

export type UnitKind = "outline" | "scene-draft" | "scene-repair" | "image" | "validation" | "proposal";

export type UnitProvenance = {
  readonly originHead: SourceHead;
  readonly outputArtifactHash: string;
  readonly inputContentHash: string;
};

export type UnitBase = {
  readonly id: string;
  readonly kind: UnitKind;
  readonly dependencyHashes: readonly string[];
  readonly dependencyUnitIds: readonly string[];
  readonly chapterId?: string;
  readonly sceneId?: string;
  readonly lineIds?: readonly string[];
};

export type ProductionUnit = UnitBase & (
  | { readonly status: "pending" }
  | { readonly status: "running" }
  | { readonly status: "ready"; readonly outputHash: string; readonly provenance: UnitProvenance }
  | { readonly status: "failed"; readonly code: string }
  | { readonly status: "cancelled" }
  | { readonly status: "blocked"; readonly reason: string }
);

export type ProposalGate =
  | { readonly kind: "ready"; readonly digest: string }
  | { readonly kind: "blocked"; readonly reason: "unwritten-planned-target" | "plan-unapproved" | "partial-chapters" | "imported-review" | "unapproved-cast" };

export type ProductionHasher = { readonly hash: (label: string) => string };
export type ProductionIds = { readonly uuid: () => string; readonly characterId: () => string };

export type CreateProductionInput = {
  readonly sourceHead: SourceHead;
  readonly initialScope: "plan" | "edit" | "imported-draft";
  readonly brief: string;
  readonly targetMinutes: number;
  readonly hasher: ProductionHasher;
  readonly ids: ProductionIds;
  readonly scriptScenes: readonly ProductionScene[];
  readonly scriptCast: readonly ProductionCastMember[];
  readonly beats?: readonly ProductionBeat[];
  readonly selection?: { readonly sceneId: string; readonly lineIds: readonly string[] };
  readonly importedArchiveHash?: string;
};

export type ProductionSession = {
  readonly sourceHead: SourceHead;
  readonly initialScope: CreateProductionInput["initialScope"];
  readonly brief: string;
  readonly targetMinutes: number;
  readonly hasher: ProductionHasher;
  readonly ids: ProductionIds;
  readonly cast: readonly ProductionCastMember[];
  readonly beats: readonly ProductionBeat[];
  readonly scenes: readonly ProductionScene[];
  readonly units: readonly ProductionUnit[];
  readonly planApproved: boolean;
  readonly planApprovalHash: string | null;
  readonly chapterApprovals: readonly { readonly chapterId: string; readonly hash: string }[];
  readonly assetApprovals: readonly { readonly assetId: string; readonly hash: string }[];
  readonly originalScenes: readonly ProductionScene[];
  readonly originalBeats: readonly ProductionBeat[];
};

export type UnitOutput = {
  readonly hash: string;
  readonly scene?: ProductionScene;
  readonly lines?: readonly ProductionLine[];
};
