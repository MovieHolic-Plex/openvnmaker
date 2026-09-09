import type { Run, Unit } from "../../../harness/src/index.js";

export type AuthorUnitView = {
  readonly id: Unit["id"];
  readonly kind: Unit["kind"];
  readonly status: Unit["status"];
  readonly autoRepairRound: number;
  readonly code?: string;
  readonly reason?: string;
  readonly outputArtifactHash?: string;
  readonly reusedFrom?: unknown;
};

export type AuthorRunView = {
  readonly id: Run["id"];
  readonly version: Run["version"];
  readonly sourceHead: Run["sourceHead"];
  readonly candidateRef: Run["candidateRef"];
  readonly state: Run["state"];
  readonly units: readonly AuthorUnitView[];
  readonly proposalIds: Run["proposalIds"];
  readonly budgetGroupId: Run["budgetGroupId"];
  readonly limitVersion: Run["limitVersion"];
  readonly limits: Run["limits"];
  readonly tokenPolicy: Run["tokenPolicy"];
  readonly lastEventSeq: Run["lastEventSeq"];
  readonly createdAt: Run["createdAt"];
};

export function toAuthorUnitView(unit: Unit): AuthorUnitView {
  const core = { id: unit.id, kind: unit.kind, status: unit.status, autoRepairRound: unit.autoRepairRound };
  switch (unit.status) {
    case "failed": return { ...core, code: unit.code };
    case "blocked": return { ...core, reason: unit.reason };
    case "ready": return {
      ...core,
      outputArtifactHash: unit.provenance.outputArtifactHash,
      ...(unit.provenance.reusedFrom === undefined ? {} : { reusedFrom: unit.provenance.reusedFrom }),
    };
    case "pending": case "running": case "cancelled": return core;
    default: {
      const exhaustive: never = unit;
      return exhaustive;
    }
  }
}

export function toAuthorRunView(run: Run): AuthorRunView {
  return {
    id: run.id, version: run.version, sourceHead: run.sourceHead, candidateRef: run.candidateRef,
    state: run.state, units: run.units.map(toAuthorUnitView), proposalIds: run.proposalIds,
    budgetGroupId: run.budgetGroupId, limitVersion: run.limitVersion, limits: run.limits,
    tokenPolicy: run.tokenPolicy, lastEventSeq: run.lastEventSeq, createdAt: run.createdAt,
  };
}
