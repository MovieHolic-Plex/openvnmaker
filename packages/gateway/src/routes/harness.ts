import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HarnessError } from "../../../harness/src/index.js";
import type { GatewayDeps } from "../app.js";
import { createFileProofStore } from "../auth/proofs.js";
import { productionCatalogue, productionConfigDigest } from "../cca/capability-context.js";
import { headersFrom, studioRequestAllowed } from "../harness/access.js";
import { resolveHarnessCapabilities } from "../harness/capability-runtime.js";
import { readBoundedText } from "../harness/body.js";
import { fromUnknown, jsonError } from "../harness/errors.js";
import { ssePacket } from "../harness/events.js";
import type { HarnessService, JsonResult } from "../harness/service.js";

function isService(value: unknown): value is HarnessService {
  return typeof value === "object" && value !== null && "createRun" in value && "events" in value;
}

function send(result: JsonResult): Response {
  return Response.json(result.body, { status: result.status });
}

export function harnessRoutes(deps: GatewayDeps): Hono {
  const routes = new Hono();
  routes.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    if (!studioRequestAllowed(headersFrom(c.req))) return jsonError("ORIGIN_DENIED");
    return next();
  });
  const service = deps.harness;
  if (!isService(service)) {
    routes.all("*", () => jsonError("RUNNER_UNAVAILABLE"));
    return routes;
  }

  const wrap = async (c: { req: { raw: Request; method: string } }, fn: () => Promise<Response> | Response): Promise<Response> => {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HarnessError) {
        const kind = error.code === "LIMIT_EXCEEDED" && "transport" in error ? "body" : "domain";
        return jsonError(error.code, kind);
      }
      if (error instanceof TypeError) return jsonError("INVALID_INPUT");
      return fromUnknown(error);
    }
  };
  const bodyOf = async (c: { req: { raw: Request } }) => readBoundedText(c.req.raw);

  routes.get("/capabilities", c => wrap(c, async () => {
    const stored = await createFileProofStore().read();
    const resolved = resolveHarnessCapabilities({
      credentials: await deps.store.read(), now: Date.now(), proofs: stored.proofs, counters: stored.counters,
      models: productionCatalogue(), configDigest: productionConfigDigest(),
    });
    return c.json(resolved.report);
  }));
  routes.get("/runs", c => wrap(c, () => send(service.listRuns(
    c.req.query("projectId"), c.req.query("lineageId"), c.req.query("cursor"), c.req.query("limit"),
  ))));
  routes.post("/runs", c => wrap(c, async () => send(await service.createRun(await bodyOf(c)))));
  routes.get("/runs/:id", c => wrap(c, () => send(service.getRun(c.req.param("id")))));
  routes.get("/runs/:id/events", c => wrap(c, () => {
    const runId = c.req.param("id");
    service.getRun(runId);
    const after = Number(c.req.query("after") ?? "-1");
    if (!Number.isFinite(after)) return jsonError("INVALID_INPUT");
    return streamSSE(c, async stream => {
      let writes = Promise.resolve();
      const enqueue = (packet: { id: string; event: string; data: string }): void => {
        writes = writes.then(() => stream.writeSSE(packet));
      };
      const unsub = service.events.subscribe(runId, event => { enqueue(ssePacket(event)); });
      try {
        for (const event of service.events.after(runId, after)) enqueue(ssePacket(event));
        await writes;
        const signal = c.req.raw.signal;
        await new Promise<void>(resolve => {
          if (signal.aborted) { resolve(); return; }
          signal.addEventListener("abort", () => resolve(), { once: true });
        });
        await writes;
      } finally { unsub(); }
    });
  }));
  const mutate = (action: Parameters<HarnessService["mutate"]>[1]) => (c: { req: { raw: Request; param: (name: string) => string; method: string } }) =>
    wrap(c, async () => send(await service.mutate(c.req.param("id"), action, await bodyOf(c))));
  routes.post("/runs/:id/start", mutate("start"));
  routes.post("/runs/:id/approve", mutate("approve"));
  routes.post("/runs/:id/request-changes", mutate("request-changes"));
  routes.post("/runs/:id/pause", mutate("pause"));
  routes.post("/runs/:id/resume", mutate("resume"));
  routes.post("/runs/:id/budget", mutate("budget"));
  routes.post("/runs/:id/retry-effect", mutate("retry-effect"));
  routes.post("/runs/:id/cancel", mutate("cancel"));
  routes.post("/runs/:id/repropose", mutate("repropose"));
  routes.post("/runs/:id/reuse-analysis", c => wrap(c, async () => send(await service.reuseAnalysis(c.req.param("id"), await bodyOf(c)))));
  routes.get("/runs/:id/reuse-analyses/:analysisId", c => wrap(c, () => send(service.getAnalysis(c.req.param("id"), c.req.param("analysisId")))));
  routes.post("/runs/:id/previews", c => wrap(c, async () => send(await service.preview(c.req.param("id"), await bodyOf(c)))));
  routes.get("/runs/:id/previews/:previewId", c => wrap(c, () => send(service.getPreview(c.req.param("id"), c.req.param("previewId")))));
  routes.get("/runs/:id/proposals/:proposalId", c => wrap(c, () => send(service.getProposal(c.req.param("id"), c.req.param("proposalId")))));
  routes.post("/runs/:id/applied", c => wrap(c, async () => send(service.decision(c.req.param("id"), "applied", await bodyOf(c)))));
  routes.post("/runs/:id/rejected", c => wrap(c, async () => send(service.decision(c.req.param("id"), "rejected", await bodyOf(c)))));
  routes.get("/artifacts/:id", c => wrap(c, () => {
    const result = service.getArtifact(c.req.param("id"));
    if (result.bytes !== undefined && result.mime !== undefined) {
      return new Response(Uint8Array.from(result.bytes), { status: 200, headers: { "content-type": result.mime } });
    }
    return Response.json(result.body ?? { code: "INVALID_STATE" }, { status: result.status });
  }));
  return routes;
}
