import type { PreviewSnapshot } from "@vnmaker/harness";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChoiceMenu } from "../../components/ChoiceMenu.js";
import { DialogueBox } from "../../components/DialogueBox.js";
import { Stage } from "../../components/Stage.js";
import { Toolbar } from "../../components/Toolbar.js";
import { backgroundAt, cgAt, framingAt, speakerColor, speakerName, spritesAt } from "../../engine/selectors.js";
import { useTypewriter } from "../../hooks/useTypewriter.js";
import { latestSave, writeSave, writeSlot, type SlotSave } from "../../storage/persist.js";
import {
  applyPreviewAction, bootPreview, previewSaveScope, rejectPreviewExport, restorePreviewBoundary, scriptFromPreview,
  type PreviewPlayState,
} from "./previewBoundary.js";
import { emitHarnessUi } from "./harnessEvents.js";
import { StatusBadge } from "./QualityReport.js";

function snapshotPlay(play: PreviewPlayState): SlotSave {
  return {
    sceneId: play.state.sceneId, lineIndex: play.state.lineIndex, affection: play.state.affection,
    savedAt: Date.now(), flags: play.state.flags, phase: play.state.phase, history: play.state.history,
    preview: play.pending?.boundary.targetSceneId ?? "", chapter: play.pending?.boundary.reason ?? null, thumbnail: null,
  };
}

