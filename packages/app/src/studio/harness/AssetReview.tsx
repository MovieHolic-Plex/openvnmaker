import { useEffect, useState } from "react";
import {
  DEFAULT_BUDGET_LIMITS, PRODUCTION_IMAGE_MODEL_ID, PRODUCTION_TEXT_MODEL_ID, hashSchema, parseProductionDocument,
} from "@vnmaker/harness";
import type { VnScript } from "@vnmaker/content";
import { mutateHarnessRun, type AuthorRunView, type HarnessCapabilityView } from "../../api/harness.js";
import { ArtImportButton } from "../ArtImportButton.js";
import { AssetLibrary } from "../AssetLibrary.js";
import { AudioLibrary } from "../AudioLibrary.js";
import { registerArtwork } from "../assets.js";
import { CharacterManager } from "../CharacterManager.js";
import { MediaProvenanceEditor } from "../MediaProvenanceEditor.js";
import type { CandidateWorkspace } from "./candidateStore.js";
import { patchCandidateDocument, patchCandidateScript } from "./candidateStore.js";
import { emitHarnessUi } from "./harnessEvents.js";
import { StatusBadge } from "./QualityReport.js";
import {
  COMPARE_PANES, INSPECTION_BACKGROUNDS, authorizeUnknownRetry, createAssetReviewSession,
  generationGate, parseAssetReview, reduceAssetReview, serializeAssetReview,
  type AssetReviewSession, type AttachRole, type PendingAsset,
} from "./assetReviewModel.js";

declare global {
  interface Window { __harnessAssetFixture?: unknown }
}

function storageKey(runId: string): string { return `vnmaker.harness.asset-review.${runId}`; }

function readPending(raw: unknown): PendingAsset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const originalHash = hashSchema.safeParse(row["originalHash"]);
  const deliveryHash = hashSchema.safeParse(row["deliveryHash"]);
  const referenceHash = row["referenceHash"] === null ? { success: true as const, data: null } : hashSchema.safeParse(row["referenceHash"]);
  const role = row["role"];
  const outcome = row["outcome"];
  const pixelKind = row["pixelKind"];
  const compositing = row["compositing"];
  const target = row["target"];
  if (!originalHash.success || !deliveryHash.success || !referenceHash.success) return null;
  if (typeof row["assetId"] !== "string" || typeof row["name"] !== "string" || typeof row["url"] !== "string") return null;
  if (role !== "reference" && role !== "expression" && role !== "pose" && role !== "background" && role !== "cg") return null;
  if (outcome !== "succeeded" && outcome !== "failed" && outcome !== "unknown") return null;
  if (pixelKind !== "decoded" && pixelKind !== "header-only" && pixelKind !== "missing") return null;
  if (compositing !== "alpha" && compositing !== "legacy-chroma-key" && compositing !== "opaque") return null;
  if (typeof target !== "object" || target === null) return null;
  const aim = target as Record<string, unknown>;
  let pendingTarget: PendingAsset["target"] | null = null;
  if (aim["kind"] === "character" && typeof aim["characterId"] === "string") {
    pendingTarget = { kind: "character", characterId: aim["characterId"], ...(typeof aim["expression"] === "string" ? { expression: aim["expression"] } : {}) };
  } else if (aim["kind"] === "scene" && typeof aim["sceneId"] === "string" && aim["slot"] === "background") {
    pendingTarget = { kind: "scene", sceneId: aim["sceneId"], slot: "background" };
  } else if (aim["kind"] === "scene" && typeof aim["sceneId"] === "string" && aim["slot"] === "cg") {
    pendingTarget = { kind: "scene", sceneId: aim["sceneId"], slot: "cg" };
  }
  if (pendingTarget === null) return null;
  return {
    assetId: row["assetId"], name: row["name"], role, target: pendingTarget, originalHash: originalHash.data,
    deliveryHash: deliveryHash.data, referenceHash: referenceHash.data, compositing, url: row["url"],
    registered: row["registered"] === true, outcome, pixelKind,
    ...(typeof row["characterId"] === "string" ? { characterId: row["characterId"] } : {}),
    ...(typeof row["expression"] === "string" ? { expression: row["expression"] } : {}),
  };
}

