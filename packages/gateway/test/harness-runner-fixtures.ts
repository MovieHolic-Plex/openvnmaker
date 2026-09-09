import {
  DEFAULT_BUDGET_LIMITS, capabilityBindingSchema, contextManifestSchema, hashSchema, parseRun, revisionSchema,
  runIdSchema, unitIdSchema, uuidSchema,
} from "../../harness/src/index.js";
import type {
  CapabilityBinding, ProductionRunner, ProviderDispatch, ProviderDispatchRequest, ProviderDispatchResult,
  RunnerClock, RunnerDeps, Run, TokenCounterPort, Unit,
} from "../../harness/src/index.js";
import { createProductionRunner, MemoryRunnerStore } from "../../harness/src/index.js";
import { capability, hash, head } from "../../harness/test/fixtures.js";

export const HASH = {
  a: hash, b: "b".repeat(64), c: "c".repeat(64), d: "d".repeat(64), e: "e".repeat(64),
  out1: "1".repeat(64), out2: "2".repeat(64), out3: "3".repeat(64),
} as const;
export const IDS = {
  run: "00000000-0000-4000-8000-000000000001",
  candidate: "00000000-0000-4000-8000-000000000002",
  u1: "00000000-0000-4000-8000-000000000003",
  u2: "00000000-0000-4000-8000-000000000004",
  u3: "00000000-0000-4000-8000-000000000005",
  group: "00000000-0000-4000-8000-000000000006",
  holder: "00000000-0000-4000-8000-000000000007",
} as const;

export function sequentialIds(start = 32): { readonly uuid: () => string } {
  let n = start;
  return {
    uuid: () => {
      const value = `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
      n += 1;
      return uuidSchema.parse(value);
    },
  };
}

export function mutableClock(start = 0): RunnerClock & { readonly set: (value: number) => void; readonly advance: (ms: number) => void } {
  let now = start;
  return { now: () => now, set: (value) => { now = value; }, advance: (ms) => { now += ms; } };
}

export function exactCounterPort(): TokenCounterPort {
  return {
    count: ({ requestPayloadHash, capabilityBindingHash }) => ({
      kind: "exact", requestPayloadHash, capabilityBindingHash, inputTokens: 100,
      includes: { text: true, tools: true, history: true, opaque: true, images: true },
    }),
  };
}

export function productionCapability(): CapabilityBinding {
  return capabilityBindingSchema.parse(capability);
}

export function pendingUnit(id: string, kind: Unit["kind"], dependencyHashes: readonly string[]): Unit {
  return {
    id: unitIdSchema.parse(id), kind, dependencyHashes: dependencyHashes.map(value => hashSchema.parse(value)),
    contextManifest: contextManifestSchema.parse({
      sourceHead: head, inputContentHash: HASH.a, windows: [], facts: [], readSet: [],
      referenceBindingHashes: [], excluded: [],
    }),
    autoRepairRound: 0, status: "pending",
  };
}

export function idleRun(units: readonly Unit[]): Run {
  return parseRun({
    schemaVersion: 1, id: IDS.run, version: 0, sourceHead: head,
    candidateRef: { candidateId: IDS.candidate, revision: 0 },
    state: { status: "idle" }, units, proposalIds: [], budgetGroupId: IDS.group, budgetOwnerRunId: IDS.run,
    limitVersion: 0, limits: DEFAULT_BUDGET_LIMITS, tokenPolicy: "exact-only",
    lastEventSeq: 0, ownerEpoch: 0, createdAt: "2026-09-09T00:00:00.000Z",
  });
}

export function chainedUnits(): readonly Unit[] {
  return [
    pendingUnit(IDS.u1, "outline", []),
    pendingUnit(IDS.u2, "scene-draft", [HASH.out1]),
    pendingUnit(IDS.u3, "scene-draft", [HASH.out2]),
  ];
}

export function outputsFor(unitId: string): string {
  switch (unitId) {
    case IDS.u1: return HASH.out1;
    case IDS.u2: return HASH.out2;
    case IDS.u3: return HASH.out3;
    default: return HASH.d;
  }
}

export function recordingDispatch(options?: {
  readonly hold?: () => Promise<void>;
  readonly reply?: (request: ProviderDispatchRequest) => ProviderDispatchResult | Promise<ProviderDispatchResult>;
}): ProviderDispatch & { readonly calls: number; readonly unitIds: readonly string[] } {
  const unitIds: string[] = [];
  return {
    get calls() { return unitIds.length; },
    get unitIds() { return unitIds; },
    async dispatch(request) {
      unitIds.push(request.unitId);
      if (options?.hold) await options.hold();
      if (options?.reply) return options.reply(request);
      return {
        kind: "succeeded",
        artifact: { artifactId: request.effectId, hash: hashSchema.parse(outputsFor(request.unitId)), bytes: 8 },
        usage: { knownInputUsage: 11, knownOutputUsage: 7 },
      };
    },
  };
}

export function startCommand(run: Run, unitIds: readonly string[], requestId: string, limits = run.limits, tokenPolicy = run.tokenPolicy) {
  return {
    action: "start" as const, requestId, expectedRunVersion: run.version,
    scope: { kind: "chapter" as const, chapterIds: ["ch1"], unitIds: unitIds.map(id => unitIdSchema.parse(id)) },
    reviewDigest: hashSchema.parse(HASH.a), limits, tokenPolicy,
  };
}

export function cancelCommand(run: Run, requestId: string) {
  return { action: "cancel" as const, requestId, expectedRunVersion: run.version, reason: "stop the run" };
}

export function resumeCommand(run: Run, requestId: string, capabilityBindingHash: string) {
  return {
    action: "resume" as const, requestId, expectedRunVersion: run.version,
    observedSourceHead: run.sourceHead, capabilityBindingHash: hashSchema.parse(capabilityBindingHash),
  };
}

export function waitForState(runner: ProductionRunner, predicate: (run: Run) => boolean, signal = AbortSignal.timeout(5000)): Promise<Run> {
  return new Promise((resolve, reject) => {
    const off = runner.subscribe(event => {
      if (event.type === "state" && predicate(event.run)) {
        off();
        resolve(event.run);
      }
    });
    const abort = () => { off(); reject(signal.reason); };
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

export function makeRunner(overrides: Partial<RunnerDeps> & { readonly dispatch?: ProviderDispatch } = {}) {
  const store = overrides.store ?? new MemoryRunnerStore();
  const dispatch = overrides.dispatch ?? recordingDispatch();
  const clock = overrides.clock ?? mutableClock(0);
  const ids = overrides.ids ?? sequentialIds();
  const runner = createProductionRunner({
    store, dispatch, clock, ids, capability: overrides.capability ?? productionCapability(),
    counter: overrides.counter ?? exactCounterPort(),
    ...(overrides.beforeDispatch ? { beforeDispatch: overrides.beforeDispatch } : {}),
  });
  return { runner, store, dispatch, clock, ids };
}

export { runIdSchema, revisionSchema };
