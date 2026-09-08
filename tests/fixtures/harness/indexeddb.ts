export type TransactionProbe = { readonly databaseName: string; readonly action: "commit" | "abort" };

/** Serializable Playwright callback using native IDB events, not a timer-based fake.
 * Do not await an external gate inside a live IDB transaction: browsers auto-commit.
 * Gate before invoking this callback; completion/abort is the publication barrier.
 */
export async function probeIndexedDb(options: TransactionProbe) {
  const signal = AbortSignal.timeout(10000);
  // Object methods retain names natively; tsx must not inject closure-only __name helpers.
  const observer = {
    request<T>(request: IDBRequest<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        const listener = { abort() { reject(signal.reason); } };
        signal.addEventListener("abort", listener.abort, { once: true });
        request.addEventListener("success", () => { signal.removeEventListener("abort", listener.abort); resolve(request.result); }, { once: true });
        request.addEventListener("error", () => { signal.removeEventListener("abort", listener.abort); reject(request.error); }, { once: true });
        request.addEventListener("blocked", () => { signal.removeEventListener("abort", listener.abort); reject(new DOMException("Fixture database blocked", "InvalidStateError")); }, { once: true });
      });
    },
  };
  const opening = indexedDB.open(options.databaseName, 1);
  opening.addEventListener("upgradeneeded", () => opening.result.createObjectStore("receipts"), { once: true });
  const database = await observer.request(opening);
  try {
    const transaction = database.transaction("receipts", "readwrite");
    const completed = new Promise<"complete" | "abort">((resolve, reject) => {
      const listener = { timeout() { transaction.abort(); reject(signal.reason); } };
      signal.addEventListener("abort", listener.timeout, { once: true });
      transaction.addEventListener("complete", () => { signal.removeEventListener("abort", listener.timeout); resolve("complete"); }, { once: true });
      transaction.addEventListener("abort", () => { signal.removeEventListener("abort", listener.timeout); resolve("abort"); }, { once: true });
    });
    // Listeners exist before writes or commit/abort can occur.
    transaction.objectStore("receipts").put("committed-value", "head");
    switch (options.action) {
      case "commit": transaction.commit(); break;
      case "abort": transaction.abort(); break;
      default: {
        const unreachable: never = options.action;
        throw new TypeError(`Unknown IDB action: ${unreachable}`);
      }
    }
    const event = await completed;
    const read = database.transaction("receipts", "readonly").objectStore("receipts").get("head");
    const value: unknown = await observer.request(read);
    return { databaseName: options.databaseName, event, value: value ?? null, cleanup: "database-deleted" } as const;
  } finally {
    database.close();
    const deletion = indexedDB.deleteDatabase(options.databaseName);
    await observer.request(deletion);
  }
}
