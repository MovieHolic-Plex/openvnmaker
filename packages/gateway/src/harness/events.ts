export type HarnessStreamEvent = {
  readonly seq: number;
  readonly type: string;
  readonly payload: unknown;
};

export class EventLog {
  private readonly rows = new Map<string, HarnessStreamEvent[]>();
  private readonly listeners = new Map<string, Set<(event: HarnessStreamEvent) => void>>();

  after(runId: string, seq: number): readonly HarnessStreamEvent[] {
    return (this.rows.get(runId) ?? []).filter(event => event.seq > seq);
  }

  append(runId: string, type: string, payload: unknown, seq: number): HarnessStreamEvent {
    const event: HarnessStreamEvent = { seq, type, payload };
    const list = this.rows.get(runId) ?? [];
    const next = [...list, event];
    this.rows.set(runId, next);
    const subs = this.listeners.get(runId);
    if (subs !== undefined) {
      for (const listener of [...subs]) listener(event);
    }
    return event;
  }

  subscribe(runId: string, listener: (event: HarnessStreamEvent) => void): () => void {
    const set = this.listeners.get(runId) ?? new Set<(event: HarnessStreamEvent) => void>();
    set.add(listener);
    this.listeners.set(runId, set);
    return () => { set.delete(listener); };
  }
}

export function ssePacket(event: HarnessStreamEvent): { id: string; event: string; data: string } {
  return { id: String(event.seq), event: event.type, data: JSON.stringify(event.payload) };
}
