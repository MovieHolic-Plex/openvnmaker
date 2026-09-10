import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { EventGate } from "./barriers.js";

export type FixtureReply = {
  readonly status: number;
  readonly chunks: readonly string[];
  readonly contentType?: string;
  readonly beforeReply?: EventGate;
  readonly afterFirstChunk?: EventGate;
  readonly disconnect?: boolean;
};
export type RequestReceipt = { readonly sequence: number; readonly method: string; readonly path: string; readonly body: string };

/** Loopback scripted HTTP peer. Never forwards a request or loads credentials. */
export async function startFixtureProvider(routes: ReadonlyMap<string, FixtureReply>) {
  const events = new EventEmitter();
  const requests: RequestReceipt[] = [];
  const failures: Error[] = [];
  const active = new Set<Promise<void>>();
  let closed = false;
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const raw of request) {
      const chunk: unknown = raw;
      assert.ok(Buffer.isBuffer(chunk), "FIXTURE_BINARY_REQUEST");
      size += chunk.length;
      if (size > 65536) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const receipt = { sequence: requests.length + 1, method: request.method ?? "", path: request.url ?? "", body: Buffer.concat(chunks).toString("utf8") };
    requests.push(receipt);
    events.emit(`request:${receipt.sequence}`, receipt);
    const reply = routes.get(receipt.path);
    if (!reply) { response.writeHead(404).end(); return; }
    if (reply.beforeReply) await reply.beforeReply.pause();
    response.writeHead(reply.status, { "content-type": reply.contentType ?? "application/json", "x-vnmaker-fixture": "synthetic" });
    for (const [index, chunk] of reply.chunks.entries()) {
      response.write(chunk);
      events.emit(`chunk:${receipt.sequence}:${index}`, { sequence: receipt.sequence, index });
      if (index === 0 && reply.afterFirstChunk) await reply.afterFirstChunk.pause();
    }
    if (reply.disconnect) response.destroy();
    else response.end();
  }
  const server = createServer({ requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 16384 }, (request, response) => {
    const work = handle(request, response).catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      failures.push(error);
      events.emit("fixture-failure", error);
      response.destroy(error);
    });
    active.add(work);
    void work.finally(() => active.delete(work));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string", "FIXTURE_EPHEMERAL_ADDRESS");
  const url = `http://127.0.0.1:${address.port}`;
  return {
    url, port: address.port, events,
    get requests(): readonly RequestReceipt[] { return [...requests]; },
    get receipt() { return { url, port: address.port, closed, requestCount: requests.length, failures: failures.map(error => error.message) }; },
    async [Symbol.asyncDispose](): Promise<void> {
      if (closed) return;
      for (const reply of routes.values()) { reply.beforeReply?.release(); reply.afterFirstChunk?.release(); }
      const closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closing;
      await Promise.all(active);
      closed = true;
      if (failures.length) throw new AggregateError(failures, "FIXTURE_PROVIDER_FAILURE");
    },
  };
}