export function CandidatePreview({
  snapshot, latestRevision, planned, onClose, onWriteScene, onReload,
}: {
  readonly snapshot: PreviewSnapshot;
  readonly latestRevision: number;
  readonly planned: number;
  readonly onClose: () => void;
  readonly onWriteScene: (sceneId: string) => void;
  readonly onReload: () => void;
}) {
  const script = useMemo(() => scriptFromPreview(snapshot, "Candidate preview"), [snapshot]);
  const [play, setPlay] = useState(() => bootPreview(script, snapshot));
  const [auto, setAuto] = useState(false);
  const [exportCode, setExportCode] = useState<string | null>(null);
  const scope = previewSaveScope(snapshot);
  const scene = script.scenes.find(row => row.id === play.state.sceneId) ?? script.scenes[0];
  const line = scene?.lines[play.state.lineIndex];
  const { shown, typing, finish } = useTypewriter(line?.text ?? "", play.state.phase === "scene" ? 0 : 0);
  const dispatch = useCallback((action: Parameters<typeof applyPreviewAction>[2]) => {
    setPlay(current => {
      const next = applyPreviewAction(script, current, action, snapshot.boundaries);
      if (next.pending !== null && current.pending === null) emitHarnessUi("boundary", next.pending);
      return next;
    });
  }, [script, snapshot.boundaries]);
  useEffect(() => {
    window.__vn = {
      sceneId: play.state.sceneId, lineIndex: play.state.lineIndex, affection: play.state.affection,
      typing, phase: play.pending !== null ? "boundary" : play.state.phase, error: play.state.error, lastDiff: null,
      flags: play.state.flags,
    };
  }, [play, typing]);
  useEffect(() => {
    if (!auto || play.pending !== null || play.state.phase !== "scene" || typing) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) dispatch({ type: "advance" }); });
    return () => { cancelled = true; };
  }, [auto, play, typing, dispatch]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      if (play.pending !== null) return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (typing) finish(); else if (play.state.phase === "scene") dispatch({ type: "advance" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, finish, play, typing]);
  if (scene === undefined) return <p role="alert">preview scene missing</p>;
  const pending = play.pending;
  const rejected = exportCode === "PREVIEW_NOT_RELEASE";
  return <div className="harness-preview" data-testid="harness-candidate-preview" data-hash={snapshot.snapshotHash} data-revision={snapshot.candidateRevision}>
    <header className="harness-preview-banner">
      <StatusBadge kind="info" label="후보 미리보기 · 배포본 아님" testId="harness-preview-kind" />
      <span data-testid="harness-preview-revision">{snapshot.candidateRevision}</span>
      <span data-testid="harness-preview-latest">{latestRevision}</span>
      <span data-testid="harness-preview-counts" data-written={snapshot.materializedScenes.length} data-planned={planned}>
        {snapshot.materializedScenes.length}/{planned}
      </span>
      {snapshot.entry.kind === "assumed-state" ? <StatusBadge kind="warning" label="검사용 상태로 진입" testId="harness-assumed-state" /> : null}
      <button type="button" className="studio-button" data-testid="harness-preview-reload" onClick={onReload}>최신 후보로 다시 열기</button>
      <button type="button" className="studio-button" data-testid="harness-preview-export" onClick={() => setExportCode(rejectPreviewExport().code)}>배포</button>
      <button type="button" className="studio-button" data-testid="harness-preview-close" onClick={onClose}>미리보기 닫기</button>
    </header>
    {rejected ? <p role="alert" data-testid="harness-preview-export-error" data-code="PREVIEW_NOT_RELEASE">PREVIEW_NOT_RELEASE</p> : null}
    <section className="stage" data-testid="stage" data-scene={scene.id}>
      <Stage background={scene.background} backgroundUrl={backgroundAt(scene, play.state.lineIndex, play.state.flags)} cgUrl={cgAt(scene, play.state.lineIndex, play.state.flags)} hideSprites={scene.hideSprites} framing={framingAt(scene, play.state.lineIndex, play.state.flags)} characters={script.characters} sprites={spritesAt(scene, play.state.lineIndex, play.state.flags)} speaking={line?.speaker ?? null} chapter={scene.chapter ?? null} sceneEpoch={play.state.sceneEpoch} transition="none" />
      {snapshot.missingAssets?.map(asset => <div key={asset.assetId} className="harness-placeholder" data-testid={`harness-placeholder-${asset.assetId}`}>{asset.role} · {asset.name}</div>)}
      <button type="button" className="click-layer" data-testid="advance-button" aria-label="다음" onClick={() => {
        if (play.pending !== null) return;
        if (typing) { finish(); return; }
        if (play.state.phase === "scene") dispatch({ type: "advance" });
      }} />
      <Toolbar auto={auto} canLoad={latestSave(false, scope) !== null} onSave={() => {
        const data = snapshotPlay(play);
        writeSave(data, false, scope);
        writeSlot(0, data, scope);
      }} onLoad={() => {
        const save = latestSave(false, scope);
        if (save === null) return;
        dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection, ...(save.flags ? { flags: save.flags } : {}), ...(save.phase ? { phase: save.phase } : {}), ...(save.history ? { history: save.history } : {}) });
      }} onAuto={() => setAuto(value => !value)} onSkip={() => dispatch({ type: "skipScene" })} onHistory={() => undefined} onSettings={() => undefined} />
      {play.state.phase === "scene" && play.pending === null ? <DialogueBox speaker={speakerName(script, line?.speaker ?? null)} color={speakerColor(script, line?.speaker ?? null)} text={shown} typing={typing} /> : null}
      {play.state.phase === "choice" && play.pending === null && scene.choices ? <ChoiceMenu flags={play.state.flags} choices={scene.choices} onPick={index => dispatch({ type: "choose", index })} onHover={() => undefined} /> : null}
    </section>
    {pending !== null ? <div className="harness-boundary" role="alertdialog" data-testid="harness-preview-boundary" data-reason={pending.boundary.reason} data-target={pending.boundary.targetSceneId}>
      <p>unwritten-scene · {pending.boundary.targetSceneId}</p>
      <button type="button" data-testid="harness-boundary-back" onClick={() => setPlay(current => restorePreviewBoundary(current))}>이전 선택으로</button>
      <button type="button" data-testid="harness-boundary-write" onClick={() => onWriteScene(pending.boundary.targetSceneId)}>작업실에서 해당 장면 작성</button>
      <button type="button" data-testid="harness-boundary-close" onClick={onClose}>미리보기 닫기</button>
    </div> : null}
  </div>;
}
