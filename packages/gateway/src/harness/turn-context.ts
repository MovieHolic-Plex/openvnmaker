export type ProductionTurnContext = {
  readonly contents: readonly unknown[];
  readonly tools?: unknown;
  readonly replayParts?: readonly unknown[];
  readonly functionResponses?: readonly { readonly name: string; readonly response: unknown }[];
  readonly model?: string;
};

export type ProductionTurnStore = {
  readonly load: (runId: string, unitId: string) => ProductionTurnContext | null;
  readonly save: (runId: string, unitId: string, context: ProductionTurnContext) => void;
};

export function createMemoryTurnStore(initial: readonly {
  readonly runId: string;
  readonly unitId: string;
  readonly context: ProductionTurnContext;
}[] = []): ProductionTurnStore {
  const rows = new Map<string, ProductionTurnContext>();
  for (const row of initial) rows.set(`${row.runId}:${row.unitId}`, row.context);
  return {
    load: (runId, unitId) => rows.get(`${runId}:${unitId}`) ?? null,
    save: (runId, unitId, context) => { rows.set(`${runId}:${unitId}`, context); },
  };
}
