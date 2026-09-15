import {withNarrativeIds} from "./studio/narrativeIds.js";
import { CharacterManager } from "./studio/CharacterManager.js";
import { ProjectLibrary } from "./studio/ProjectLibrary.js";
import { ACTIVE_PROJECT_KEY, activateProject } from "./studio/projects.js";
import { useProjectAutosave } from "./studio/useProjectAutosave.js";
import { ProjectRecovery } from "./studio/ProjectRecovery.js";
import { ActorAvatar } from "./studio/ActorAvatar.js";
import { LIMITS, auditScript, lineAllowed, parseScript, type StoryIssue } from "@vnmaker/content";
import type { Line, Scene, VnScript } from "@vnmaker/content";
import { memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DialogueBox } from "./components/DialogueBox.js";
import { Stage } from "./components/Stage.js";
import { backgroundAt, cgAt, framingAt, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { Icon, type IconName } from "./studio/Icon.js";
import { Inspector, expressionLabel } from "./studio/Inspector.js";
import { backgroundSrc, historyReducer, loadProject, newSceneId, POSITION_KEY, PROJECT_KEY, sceneTitle } from "./studio/project.js";
import { ProjectOverview, durationLabel } from "./studio/ProjectOverview.js";
import { ManuscriptReview } from "./studio/ManuscriptReview.js";
import { ProductionPanel } from "./studio/ProductionPanel.js";
import { AiPanel } from "./studio/AiPanel.js";
import { AssetLibrary } from "./studio/AssetLibrary.js";
import { CommandPalette } from "./studio/CommandPalette.js";
import { ExportBundleButton } from "./studio/ExportBundleButton.js";
import { NativeBuildButton } from "./studio/NativeBuildButton.js";
import { SceneTools } from "./studio/SceneTools.js";
import { StoryMap } from "./studio/StoryMap.js";
import { VersionHistory } from "./studio/VersionHistory.js";
import { saveVersion } from "./studio/versions.js";
import { parseEditorPosition, previewFlagsFor, type PreviewChoices } from "./studio/editorPosition.js";
import { editIssue } from "./studio/editGuard.js";
import { duplicateLine, insertLines, moveLine, removeLine } from "./studio/lineOperations.js";
import { moveScene, renameScene } from "./studio/sceneOperations.js";
import { collectMediaReferences, findMissingMedia, type MediaReference } from "./studio/mediaIntegrity.js";
import { ensureAssetServer } from "./storage/projectAssets.js";

type View = "overview" | "stage" | "production" | "graph" | "assets" | "characters";
const views: { id: View; name: string; icon: IconName }[] = [{ id: "overview", name: "프로젝트 홈", icon: "home" }, { id: "stage", name: "장면 편집", icon: "scenes" }, { id: "production", name: "원고·분량", icon: "layers" }, { id: "graph", name: "스토리 맵", icon: "graph" }, { id: "assets", name: "아트 디렉션", icon: "image" }, { id: "characters", name: "등장인물", icon: "users" }];
/** 검증 목록 한 항목. 원고 감사 결과와 미디어 누락을 같은 목록에 보인다. */
interface Issue { readonly sceneId?: string; readonly view?: View; readonly message: string; readonly severity: "error" | "warning" }

// 장편에서는 키 입력 한 번에 256개 장면 항목과 수십 개 대사 줄을 다시 만드는 비용이 타이핑 지연의 대부분이다.
// 바뀌지 않은 장면·대사는 같은 객체이므로 memo 가 그대로 건너뛴다.
const SceneRailItem = memo(function SceneRailItem({ scene, index, total, selected, onSelect, onMove }: { scene: Scene; index: number; total: number; selected: boolean; onSelect: (id: string) => void; onMove: (id: string, to: number) => void }) {
  return <li className={selected ? "is-current" : ""}><button type="button" className={selected ? "is-selected" : ""} data-testid={`studio-scene-${scene.id}`} onClick={() => onSelect(scene.id)}><span className="scene-thumb"><img src={backgroundSrc(scene)} alt="" loading="lazy" /><small>{String(index + 1).padStart(2, "0")}</small></span><span className="scene-copy"><strong>{sceneTitle(scene).replace(/^\d+장\s*[A-Z]?\s*·\s*/, "")}</strong><small>{scene.lines.length}줄 <span>·</span> {scene.choices?.length ? `분기 ${scene.choices.length}` : scene.ending ? "엔딩" : "장면"}</small></span>{scene.choices?.length ? <Icon name="graph" size={13} /> : scene.ending ? <span className="ending-dot" /> : null}</button>{selected && <span className="scene-item-actions"><button type="button" className="icon-button" aria-label="장면 위로 이동" title="Alt+Shift+↑" disabled={index === 0} onClick={() => onMove(scene.id, index - 1)}>↑</button><button type="button" className="icon-button" aria-label="장면 아래로 이동" title="Alt+Shift+↓" disabled={index === total - 1} onClick={() => onMove(scene.id, index + 1)}>↓</button></span>}</li>;
});
const LineRow = memo(function LineRow({ line, index, selected, name, color, actor, onSelect }: { line: Line; index: number; selected: boolean; name: string | null; color: string; actor: VnScript["characters"][number] | undefined; onSelect: (index: number) => void }) {
  return <li><button type="button" className={selected ? "is-selected" : ""} data-testid={`studio-line-${index}`} onClick={() => onSelect(index)}><span className="line-number">{String(index + 1).padStart(2, "0")}</span><span className="line-speaker" style={{ color }}><ActorAvatar actor={actor} id={line.speaker} />{name ?? "내레이션"}</span><span className="line-copy">{line.text || "대사를 입력하세요…"}</span><span className="line-expression">{line.cgUrl !== undefined ? line.cgUrl ? "CG" : "BG" : line.expression ? expressionLabel(line.expression) : ""}</span>{selected && <span className="line-selected-mark" />}</button></li>;
});
/** 씬 목록이 보여 주는 값만 뽑은 서명. 대사 본문만 바뀐 키 입력에서는 서명이 같아 목록 전체(장편이면 256개 항목)를 다시 만들지 않는다. */
export function railSignature(scenes: readonly Scene[]): string {
  return scenes.map(scene => `${scene.id}\u0001${scene.chapter ?? ""}\u0001${scene.lines.length}\u0001${scene.choices?.length ?? 0}\u0001${scene.ending ?? ""}\u0001${backgroundSrc(scene)}`).join("\n");
}
const SceneRail = memo(function SceneRail({ scenes, selectedId, query, onSelect, onMove }: { scenes: readonly Scene[]; selectedId: string; query: string; onSelect: (id: string) => void; onMove: (id: string, to: number) => void }) {
  const lowered = query.toLocaleLowerCase();
  return <>{scenes.map((row, i) => !lowered || `${row.id} ${row.chapter ?? ""}`.toLocaleLowerCase().includes(lowered) ? <SceneRailItem key={row.id} scene={row} index={i} total={scenes.length} selected={row.id === selectedId} onSelect={onSelect} onMove={onMove} /> : null)}</>;
});
const MemoAssetLibrary = memo(AssetLibrary);
const MemoAiPanel = memo(AiPanel);

export function StudioApp({recoveryInitial}:{recoveryInitial?:ReturnType<typeof loadProject>}={}) {
  const [initial] = useState(()=>recoveryInitial??loadProject());
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.script, future: [] });
  const script = history.present;
  const presentRef = useRef(script); presentRef.current = script;
  const [activeProjectId,setActiveProjectId]=useState(()=>{try{return localStorage.getItem(ACTIVE_PROJECT_KEY)||"original-project";}catch{return "original-project";}});
  const [position] = useState(() => {
    try { return parseEditorPosition(localStorage.getItem(POSITION_KEY)); } catch { return {}; }
  });
  const [sceneId, setSceneId] = useState(position.sceneId ?? initial.script.start);
  const [lineIndex, setLineIndex] = useState(Number.isInteger(position.lineIndex) ? Math.max(0,position.lineIndex!) : 0);
  const [view, setView] = useState<View>(views.some(view=>view.id===position.view) ? position.view as View : "overview");
  const [previewChoices, setPreviewChoices] = useState<PreviewChoices>(position.choices ?? {});
  const previewFlags = useMemo(() => previewFlagsFor(script, previewChoices), [script, previewChoices]);
  const [artOnly, setArtOnly] = useState(false);
  const [rightTab, setRightTab] = useState<"ai" | "inspector">("inspector");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [sessionSaveError, setSaveError] = useState(initial.error);
  const [saveEnabled, setSaveEnabled] = useState(!initial.error);
  const [saveRetry,setSaveRetry]=useState(0);
  const autosave=useProjectAutosave(activeProjectId,script,saveEnabled,saveRetry);
  const saveError=sessionSaveError||autosave.error;
  function retrySave(){setSaveError(null);setSaveEnabled(true);setSaveRetry(value=>value+1);}
  const [showIssues, setShowIssues] = useState(false);
  const [previewGate, setPreviewGate] = useState<"blocked" | "warning" | null>(null);
  const [showScenes, setShowScenes] = useState(false);
  const [focusMode, setFocusMode] = useState(position.focusMode === true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [productionOpen, setProductionOpen] = useState(false);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const projectEpochRef = useRef(0);
  const revisionRef = useRef(0);
  const importToken = useRef(0);
  function changeProjectEpoch() { projectEpochRef.current += 1; setProjectEpoch(projectEpochRef.current); }
  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const lineTextRef = useRef<HTMLTextAreaElement>(null);
  const pendingFocus = useRef(false);
  const [previewWidth, setPreviewWidth] = useState(720);
  const scene = script.scenes.find(row => row.id === sceneId) ?? script.scenes[0]!;
  const index = Math.min(lineIndex, scene.lines.length - 1);
  const line = scene.lines[index]!;
  const sceneNumber = script.scenes.findIndex(row => row.id === scene.id) + 1;
  const positionRef = useRef({ scene, index }); positionRef.current = { scene, index };
  // 조건 분기 장편에서는 작품 감사와 분량 추정이 각각 수백 ms 걸린다. 키를 누를 때마다 다시 돌리면
  // 타이핑이 그 계산을 기다린다. 입력이 잠시 멈춘 뒤 한 번만 다시 계산하고, 그 사이에는 직전 값을 보여 준다.
  // 300ms 뒤에도 브라우저가 한가할 때(입력이 없을 때) 계산한다 — 장면을 바꾸고 바로 타이핑을 시작하면 감사가 첫 키 입력과 겹쳐 멈칫했다.
  const [analysisScript, setAnalysisScript] = useState(script);
  useEffect(() => {
    let idle: number | undefined;
    const timer = window.setTimeout(() => {
      const run = () => setAnalysisScript(script);
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 1500 }); else run();
    }, 300);
    return () => { window.clearTimeout(timer); if (idle !== undefined) window.cancelIdleCallback(idle); };
  }, [script]);
  const issues = useMemo(() => auditScript(analysisScript), [analysisScript]);
  const scriptDuration = useMemo(() => durationLabel(analysisScript), [analysisScript]);
  const analysisScene = useMemo(() => analysisScript.scenes.find(row => row.id === scene.id) ?? analysisScript.scenes[0]!, [analysisScript, scene.id]);
  // 미디어 누락 검사: 원고가 잠시 멈췄을 때 새 주소만 확인한다. 이미 있는 것으로 확인한 파일은 다시 요청하지 않는다.
  const [missingMedia, setMissingMedia] = useState<MediaReference[]>([]);
  const knownMedia = useRef(new Set<string>());
  useEffect(() => {
    const refs = collectMediaReferences(analysisScript);
    if (!refs.length) { setMissingMedia([]); return; }
    const controller = new AbortController();
    void findMissingMedia(refs, { signal: controller.signal, known: knownMedia.current, ensureUserAssets: ensureAssetServer }).then(result => {
      if (controller.signal.aborted) return;
      for (const url of result.available) knownMedia.current.add(url);
      setMissingMedia(result.missing);
    });
    return () => controller.abort();
  }, [analysisScript]);
  const allIssues = useMemo<Issue[]>(() => [...issues, ...missingMedia.map<Issue>(ref => ({ ...(ref.sceneId ? { sceneId: ref.sceneId } : { view: ref.kind === "portrait" ? "characters" : "assets" }), message: `파일을 찾을 수 없습니다: ${ref.label} (${ref.url})`, severity: "warning" }))], [issues, missingMedia]);
  const errors = issues.filter(issue => issue.severity === "error");
  const totalLines = script.scenes.reduce((sum, row) => sum + row.lines.length, 0);
  /** 모든 편집이 지나는 문. 파서가 거부할 원고는 여기서 사유와 함께 막는다 — 저장 실패 뒤 새로고침으로 원고를 잃는 것보다 낫다. */
  const edit = useCallback((next: VnScript, group?: string): boolean => {
    const current = presentRef.current;
    const issue = editIssue(current, next);
    if (issue) { setNotice(`변경을 적용하지 않았습니다. ${issue}`); return false; }
    revisionRef.current += 1;
    dispatch({ type: "edit", script: withNarrativeIds(next, undefined, current), at: Date.now(), ...(group ? { group } : {}) });
    return true;
  }, []);
  const patchScene = useCallback((next: Scene, group?: string) => edit({ ...script, scenes: script.scenes.map(row => row.id === next.id ? next : row) }, group), [edit, script]);
  const patchLine = useCallback((next: Line) => patchScene({ ...scene, lines: scene.lines.map((row, i) => i === index ? next : row) }, `line-${scene.id}-${index}`), [patchScene, scene, index]);
  const applyAiProposal = useCallback((next: VnScript, nextSceneId: string, nextLineIndex: number) => {
    if (!edit(next)) return;
    setSceneId(nextSceneId);
    setLineIndex(nextLineIndex);
    setNotice("AI 제안을 적용했습니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.");
  }, [edit]);
  const selectScene = useCallback((id: string) => { setSceneId(id); setLineIndex(0); setShowScenes(false); }, []);
  const openScene = useCallback((id: string) => { selectScene(id); setView("stage"); setCommandOpen(false); }, [selectScene]);
  const openSceneFromRail = useCallback((id: string) => { selectScene(id); setView("stage"); }, [selectScene]);
  const selectLine = useCallback((i: number) => { setLineIndex(i); setRightTab("inspector"); }, []);
  const moveSceneTo = useCallback((id: string, to: number) => { edit(moveScene(presentRef.current, id, to)); }, [edit]);
  function undoRedo(type: "undo" | "redo") { revisionRef.current += 1; changeProjectEpoch(); setPreviewChoices({}); dispatch({ type }); }
  const isWideView = view !== "stage";
  const focusLineText = useCallback(() => { pendingFocus.current = true; }, []);
  useEffect(() => { if (pendingFocus.current) { pendingFocus.current = false; lineTextRef.current?.focus(); } });

  useEffect(() => { try { localStorage.setItem(POSITION_KEY, JSON.stringify({ sceneId: scene.id,lineIndex:index,view,focusMode,choices:previewChoices })); } catch { /* Project save reports storage failures. */ } }, [scene.id,index,view,focusMode,previewChoices]);
  useEffect(() => {
    const host = stageRef.current; if (!host) return;
    let frame: number | undefined;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect; if (!rect) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      const width = Math.min(rect.width, rect.height * 16 / 9);
      frame = requestAnimationFrame(() => {frame=undefined;setPreviewWidth(width);});
    });
    observer.observe(host); return () => {observer.disconnect();if(frame!==undefined)cancelAnimationFrame(frame);};
  }, [view, focusMode]);
  function moveLineBy(delta: number) {
    const { scene, index } = positionRef.current;
    const next = moveLine(scene, index, index + delta);
    if (next !== scene && patchScene(next)) setLineIndex(index + delta);
  }
  function moveSceneBy(delta: number) {
    const current = presentRef.current; const id = positionRef.current.scene.id;
    const at = current.scenes.findIndex(row => row.id === id);
    const to = at + delta; if (to < 0 || to >= current.scenes.length) return;
    edit(moveScene(current, id, to));
  }
  const shortcuts = useRef({ moveLineBy, moveSceneBy, undoRedo, retrySave }); shortcuts.current = { moveLineBy, moveSceneBy, undoRedo, retrySave };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") { setShowIssues(false); setPreviewGate(null); setShowScenes(false); setCommandOpen(false); }
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && !event.isComposing) {
        event.preventDefault();
        const delta = event.key === "ArrowUp" ? -1 : 1;
        if (event.shiftKey) shortcuts.current.moveSceneBy(delta); else shortcuts.current.moveLineBy(delta);
        return;
      }
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(value => !value); return; }
      const target = event.target as HTMLElement;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); shortcuts.current.retrySave(); }
      // 입력란 안에서는 브라우저의 입력 되돌리기를 그대로 둔다. 앱 실행 취소는 그 밖에서만.
      if (target.matches("input,textarea,select,[contenteditable=true]")) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); shortcuts.current.undoRedo(event.shiftKey ? "redo" : "undo"); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); shortcuts.current.undoRedo("redo"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);
  // 제목은 지우고 다시 쓸 수 있어야 한다. 비어 있는 동안은 원고에 반영하지 않고, 포커스를 잃으면 이전 제목으로 돌아간다.
  const [titleDraft, setTitleDraft] = useState(script.title);
  useEffect(() => { setTitleDraft(script.title); }, [script.title]);

  function addScene() {
    if (script.scenes.length >= LIMITS.scenes) { setNotice(`씬은 최대 ${LIMITS.scenes}개까지 만들 수 있습니다. 씬을 합치거나 새 작품으로 나누세요.`); return; }
    const id = newSceneId();
    const { id: _id, chapter: _chapter, lines: _lines, ...inherited } = scene;
    const next: Scene = { ...inherited, id, chapter: "새로운 장면", lines: [{ speaker: null, text: "이곳에서 새로운 이야기가 시작된다." }] };
    const { choices: _choices, ending: _ending, ...previous } = scene;
    const movedExit = scene.choices?.length ? "선택지" : scene.ending ? "엔딩" : null;
    if (!edit({ ...script, scenes: script.scenes.flatMap(row => row.id === scene.id ? [{ ...previous, next: id }, next] : [row]) })) return;
    selectScene(id); setView("stage"); setRightTab("inspector"); setNotice(movedExit ? `현재 씬 뒤에 새 씬을 연결했습니다. 기존 ${movedExit}는 새 씬으로 옮겼습니다.` : "현재 씬 뒤에 새 씬을 연결했습니다.");
  }
  function addLine() {
    if (scene.lines.length >= LIMITS.sceneLines) { setNotice(`한 씬에는 대사를 최대 ${LIMITS.sceneLines.toLocaleString()}줄까지 쓸 수 있습니다. 씬을 나누세요.`); return; }
    if (!patchScene({ ...scene, lines: [...scene.lines.slice(0, index + 1), { speaker: scene.lines[index]?.speaker ?? null, text: "" }, ...scene.lines.slice(index + 1)] })) return;
    setLineIndex(index + 1); setRightTab("inspector"); setFocusMode(false); focusLineText();
  }
  function duplicateCurrentLine() {
    if (scene.lines.length >= LIMITS.sceneLines) { setNotice(`한 씬에는 대사를 최대 ${LIMITS.sceneLines.toLocaleString()}줄까지 쓸 수 있습니다.`); return; }
    if (patchScene(duplicateLine(scene, index))) { setLineIndex(index + 1); setRightTab("inspector"); }
  }
  function deleteCurrentLine() {
    if (scene.lines.length <= 1) return;
    if (patchScene(removeLine(scene, index))) { setLineIndex(Math.max(0, index - 1)); setNotice("대사를 삭제했습니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다."); }
  }
  function insertPastedLines(lines: readonly Line[], replaceCurrent: boolean) {
    if (scene.lines.length + lines.length - (replaceCurrent ? 1 : 0) > LIMITS.sceneLines) { setNotice(`붙여넣으면 씬당 ${LIMITS.sceneLines.toLocaleString()}줄 상한을 넘습니다. 씬을 나누세요.`); return; }
    const [first, ...rest] = lines;
    const base = replaceCurrent && first ? { ...scene, lines: scene.lines.map((row, i) => i === index ? { ...row, speaker: first.speaker, text: first.text } : row) } : scene;
    if (patchScene(insertLines(base, index, replaceCurrent ? rest : lines))) setNotice(`${lines.length}줄로 나눠 넣었습니다. 화자 인식 ${lines.filter(row => row.speaker).length}줄.`);
  }
  function renameCurrentScene(nextId: string): string | null {
    try {
      const next = renameScene(script, scene.id, nextId);
      if (!edit(next)) return "변경을 적용하지 못했습니다.";
      setSceneId(nextId); setNotice("씬 ID를 바꾸고 연결을 갱신했습니다.");
      return null;
    } catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  function startPreview() {
    try {
      sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(script));
      sessionStorage.setItem("vnmaker.previewPosition", JSON.stringify({ sceneId: scene.id, lineIndex: index, flags: previewFlags }));
      window.location.href = "/?preview=1";
    } catch { setSaveError("미리보기 데이터를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요."); }
  }
  /** 현재 장면과 바로 이어지는 장면의 오류만 미리보기를 막는다. 집필 중인 장편은 어딘가 늘 미완성이다. */
  function play() {
    const liveIssues = analysisScript === script ? issues : auditScript(script);
    if (analysisScript !== script) setAnalysisScript(script);
    const liveErrors = liveIssues.filter(issue => issue.severity === "error");
    const exits = scene.choices?.length ? scene.choices.map(choice => choice.next) : scene.next ? [scene.next] : [];
    if (liveErrors.some(issue => issue.sceneId === scene.id || exits.includes(issue.sceneId))) { setPreviewGate("blocked"); setShowIssues(true); return; }
    if (liveErrors.length) { setPreviewGate("warning"); setShowIssues(true); return; }
    startPreview();
  }
  function closeIssues() { setShowIssues(false); setPreviewGate(null); }
  function exportProject() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(script, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `${script.title.replace(/[<>:"/\\|?*]/g, "-")}.vn.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000); setNotice("작품 JSON을 내보냈습니다. 포함된 기본 아트는 앱의 assets 폴더에서 재생됩니다.");
  }
  async function importProject(file?: File) {
    if (!file) return;
    const token = ++importToken.current;
    const revision = revisionRef.current;
    const isCurrent = () => token === importToken.current && revision === revisionRef.current;
    try {
      if (file.size > 5_000_000) throw new Error("5MB 이하의 작품 JSON을 선택하세요.");
      const next = parseScript(JSON.parse(await file.text()));
      if (!isCurrent()) throw new Error("가져오는 동안 원고가 변경되어 덮어쓰기를 중단했습니다. 현재 작업을 저장한 뒤 다시 가져오세요.");
      await saveVersion(activeProjectId,script,"가져오기 직전 작업");
      if (!isCurrent()) throw new Error("가져오는 동안 원고가 변경되어 덮어쓰기를 중단했습니다. 현재 작업을 저장한 뒤 다시 가져오세요.");
      changeProjectEpoch(); setPreviewChoices({}); edit(next); selectScene(next.start); setSaveEnabled(true); setView("stage"); setNotice("작품을 가져왔습니다. 실행 취소로 이전 작품을 복원할 수 있습니다.");
    } catch (err) { if (token === importToken.current) setNotice(`가져오기 실패: ${err instanceof Error ? err.message : String(err)}`); }
    if (token === importToken.current && fileInput.current) fileInput.current.value = "";
  }
  const assetChange = useCallback((next: VnScript) => { if (projectEpoch === projectEpochRef.current) edit(next); }, [edit, projectEpoch]);
  // patchScene 은 원고가 바뀔 때마다 새 함수가 되어 memo 를 무력화한다 — 숨겨진 아트 라이브러리는 ref 로 현재 장면을 읽는다.
  const assetPatchScene = useCallback((patch: Partial<Scene>) => { const current = presentRef.current; const target = positionRef.current.scene; edit({ ...current, scenes: current.scenes.map(row => row.id === target.id ? { ...target, ...patch } : row) }); }, [edit]);
  const lowered = query.toLocaleLowerCase();
  const sceneVisible = (row: Scene) => !lowered || `${row.id} ${row.chapter ?? ""}`.toLocaleLowerCase().includes(lowered);
  const noSceneMatches = lowered && !script.scenes.some(sceneVisible);
  const railKey = railSignature(script.scenes);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 서명이 같으면 목록에 보이는 값이 같다.
  const railScenes = useMemo(() => script.scenes, [railKey]);
  const nearSceneCap = script.scenes.length >= LIMITS.scenes - 30;
  const nearLineCap = scene.lines.length >= LIMITS.sceneLines - 200;
  return <div className={`studio studio-modern ${isWideView ? "studio-wide" : ""} ${focusMode && !isWideView ? "studio-focus" : ""}`}>
    <header className="studio-top">
      <button className="studio-brand" onClick={() => setView("overview")} aria-label="VN Maker 스튜디오 홈"><span className="brand-mark"><Icon name="layers" size={23} /></span><strong>VN<span>MAKER</span></strong><small>STUDIO</small></button>
      <div className="project-heading"><Icon name="file" size={15} /><input aria-label="작품 제목" value={titleDraft} maxLength={200} onChange={event => { setTitleDraft(event.target.value); if (event.target.value.trim()) edit({ ...script, title: event.target.value }, "title"); }} onBlur={() => { if (!titleDraft.trim()) setTitleDraft(script.title); }} /><span className={`save-state ${saveError ? "has-error" : ""}`} data-testid="studio-save-state"><Icon name={saveError ? "warning" : "check"} size={13} />{saveError ? "저장 확인 필요" : autosave.pending ? "저장 중…" : "로컬 저장됨"}</span></div>
      <div className="top-actions"><VersionHistory script={script} projectId={activeProjectId} onRestore={next=>{changeProjectEpoch();setPreviewChoices({});edit(next);selectScene(next.start);setView("stage");setNotice("백업한 버전으로 복원했습니다. 직전 작업은 버전 기록에 보관했습니다.");}}/><button type="button" className="icon-button" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" data-testid="studio-undo" disabled={!history.past.length} onClick={() => undoRedo("undo")}><Icon name="undo" /></button><button type="button" className="icon-button" title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" disabled={!history.future.length} onClick={() => undoRedo("redo")}><Icon name="redo" /></button><span className="action-divider" /><button type="button" className="studio-button export-button" onClick={exportProject} data-testid="studio-export"><Icon name="download" /><span>JSON</span></button><ExportBundleButton script={script}/><NativeBuildButton script={script} onChange={next=>edit(next)}/><button type="button" className="studio-button primary" onClick={play} data-testid="studio-play"><Icon name="play" size={14} /><span>여기서 플레이</span></button></div>
    </header>
    {saveError && <div className="save-alert" role="alert">{saveError}<button onClick={retrySave}>{saveEnabled ? "다시 저장" : "현재 작품 저장"}</button></div>}
    {!saveEnabled && initial.error && <ProjectRecovery id={activeProjectId} onRestore={next=>{changeProjectEpoch();setPreviewChoices({});dispatch({type:"reset",script:next});selectScene(next.start);setSaveError(null);setSaveEnabled(true);setNotice("작품 보관함 원고로 복구했습니다.");}}/>}
    <div className="studio-work">
      <aside className={`studio-rail ${showScenes ? "is-open" : ""}`}>
        <div className="project-cover"><img src={backgroundSrc(script.scenes.find(scene => scene.id === script.start) ?? script.scenes[0]!)} alt="" /><div><span>YOUR VISUAL NOVEL</span><strong>{script.title}</strong><small>{script.scenes.length}개 장면 · 예상 {scriptDuration}</small></div></div>
        <button className="workspace-search" onClick={() => setCommandOpen(true)}><Icon name="search" size={14} />빠르게 찾기 <kbd>Ctrl K</kbd></button>
        <nav className="workspace-nav" aria-label="작업 공간">{views.map(item => <button key={item.id} type="button" data-testid={`workspace-${item.id}`} className={view === item.id ? "is-active" : ""} onClick={() => { setView(item.id); setShowScenes(false); }}><Icon name={item.icon} /><span>{item.name}</span>{item.id === "stage" && <small>{script.scenes.length}</small>}{item.id === "production" && <small>{scriptDuration}</small>}</button>)}</nav>
        <div className="rail-heading"><h2>SCENES <span data-testid="studio-scene-count" className={nearSceneCap ? "is-near-cap" : ""} title={`최대 ${LIMITS.scenes}개`}>{script.scenes.length}{nearSceneCap ? `/${LIMITS.scenes}` : ""}</span></h2><button className="icon-button" type="button" aria-label="현재 씬 뒤에 새 씬 추가" data-testid="studio-add-scene" onClick={addScene}><Icon name="plus" /></button></div>
        <label className="scene-search"><Icon name="search" size={13} /><input aria-label="씬 검색" placeholder="장면 찾기…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>⌕</kbd></label>
        <ul className="studio-scene-list" data-testid="studio-scene-list"><SceneRail scenes={railScenes} selectedId={scene.id} query={query} onSelect={openSceneFromRail} onMove={moveSceneTo} /></ul>
        {noSceneMatches && <p className="empty-search">일치하는 장면이 없습니다.</p>}
        <div className="rail-bottom"><ProjectLibrary script={script} activeId={activeProjectId} onSwitch={(id,next)=>{activateProject(id,next);setActiveProjectId(id);changeProjectEpoch();revisionRef.current+=1;setPreviewChoices({});dispatch({type:"reset",script:next});selectScene(next.start);setView("stage");setSaveEnabled(true);setNotice("작품을 열었습니다.");}}/><button className="studio-button" type="button" onClick={() => fileInput.current?.click()}><Icon name="upload" />작품 가져오기</button><a href="/" data-testid="studio-to-title">작품 플레이어 <Icon name="arrow" size={12} /></a></div>
        <input ref={fileInput} data-testid="studio-import" type="file" accept=".json,application/json" hidden onChange={event => void importProject(event.target.files?.[0])} />
      </aside>
      <main className="studio-center">
        <div className="workspace-toolbar"><button className="icon-button mobile-scenes" aria-label="씬 목록 열기" onClick={() => setShowScenes(!showScenes)}><Icon name="scenes" /></button><div className="workspace-breadcrumb"><span>{views.find(item => item.id === view)?.name}</span><Icon name="chevron" size={12} /><strong>{view === "stage" ? sceneTitle(scene) : script.title}</strong></div><div className="workspace-toolbar-actions">{view === "stage" && <>
          <div className="stage-authoring-tools"><SceneTools script={script} scene={scene} onChange={edit} onSelect={openScene} onInsertLines={lines => insertPastedLines(lines, false)}/>{script.scenes.some(row=>row.choices?.some(choice=>choice.set||choice.add)) && <details className="preview-routes"><summary>미리보기 선택 경로</summary>{script.scenes.filter(row=>row.choices?.some(choice=>choice.set||choice.add)).map((row,i)=><label key={row.id}>선택 {i+1}<select aria-label={`미리보기 선택 ${i+1}`} value={previewChoices[row.id] ?? -1} onChange={event=>setPreviewChoices({...previewChoices,[row.id]:Number(event.target.value)})}><option value={-1}>선택하지 않음</option>{row.choices!.map((choice,j)=><option key={j} value={j}>{choice.text}</option>)}</select></label>)}</details>}</div>
          {!lineAllowed(line,previewFlags)&&<p className="conditional-preview-note">이 대사는 현재 미리보기 선택 경로에서 생략됩니다. 원고와 조건은 계속 편집할 수 있습니다.</p>}<span className="workspace-format"><i /> LIVE PREVIEW</span><button className={`studio-button focus-button ${focusMode ? "is-active" : ""}`} aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}><Icon name="expand" size={13} />{focusMode ? "패널 열기" : "집중 모드"}</button></>}</div></div>
        {view === "overview" && <ProjectOverview onEdit={edit} script={script} onNavigate={setView} onSelectScene={openScene} onValidate={() => setShowIssues(true)} />}
        {view === "production" && <div className="production-view"><ManuscriptReview script={script} onSelectScene={openScene} /><details className="production-drawer" data-testid="production-drawer" onToggle={event => setProductionOpen(event.currentTarget.open)}><summary><Icon name="spark" size={15} />장편 AI 제작실<small>기획 · 챕터 설계 · 연속성 집필 · 원고 적용</small></summary>{productionOpen && <ProductionPanel script={script} onApply={(next, nextSceneId) => { if (edit(next) && nextSceneId) openScene(nextSceneId); }} onSelectScene={openScene} />}</details></div>}
        {view === "stage" && <>
          <section className="preview-workspace"><div className="preview-meta"><span><i /> SCENE {String(sceneNumber).padStart(2, "0")}</span><div><Icon name="image" size={12} />{scene.backgroundUrl ? "프로젝트 원화" : scene.background}<span className="meta-divider" />{scene.bgm && <><Icon name="music" size={12} />{script.audioAssets?.find(asset=>asset.url===scene.bgm)?.name??(scene.bgm.startsWith("/assets/user/")?"사용자 음원":scene.bgm)}</>}</div></div>
            <section className="stage-fit" ref={stageRef} aria-label="16:9 게임 미리보기"><div className="preview-frame" style={{ width: `${previewWidth}px` }}><section className="stage" data-testid="studio-stage"><Stage background={scene.background} backgroundUrl={backgroundAt(scene,index,previewFlags)} cgUrl={cgAt(script,scene,index,previewFlags)} hideSprites={scene.hideSprites} framing={framingAt(scene,index,previewFlags)} characters={script.characters} sprites={spritesAt(scene,index,previewFlags)} speaking={line.speaker} chapter={null} sceneEpoch={0} transition="none" />{!artOnly && <DialogueBox speaker={speakerName(script, line.speaker)} color={speakerColor(script, line.speaker)} text={line.text} typing={true} />}</section></div></section>
            <div className="preview-transport"><button type="button" className="text-button" data-testid="studio-art-view" aria-pressed={artOnly} onClick={()=>setArtOnly(!artOnly)}><Icon name="image" size={13}/>{artOnly ? "대사 표시" : "원화 감상"}</button><span className="preview-resolution">GAME VIEW <span>·</span> {Math.round(previewWidth)} × {Math.round(previewWidth * 9 / 16)}</span><div><button className="icon-button" aria-label="이전 대사" disabled={index === 0} onClick={() => setLineIndex(index - 1)}><Icon name="left" size={14} /></button><span><b>{String(index + 1).padStart(2, "0")}</b> / {String(scene.lines.length).padStart(2, "0")}</span><button className="icon-button" aria-label="다음 대사" disabled={index === scene.lines.length - 1} onClick={() => setLineIndex(index + 1)}><Icon name="chevron" size={14} /></button></div><button className="text-button" onClick={() => { setRightTab("inspector"); setFocusMode(false); }}><Icon name="settings" size={13} />연출 편집</button></div>
          </section>
          <section className="script-timeline"><div className="timeline-heading"><h2><Icon name="file" size={15} />대사 트랙 <span data-testid="studio-line-count" className={nearLineCap ? "is-near-cap" : ""} title={`씬당 최대 ${LIMITS.sceneLines.toLocaleString()}줄`}>{scene.lines.length}{nearLineCap ? `/${LIMITS.sceneLines}` : ""}</span></h2><div><button className="text-button ai-text" onClick={() => { setRightTab("ai"); setFocusMode(false); }}><Icon name="spark" size={14} />연출 노트</button><button className="icon-button" aria-label="선택한 대사 위로 이동" title="Alt+↑" disabled={index === 0} onClick={() => moveLineBy(-1)}>↑</button><button className="icon-button" aria-label="선택한 대사 아래로 이동" title="Alt+↓" disabled={index >= scene.lines.length - 1} onClick={() => moveLineBy(1)}>↓</button><button className="icon-button" aria-label="선택한 대사 복제" title="선택한 대사 복제" onClick={duplicateCurrentLine}><Icon name="scenes" size={14} /></button><button className="icon-button" aria-label="선택한 대사 뒤에 새 줄 추가" title="Ctrl+Enter" data-testid="studio-add-line" onClick={addLine}><Icon name="plus" /></button><button className="icon-button" aria-label="선택한 대사 삭제" disabled={scene.lines.length <= 1} onClick={deleteCurrentLine}><Icon name="trash" size={14} /></button></div></div>
          <ol className="studio-line-list" data-testid="studio-line-list">{scene.lines.map((row, i) => <LineRow key={i} line={row} index={i} selected={i === index} name={speakerName(script, row.speaker)} color={speakerColor(script, row.speaker)} actor={script.characters.find(actor => actor.id === row.speaker)} onSelect={selectLine} />)}</ol>
          <div className="scene-exits"><Icon name={scene.choices?.length ? "graph" : "arrow"} size={13} />{scene.choices?.length ? scene.choices.map((choice, i) => <button key={i} onClick={() => selectScene(choice.next)}>{choice.text}<Icon name="chevron" size={11} /></button>) : scene.ending ? <span>ENDING <b>{scene.ending}</b></span> : <button onClick={() => scene.next && selectScene(scene.next)}>다음 장면 <b>{script.scenes.find(row => row.id === scene.next)?.chapter ?? "미연결"}</b><Icon name="chevron" size={11} /></button>}</div></section>
        </>}
        {view === "graph" && <StoryMap script={script} selected={scene.id} onSelect={openScene} />}
        <div className="full-workspace art-workspace" hidden={view !== "assets"}><MemoAssetLibrary generationEnabled={true} active={view === "assets"} projectEpoch={projectEpoch} script={view === "assets" ? script : analysisScript} scene={view === "assets" ? scene : analysisScene} onChange={assetChange} onPatchScene={assetPatchScene} /></div>
        {view === "characters" && <CharacterManager script={script} onChange={edit}/>}
      </main>
      <aside className="studio-inspector"><div className="right-tabs" role="tablist" aria-label="작업 패널"><button type="button" role="tab" aria-selected={rightTab === "ai"} onClick={() => setRightTab("ai")}><Icon name="spark" />AI</button><button type="button" role="tab" aria-selected={rightTab === "inspector"} onClick={() => setRightTab("inspector")}><Icon name="settings" />속성</button></div><div className="right-panel-scroll"><div hidden={rightTab !== "ai"}><MemoAiPanel active={rightTab === "ai"} script={rightTab === "ai" ? script : analysisScript} scene={rightTab === "ai" ? scene : analysisScene} lineIndex={index} onApply={applyAiProposal} /><div className="scene-notes"><p className="eyebrow">SCENE DIRECTION</p><h2>{sceneTitle(scene)}</h2><img src={backgroundSrc(scene)} alt="장면 아트" /><p>{scene.artBrief || "이 장면의 감정과 시각적 방향을 속성 패널에 기록하세요."}</p><div><span>{scene.lines.length}줄</span><span>{scene.cgUrl ? "EVENT CG" : "BACKGROUND"}</span></div><button className="studio-button" onClick={() => setView("assets")}><Icon name="image" />아트 디렉션 열기</button><button className="studio-button" onClick={() => setView("production")}><Icon name="clock" />전체 원고 검수</button></div></div><div hidden={rightTab !== "inspector"}><Inspector script={script} scene={scene} lineIndex={index} patchScene={patchScene} patchLine={patchLine} onChange={edit} onAddLine={addLine} onInsertLines={insertPastedLines} onRenameScene={renameCurrentScene} textRef={lineTextRef} /></div></div></aside>
    </div>
    <footer className="studio-status"><span><i />{saveError ? "저장 상태 확인 필요" : autosave.pending ? "현재 원고 저장 중…" : "이 브라우저에 자동 저장"}</span><div><span>{script.scenes.length} scenes</span><span>{totalLines} lines</span><span>예상 {scriptDuration}</span><span>{script.scenes.filter(row => row.ending).length} endings</span></div><button type="button" className={errors.length ? "has-error" : ""} onClick={() => { if (showIssues) closeIssues(); else setShowIssues(true); }} data-testid="studio-validation"><Icon name={allIssues.length ? "warning" : "check"} size={12} />{errors.length ? `수정 필요 ${errors.length}` : allIssues.length ? `검토 ${allIssues.length}건` : "스토리 연결 정상"}</button></footer>
    {notice && <div className="studio-toast" role="status">{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}><Icon name="close" size={13} /></button></div>}
    {commandOpen && <CommandPalette script={script} onClose={() => setCommandOpen(false)} onSelect={(id, targetLine) => { openScene(id); setLineIndex(targetLine); setRightTab("inspector"); setFocusMode(false); }} onReplace={(next, count) => { if (edit(next)) setNotice(`${count}곳을 바꿨습니다. 실행 취소(Ctrl+Z)로 되돌릴 수 있습니다.`); }} />}
    {showIssues && <section className="validation-popover" aria-label="작품 검증 결과"><div className="panel-heading"><Icon name="check" /><h2>작품 검증</h2><button className="icon-button" aria-label="검증 결과 닫기" onClick={closeIssues}><Icon name="close" /></button></div>
      {previewGate === "blocked" && <p className="preview-gate is-blocked" role="alert">현재 장면 또는 바로 이어지는 장면에 수정할 문제가 있어 미리보기를 시작할 수 없습니다.</p>}
      {previewGate === "warning" && <div className="preview-gate"><p>현재 장면은 재생할 수 있습니다. 다른 장면의 문제 {errors.length}건은 그 장면에 도달하면 오류로 표시됩니다.</p><button type="button" className="studio-button primary" data-testid="studio-play-anyway" onClick={startPreview}><Icon name="play" size={13} />그래도 미리보기</button></div>}
      {allIssues.length ? allIssues.map((issue, i) => <button className={`issue-row ${issue.severity}`} key={i} onClick={() => { if (issue.sceneId) { selectScene(issue.sceneId); setView("stage"); setRightTab("inspector"); } else if (issue.view) setView(issue.view); closeIssues(); }}><Icon name="warning" size={14} /><span><strong>{issue.sceneId ? script.scenes.find(row => row.id === issue.sceneId)?.chapter ?? issue.sceneId : issue.view === "characters" ? "등장인물" : "아트 디렉션"}</strong>{issue.message}</span></button>) : <p>빈 대사, 끊긴 연결, 도달할 수 없는 씬, 찾을 수 없는 미디어가 없습니다.</p>}</section>}
  </div>;
}