export function AssetReview({
  source, candidate, capabilities, run, busy,
}: {
  readonly source: VnScript;
  readonly candidate: CandidateWorkspace | null;
  readonly capabilities: HarnessCapabilityView | null;
  readonly run: AuthorRunView | null;
  readonly busy: boolean;
}) {
  const live = candidate?.script ?? source;
  const document = candidate?.productionDocument ?? parseProductionDocument({
    version: 1, brief: "", castCanon: [], worldTimeline: [], branchFacts: [],
    outline: { title: source.title, subtitle: "", bible: "", start: source.start, scenes: [] },
    artDirection: [], referenceBindings: [],
  });
  const [session, setSession] = useState<AssetReviewSession>(() => createAssetReviewSession(live, document));
  const [caps, setCaps] = useState<HarnessCapabilityView | null>(capabilities);
  const [hashInput, setHashInput] = useState("");
  const [characterId, setCharacterId] = useState(live.characters[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [authorize, setAuthorize] = useState(false);
  const [attachScene, setAttachScene] = useState(live.scenes[0]?.id ?? "");
  const [attachAsset, setAttachAsset] = useState("");
  const [attachRole, setAttachRole] = useState<AttachRole>("background");
  const scene = live.scenes[0];
  useEffect(() => { setCaps(capabilities); }, [capabilities]);
  useEffect(() => {
    if (run === null) return;
    try {
      const raw: unknown = JSON.parse(sessionStorage.getItem(storageKey(run.id)) ?? "null");
      setSession(parseAssetReview(raw, live, document));
    } catch { /* studio save reports storage */ }
  }, [run?.id]);
  useEffect(() => {
    if (run === null) return;
    try { sessionStorage.setItem(storageKey(run.id), serializeAssetReview(session)); } catch { /* studio save reports storage */ }
  }, [run?.id, session]);
  useEffect(() => {
    function onFixture(event: Event): void {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail;
      if (typeof detail !== "object" || detail === null) return;
      const row = detail as Record<string, unknown>;
      if (row["kind"] === "capabilities") {
        setCaps({
          productionReady: row["productionReady"] === true, liveVerification: "not-performed",
          textModelId: typeof row["textModelId"] === "string" ? row["textModelId"] : PRODUCTION_TEXT_MODEL_ID,
          imageModelId: typeof row["imageModelId"] === "string" ? row["imageModelId"] : PRODUCTION_IMAGE_MODEL_ID,
          tokenWindowMode: "unknown", inputTokenLimit: null, textStatus: "unverified",
          imageOutputStatus: typeof row["imageOutputStatus"] === "string" ? row["imageOutputStatus"] : "unverified",
          imageReferenceStatus: typeof row["imageReferenceStatus"] === "string" ? row["imageReferenceStatus"] : "unverified",
        });
        return;
      }
      const effectId = row["effectId"];
      if (row["kind"] === "unknown-effect" && typeof effectId === "string") {
        const payloadHash = hashSchema.safeParse(row["payloadHash"]);
        if (!payloadHash.success) return;
        setSession(current => reduceAssetReview(current, { kind: "mark-unknown", effectId, payloadHash: payloadHash.data }).session);
        return;
      }
      const pending = readPending(row["kind"] === "generated" ? row["asset"] : detail);
      if (pending !== null) setSession(current => reduceAssetReview(current, { kind: "queue-generated", asset: pending }).session);
    }
    window.addEventListener("vnmaker:harness-asset-fixture", onFixture);
    return () => window.removeEventListener("vnmaker:harness-asset-fixture", onFixture);
  }, []);
  function publish(next: AssetReviewSession): void {
    setSession(next);
    if (candidate !== null) { patchCandidateScript(next.script); patchCandidateDocument(next.productionDocument); }
    emitHarnessUi("asset", { adopted: next.adoptedAssetIds, attached: next.sceneAttachments });
  }
  function onGenerate(): void {
    const gate = generationGate({
      imageModelId: caps?.imageModelId ?? PRODUCTION_IMAGE_MODEL_ID,
      textModelId: caps?.textModelId ?? PRODUCTION_TEXT_MODEL_ID,
      imageOutputStatus: caps?.imageOutputStatus ?? "unverified",
      imageReferenceStatus: caps?.imageReferenceStatus ?? "unverified",
      wantsReference: true,
    });
    if (!gate.ok) {
      setError(gate.reason);
      emitHarnessUi("asset", { phase: "blocked", reason: gate.reason });
      return;
    }
    const pending = readPending(window.__harnessAssetFixture);
    if (pending === null) { setError("FIXTURE_REQUIRED"); return; }
    const next = reduceAssetReview(session, { kind: "queue-generated", asset: pending });
    setSession(next.session);
    emitHarnessUi("asset", { phase: "generated", assetId: pending.assetId });
  }
  function onApprove(): void {
    const parsed = hashSchema.safeParse(hashInput);
    if (!parsed.success || characterId.trim().length === 0) { setError("INVALID_INPUT"); return; }
    const next = reduceAssetReview(session, { kind: "approve-reference", characterId, originalHash: parsed.data, versionId: `ref-${characterId}-v1` });
    setSession(next.session);
    emitHarnessUi("asset", { phase: "reference", characterId, hash: parsed.data });
  }
  function onAdopt(): void {
    const next = reduceAssetReview(session, { kind: "adopt" });
    if (!next.ok) { setError(next.reason); return; }
    setError(null);
    publish(next.session);
  }
  function onAttach(): void {
    const next = reduceAssetReview(session, { kind: "attach", sceneId: attachScene, assetId: attachAsset, role: attachRole });
    if (!next.ok) { setError(next.reason); return; }
    setError(null);
    publish(next.session);
  }
  async function onRetry(): Promise<void> {
    if (session.unknownEffectId === null || session.unknownPayloadHash === null) return;
    const local = authorizeUnknownRetry(session, { effectId: session.unknownEffectId, payloadHash: session.unknownPayloadHash, authorizeReplacement: authorize });
    if (!local.ok) { setError(local.reason); return; }
    setSession(local.session);
    if (run !== null) {
      try {
        await mutateHarnessRun(run.id, "retry-effect", {
          requestId: crypto.randomUUID(), expectedRunVersion: run.version,
          effectId: session.unknownEffectId, payloadHash: session.unknownPayloadHash, authorizeReplacement: true,
        });
      } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    }
    emitHarnessUi("asset", { phase: "retry-authorized", effectId: session.unknownEffectId });
  }
  const imageModel = caps?.imageModelId ?? PRODUCTION_IMAGE_MODEL_ID;
  const textModel = caps?.textModelId ?? PRODUCTION_TEXT_MODEL_ID;
  const refStatus = caps?.imageReferenceStatus ?? "unverified";
  const lastAttach = session.sceneAttachments[session.sceneAttachments.length - 1];
  const lastAdoptedId = session.adoptedAssetIds[session.adoptedAssetIds.length - 1];
  const adopted = session.script.assets?.find(asset => asset.id === lastAdoptedId);
  const previewUrl = session.pending?.url ?? adopted?.url ?? "";
  return <section className="harness-asset" data-testid="harness-asset-review" data-retry-authorized={String(session.effectState === "authorized-retry")} data-effect={session.effectState}>
    <p data-testid="harness-asset-text-model">{textModel}</p>
    <p data-testid="harness-asset-image-model">{imageModel}</p>
    <p data-testid="harness-asset-image-limit">{DEFAULT_BUDGET_LIMITS.run.imageAttempts}</p>
    <p data-testid="harness-asset-image-reference" data-status={refStatus}>{refStatus}</p>
    <StatusBadge kind={refStatus === "ready" ? "success" : "warning"} label={`image-reference:${refStatus}`} testId="harness-asset-reference-badge" />
    <div className="harness-row">
      <label>캐릭터<select data-testid="harness-reference-character" value={characterId} onChange={event => setCharacterId(event.target.value)}>{live.characters.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}</select></label>
      <label>기준 hash<input data-testid="harness-reference-hash" value={hashInput} maxLength={64} onChange={event => setHashInput(event.target.value)} /></label>
      <button type="button" data-testid="harness-approve-reference" onClick={onApprove}>기준 그림으로 지정</button>
      <button type="button" data-testid="harness-generate-asset" disabled={busy} onClick={onGenerate}>이미지 생성</button>
    </div>
    <div className="harness-row">{COMPARE_PANES.map(pane => <button key={pane} type="button" data-testid={`harness-compare-${pane}`} className={session.comparePane === pane ? "is-active" : ""} onClick={() => setSession(reduceAssetReview(session, { kind: "set-compare", pane }).session)}>{pane}</button>)}</div>
    <div className="harness-asset-compare" data-testid="harness-asset-compare" data-view={session.comparePane}>
      {INSPECTION_BACKGROUNDS.map(background => <button key={background} type="button" data-testid={`harness-inspect-${background}`} onClick={() => setSession(reduceAssetReview(session, { kind: "set-inspect", background }).session)}>{background}</button>)}
    </div>
    <div className="harness-inspect" data-testid="harness-asset-inspect" data-bg={session.inspectionBackground} data-view={session.comparePane}>
      {previewUrl !== "" ? <img src={previewUrl} alt={session.comparePane} /> : <span>비교 대기</span>}
    </div>
    <div className="harness-row">
      <button type="button" data-testid="harness-role-reject" onClick={() => setSession(reduceAssetReview(session, { kind: "role-decision", role: session.pending?.role ?? "expression", decision: "reject" }).session)}>reject</button>
      <button type="button" data-testid="harness-role-repair" onClick={() => setSession(reduceAssetReview(session, { kind: "role-decision", role: session.pending?.role ?? "expression", decision: "repair" }).session)}>repair</button>
      <button type="button" data-testid="harness-role-notes" onClick={() => setSession(reduceAssetReview(session, { kind: "role-decision", role: session.pending?.role ?? "expression", decision: "notes" }).session)}>notes</button>
      <button type="button" className="studio-button primary" data-testid="harness-adopt-asset" onClick={onAdopt}>채택</button>
    </div>
    <label><input type="checkbox" data-testid="harness-authorize-replacement" checked={authorize} onChange={event => setAuthorize(event.target.checked)} />명시적 재시도 허가</label>
    <button type="button" data-testid="harness-retry-effect" disabled={!authorize || session.effectState !== "unknown"} onClick={() => void onRetry()}>명시적 재시도</button>
    <div className="harness-row">
      <label>장면<select data-testid="harness-attach-scene" value={attachScene} onChange={event => setAttachScene(event.target.value)}>{live.scenes.map(row => <option key={row.id} value={row.id}>{row.id}</option>)}</select></label>
      <label>자산 ID<select data-testid="harness-attach-asset-id" value={attachAsset} onChange={event => setAttachAsset(event.target.value)}><option value="">선택</option>{session.script.assets?.map(asset => <option key={asset.id} value={asset.id}>{asset.id}</option>)}</select></label>
      <label>역할<select data-testid="harness-attach-role" value={attachRole} onChange={event => setAttachRole(event.target.value === "cg" || event.target.value === "pose" || event.target.value === "expression" ? event.target.value : "background")}><option value="background">background</option><option value="cg">cg</option><option value="pose">pose</option><option value="expression">expression</option></select></label>
      <button type="button" data-testid="harness-attach-asset" onClick={onAttach}>장면에 연결</button>
    </div>
    <p data-testid="harness-adopted-ids" data-ids={session.adoptedAssetIds.join(",")}>{session.adoptedAssetIds.join(",") || "none"}</p>
    <p data-testid="harness-attached-id" data-id={lastAttach?.assetId ?? ""} data-role={lastAttach?.role ?? ""} data-scene={lastAttach?.sceneId ?? ""}>{lastAttach?.assetId ?? "none"}</p>
    {error !== null ? <div className="studio-alert" role="alert" data-testid="harness-asset-error">{error}</div> : null}
    {adopted === undefined ? null : <MediaProvenanceEditor value={adopted.provenance} onChange={provenance => {
      const next = registerArtwork(session.script, { ...adopted, provenance });
      patchCandidateScript(next); setSession(current => ({ ...current, script: next }));
    }} />}
    {candidate !== null && scene !== undefined ? <>
      <CharacterManager script={session.script} onChange={next => { patchCandidateScript(next); setSession(current => ({ ...current, script: next })); }} />
      <AssetLibrary generationEnabled={false} projectEpoch={0} script={session.script} scene={scene} onChange={next => { patchCandidateScript(next); setSession(current => ({ ...current, script: next })); }} onPatchScene={patch => patchCandidateScript({ ...session.script, scenes: session.script.scenes.map(row => row.id === scene.id ? { ...row, ...patch } : row) })} />
      <ArtImportButton script={session.script} onImport={rows => { let next = session.script; for (const asset of rows) next = registerArtwork(next, asset); patchCandidateScript(next); setSession(current => ({ ...current, script: next })); }} />
      <AudioLibrary script={session.script} onChange={next => { patchCandidateScript(next); setSession(current => ({ ...current, script: next })); }} />
    </> : null}
  </section>;
}
