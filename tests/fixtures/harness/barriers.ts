import { EventEmitter } from "node:events";

export type EventSubscription = {
  readonly source: EventEmitter;
  readonly event: string;
  readonly accept?: (value: unknown) => boolean;
};

/** Synchronous subscription; arm before triggering HTTP, IPC or process actions. */
export function armEvent(subscription: EventSubscription, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      subscription.source.off(subscription.event, receive);
      signal.removeEventListener("abort", abort);
    };
    const receive = (value: unknown) => {
      if (subscription.accept && !subscription.accept(value)) return;
      cleanup();
      resolve(value);
    };
    const abort = () => { cleanup(); reject(signal.reason); };
    subscription.source.on(subscription.event, receive);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One-shot rendezvous. Disposal releases held work even after an assertion fails. */
export class EventGate implements Disposable {
  readonly #arrived = Promise.withResolvers<void>();
  readonly #released = Promise.withResolvers<void>();
  constructor(readonly signal: AbortSignal = AbortSignal.timeout(10000)) {}
  get arrived(): Promise<void> { return this.#wait(this.#arrived.promise); }
  async #wait(pending: Promise<void>): Promise<void> {
    this.signal.throwIfAborted();
    const aborted = Promise.withResolvers<never>();
    const abort = () => aborted.reject(this.signal.reason);
    this.signal.addEventListener("abort", abort, { once: true });
    try { await Promise.race([pending, aborted.promise]); }
    finally { this.signal.removeEventListener("abort", abort); }
  }
  async pause(): Promise<void> {
    this.#arrived.resolve();
    await this.#wait(this.#released.promise);
  }
  release(): void { this.#released.resolve(); }
  [Symbol.dispose](): void { this.release(); }
}
