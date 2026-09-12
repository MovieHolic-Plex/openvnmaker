import {withNarrativeIds} from "./studio/narrativeIds.js";
import { CharacterManager } from "./studio/CharacterManager.js";
import { ProjectLibrary } from "./studio/ProjectLibrary.js";
import { ACTIVE_PROJECT_KEY, activateProject } from "./studio/projects.js";
import { useProjectAutosave } from "./studio/useProjectAutosave.js";
import { ProjectRecovery } from "./studio/ProjectRecovery.js";
import { ActorAvatar } from "./studio/ActorAvatar.js";
import { ArtImage } from "./components/ArtImage.js";
import { auditScript, lineAllowed, parseScript } from "@vnmaker/content";
import type { Line, Scene, StoryFlags, VnScript } from "@vnmaker/content";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DialogueBox } from "./components/DialogueBox.js";
import { Stage } from "./components/Stage.js";
import { backgroundAt, bgmAt, cgAt, framingAt, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { Icon, type IconName } from "./studio/Icon.js";
import { Inspector, expressionLabel } from "./studio/Inspector.js";
import { backgroundSrc, historyReducer, loadProject, newSceneId, POSITION_KEY, PROJECT_KEY, sceneTitle } from "./studio/project.js";
import { ProjectOverview, durationLabel } from "./studio/ProjectOverview.js";
import { ManuscriptReview } from "./studio/ManuscriptReview.js";
import { AssetLibrary } from "./studio/AssetLibrary.js";
import { CommandPalette } from "./studio/CommandPalette.js";
import { ExportBundleButton } from "./studio/ExportBundleButton.js";
import { NativeBuildButton } from "./studio/NativeBuildButton.js";
import { SceneTools } from "./studio/SceneTools.js";
import { VersionHistory } from "./studio/VersionHistory.js";
import { saveVersion } from "./studio/versions.js";
import { parseEditorPosition, previewFlagsFor, type PreviewChoices } from "./studio/editorPosition.js";

type View = "overview" | "stage" | "production" | "graph" | "assets" | "characters";
const views: { id: View; name: string; icon: IconName }[] = [{ id: "overview", name: "프로젝트 홈", icon: "home" }, { id: "stage", name: "장면 편집", icon: "scenes" }, { id: "production", name: "원고·분량", icon: "layers" }, { id: "graph", name: "스토리 맵", icon: "graph" }, { id: "assets", name: "아트 디렉션", icon: "image" }, { id: "characters", name: "등장인물", icon: "users" }];

function StoryMap({ script, selected, onSelect }: { script: VnScript; selected: string; onSelect: (id: string) => void }) {
  const [zoom, setZoom] = useState(0.85);
  const positions = useMemo(() => {
    const depth = new Map<string, number>([[script.start, 0]]);
    const queue = [script.start];
    for (let i = 0; i < queue.length; i++) {
      const scene = script.scenes.find(row => row.id === queue[i]);
      if (!scene) continue;
      const targets = scene.choices?.length ? scene.choices.map(choice => choice.next) : !scene.ending && scene.next ? [scene.next] : [];
      for (const target of targets) if (!depth.has(target)) { depth.set(target, depth.get(scene.id)! + 1); queue.push(target); }
    }
    const counts = new Map<number, number>();
    return new Map(script.scenes.map(scene => {
      const level = depth.get(scene.id) ?? 0;
      const column = counts.get(level) ?? 0;
      counts.set(level, column + 1);
      return [scene.id, { x: 36 + column * 245, y: 32 + level * 178 }];
    }));
  }, [script]);
  const width = Math.max(520, ...[...positions.values()].map(pos => pos.x + 245));
  const height = Math.max(400, ...[...positions.values()].map(pos => pos.y + 175));
  return <section className="graph-view"><div className="view-heading"><div><p className="eyebrow">EVERY CHOICE MATTERS</p><h2>이야기가 흐르는 길</h2><p>씬을 누르면 해당 장면으로 이동합니다.</p></div><div className="zoom-control"><button aria-label="스토리 맵 축소" onClick={() => setZoom(Math.max(0.45, zoom - 0.1))}>−</button><span>{Math.round(zoom * 100)}%</span><button aria-label="스토리 맵 확대" onClick={() => setZoom(Math.min(1.25, zoom + 0.1))}>+</button></div></div><div className="graph-scroll"><div style={{ width: width * zoom, height: height * zoom }}><div className="graph-canvas" style={{ width, height, transform: `scale(${zoom})` }}><svg className="graph-edges" width={width} height={height} aria-hidden="true"><defs><marker id="edge-arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6" fill="#9a83d8" /></marker></defs>{script.scenes.flatMap(scene => {
      const from = positions.get(scene.id)!;
      return (scene.choices?.length ? scene.choices.map(choice => choice.next) : !scene.ending && scene.next ? [scene.next] : []).map((id, index) => {
        const to = positions.get(id); if (!to) return null;
        return <path key={`${scene.id}-${id}-${index}`} d={`M${from.x + 105} ${from.y + 127} C${from.x + 105} ${from.y + 157}, ${to.x + 105} ${to.y - 30}, ${to.x + 105} ${to.y}`} fill="none" stroke={scene.choices?.length ? "#b497ed" : "#66557f"} strokeWidth="1.8" markerEnd="url(#edge-arrow)" />;
      });
    })}</svg>{script.scenes.map((scene, index) => { const pos = positions.get(scene.id)!; return <button key={scene.id} className={`graph-node ${selected === scene.id ? "is-selected" : ""}`} style={{ left: pos.x, top: pos.y }} onClick={() => onSelect(scene.id)} data-testid={`graph-node-${scene.id}`}><img src={backgroundSrc(scene)} alt="" /><div><span>{String(index + 1).padStart(2, "0")} / {scene.id === script.start ? "START" : scene.ending ? "ENDING" : scene.choices?.length ? "BRANCH" : "SCENE"}</span><strong>{sceneTitle(scene)}</strong><small>{scene.lines.length}줄 {scene.choices?.length ? `· 선택지 ${scene.choices.length}개` : ""}</small></div></button>; })}</div></div></div></section>;
}

export function StudioApp({recoveryInitial}:{recoveryInitial?:ReturnType<typeof loadProject>}={}) {
  const [initial] = useState(()=>recoveryInitial??loadProject());
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: initial.script, future: [] });
  const script = history.present;
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
  const [showScenes, setShowScenes] = useState(false);
  const [focusMode, setFocusMode] = useState(position.focusMode === true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [projectEpoch, setProjectEpoch] = useState(0);
  const projectEpochRef = useRef(0);
  const revisionRef = useRef(0);
  const importToken = useRef(0);
  function changeProjectEpoch() { projectEpochRef.current += 1; setProjectEpoch(projectEpochRef.current); }
  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const [previewWidth, setPreviewWidth] = useState(720);
  const scene = script.scenes.find(row => row.id === sceneId) ?? script.scenes[0]!;
  const index = Math.min(lineIndex, scene.lines.length - 1);
  const line = scene.lines[index]!;
  const sceneNumber = script.scenes.findIndex(row => row.id === scene.id) + 1;
  const issues = useMemo(() => auditScript(script), [script]);
  const errors = issues.filter(issue => issue.severity === "error");
  const totalLines = script.scenes.reduce((sum, row) => sum + row.lines.length, 0);
  const edit = useCallback((next: VnScript, group?: string) => { revisionRef.current += 1; dispatch({ type: "edit", script: withNarrativeIds(next), at: Date.now(), ...(group ? { group } : {}) }); }, []);
  const patchScene = useCallback((next: Scene, group?: string) => edit({ ...script, scenes: script.scenes.map(row => row.id === next.id ? next : row) }, group), [edit, script]);
  function patchLine(next: Line) { patchScene({ ...scene, lines: scene.lines.map((row, i) => i === index ? next : row) }, `line-${scene.id}-${index}`); }
  function selectScene(id: string) { setSceneId(id); setLineIndex(0); setShowScenes(false); }
  function openScene(id: string) { selectScene(id); setView("stage"); setCommandOpen(false); }
  function undoRedo(type: "undo" | "redo") { revisionRef.current += 1; changeProjectEpoch(); setPreviewChoices({}); dispatch({ type }); }
  const isWideView = view !== "stage";

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") { setShowIssues(false); setShowScenes(false); setCommandOpen(false); }
      if (!event.ctrlKey && !event.metaKey) return;
      if (event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(value => !value); return; }
      const target = event.target as HTMLElement;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); retrySave(); }
      if (target.matches("input,textarea,select,[contenteditable=true]")) return;
      if (event.key.toLowerCase() === "z") { event.preventDefault(); undoRedo(event.shiftKey ? "redo" : "undo"); }
      if (event.key.toLowerCase() === "y") { event.preventDefault(); undoRedo("redo"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [script]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  function addScene() {
    const id = newSceneId();
    const { id: _id, chapter: _chapter, lines: _lines, ...inherited } = scene;
    const next: Scene = { ...inherited, id, chapter: "새로운 장면", lines: [{ speaker: null, text: "이곳에서 새로운 이야기가 시작된다." }] };
    const { choices: _choices, ending: _ending, ...previous } = scene;
    edit({ ...script, scenes: script.scenes.flatMap(row => row.id === scene.id ? [{ ...previous, next: id }, next] : [row]) });
    selectScene(id); setView("stage"); setRightTab("inspector"); setNotice("현재 씬 뒤에 새 씬을 연결했습니다.");
  }
  function addLine() { patchScene({ ...scene, lines: [...scene.lines.slice(0, index + 1), { speaker: null, text: "" }, ...scene.lines.slice(index + 1)] }); setLineIndex(index + 1); setRightTab("inspector"); }
  function play() {
    if (errors.length) { setShowIssues(true); return; }
    try {
      sessionStorage.setItem("vnmaker.previewScript", JSON.stringify(script));
      sessionStorage.setItem("vnmaker.previewPosition", JSON.stringify({ sceneId: scene.id, lineIndex: index, flags: previewFlags }));
      window.location.href = "/?preview=1";
    } catch { setSaveError("미리보기 데이터를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요."); }
  }
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
  return <div className={`studio studio-modern ${isWideView ? "studio-wide" : ""} ${focusMode && !isWideView ? "studio-focus" : ""}`}>
    <header className="studio-top">
      <button className="studio-brand" onClick={() => setView("overview")} aria-label="VN Maker 스튜디오 홈"><span className="brand-mark"><Icon name="layers" size={23} /></span><strong>VN<span>MAKER</span></strong><small>STUDIO</small></button>
      <div className="project-heading"><Icon name="file" size={15} /><input aria-label="작품 제목" value={script.title} onChange={event => { if (event.target.value.trim()) edit({ ...script, title: event.target.value }, "title"); }} /><span className={`save-state ${saveError ? "has-error" : ""}`} data-testid="studio-save-state"><Icon name={saveError ? "warning" : "check"} size={13} />{saveError ? "저장 확인 필요" : autosave.pending ? "저장 중…" : "로컬 저장됨"}</span></div>
      <div className="top-actions"><VersionHistory script={script} projectId={activeProjectId} onRestore={next=>{changeProjectEpoch();setPreviewChoices({});edit(next);selectScene(next.start);setView("stage");setNotice("백업한 버전으로 복원했습니다. 직전 작업은 버전 기록에 보관했습니다.");}}/><button type="button" className="icon-button" title="실행 취소 (Ctrl+Z)" aria-label="실행 취소" data-testid="studio-undo" disabled={!history.past.length} onClick={() => undoRedo("undo")}><Icon name="undo" /></button><button type="button" className="icon-button" title="다시 실행 (Ctrl+Shift+Z)" aria-label="다시 실행" disabled={!history.future.length} onClick={() => undoRedo("redo")}><Icon name="redo" /></button><span className="action-divider" /><button type="button" className="studio-button export-button" onClick={exportProject} data-testid="studio-export"><Icon name="download" /><span>JSON</span></button><ExportBundleButton script={script}/><NativeBuildButton script={script} onChange={next=>edit(next)}/><button type="button" className="studio-button primary" onClick={play} data-testid="studio-play"><Icon name="play" size={14} /><span>여기서 플레이</span></button></div>
    </header>
    {saveError && <div className="save-alert" role="alert">{saveError}<button onClick={retrySave}>{saveEnabled ? "다시 저장" : "현재 작품 저장"}</button></div>}
    {!saveEnabled && initial.error && <ProjectRecovery id={activeProjectId} onRestore={next=>{changeProjectEpoch();setPreviewChoices({});dispatch({type:"reset",script:next});selectScene(next.start);setSaveError(null);setSaveEnabled(true);setNotice("작품 보관함 원고로 복구했습니다.");}}/>}
    <div className="studio-work">
      <aside className={`studio-rail ${showScenes ? "is-open" : ""}`}>
        <div className="project-cover"><img src={backgroundSrc(script.scenes.find(scene => scene.id === script.start) ?? script.scenes[0]!)} alt="" /><div><span>YOUR VISUAL NOVEL</span><strong>{script.title}</strong><small>{script.scenes.length}개 장면 · 예상 {durationLabel(script)}</small></div></div>
        <button className="workspace-search" onClick={() => setCommandOpen(true)}><Icon name="search" size={14} />빠르게 찾기 <kbd>Ctrl K</kbd></button>
        <nav className="workspace-nav" aria-label="작업 공간">{views.map(item => <button key={item.id} type="button" data-testid={`workspace-${item.id}`} className={view === item.id ? "is-active" : ""} onClick={() => { setView(item.id); setShowScenes(false); }}><Icon name={item.icon} /><span>{item.name}</span>{item.id === "stage" && <small>{script.scenes.length}</small>}{item.id === "production" && <small>{durationLabel(script)}</small>}</button>)}</nav>
        <div className="rail-heading"><h2>SCENES <span>{script.scenes.length}</span></h2><button className="icon-button" type="button" aria-label="현재 씬 뒤에 새 씬 추가" data-testid="studio-add-scene" onClick={addScene}><Icon name="plus" /></button></div>
        <label className="scene-search"><Icon name="search" size={13} /><input aria-label="씬 검색" placeholder="장면 찾기…" value={query} onChange={event => setQuery(event.target.value)} /><kbd>⌕</kbd></label>
        <ul className="studio-scene-list" data-testid="studio-scene-list">{script.scenes.filter(row => `${row.id} ${row.chapter ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(row => <li key={row.id}><button type="button" className={row.id === scene.id ? "is-selected" : ""} data-testid={`studio-scene-${row.id}`} onClick={() => { selectScene(row.id); setView("stage"); }}><span className="scene-thumb"><img src={backgroundSrc(row)} alt="" /><small>{String(script.scenes.indexOf(row) + 1).padStart(2, "0")}</small></span><span className="scene-copy"><strong>{sceneTitle(row).replace(/^\d+장\s*[A-Z]?\s*·\s*/, "")}</strong><small>{row.lines.length}줄 <span>·</span> {row.choices?.length ? `분기 ${row.choices.length}` : row.ending ? "엔딩" : "장면"}</small></span>{row.choices?.length ? <Icon name="graph" size={13} /> : row.ending ? <span className="ending-dot" /> : null}</button></li>)}</ul>
        {query && !script.scenes.some(row => `${row.id} ${row.chapter ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) && <p className="empty-search">일치하는 장면이 없습니다.</p>}
        <div className="rail-bottom"><ProjectLibrary script={script} activeId={activeProjectId} onSwitch={(id,next)=>{activateProject(id,next);setActiveProjectId(id);changeProjectEpoch();revisionRef.current+=1;setPreviewChoices({});dispatch({type:"reset",script:next});selectScene(next.start);setView("stage");setSaveEnabled(true);setNotice("작품을 열었습니다.");}}/><button className="studio-button" type="button" onClick={() => fileInput.current?.click()}><Icon name="upload" />작품 가져오기</button><a href="/" data-testid="studio-to-title">작품 플레이어 <Icon name="arrow" size={12} /></a></div>
        <input ref={fileInput} data-testid="studio-import" type="file" accept=".json,application/json" hidden onChange={event => void importProject(event.target.files?.[0])} />
      </aside>
      <main className="studio-center">
        <div className="workspace-toolbar"><button className="icon-button mobile-scenes" aria-label="씬 목록 열기" onClick={() => setShowScenes(!showScenes)}><Icon name="scenes" /></button><div className="workspace-breadcrumb"><span>{views.find(item => item.id === view)?.name}</span><Icon name="chevron" size={12} /><strong>{view === "stage" ? sceneTitle(scene) : script.title}</strong></div><div className="workspace-toolbar-actions">{view === "stage" && <>
          <div className="stage-authoring-tools"><SceneTools script={script} scene={scene} onChange={edit} onSelect={openScene}/>{script.scenes.some(row=>row.choices?.some(choice=>choice.set||choice.add)) && <details className="preview-routes"><summary>미리보기 선택 경로</summary>{script.scenes.filter(row=>row.choices?.some(choice=>choice.set||choice.add)).map((row,i)=><label key={row.id}>선택 {i+1}<select aria-label={`미리보기 선택 ${i+1}`} value={previewChoices[row.id] ?? -1} onChange={event=>setPreviewChoices({...previewChoices,[row.id]:Number(event.target.value)})}><option value={-1}>선택하지 않음</option>{row.choices!.map((choice,j)=><option key={j} value={j}>{choice.text}</option>)}</select></label>)}</details>}</div>
          {!lineAllowed(line,previewFlags)&&<p className="conditional-preview-note">이 대사는 현재 미리보기 선택 경로에서 생략됩니다. 원고와 조건은 계속 편집할 수 있습니다.</p>}<span className="workspace-format"><i /> LIVE PREVIEW</span><button className={`studio-button focus-button ${focusMode ? "is-active" : ""}`} aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}><Icon name="expand" size={13} />{focusMode ? "패널 열기" : "집중 모드"}</button></>}</div></div>
        {view === "overview" && <ProjectOverview onEdit={edit} script={script} onNavigate={setView} onSelectScene={openScene} onValidate={() => setShowIssues(true)} />}
        {view === "production" && <ManuscriptReview script={script} onSelectScene={openScene} />}
        {view === "stage" && <>
          <section className="preview-workspace"><div className="preview-meta"><span><i /> SCENE {String(sceneNumber).padStart(2, "0")}</span><div><Icon name="image" size={12} />{scene.backgroundUrl ? "프로젝트 원화" : scene.background}<span className="meta-divider" />{scene.bgm && <><Icon name="music" size={12} />{script.audioAssets?.find(asset=>asset.url===scene.bgm)?.name??(scene.bgm.startsWith("/assets/user/")?"사용자 음원":scene.bgm)}</>}</div></div>
            <section className="stage-fit" ref={stageRef} aria-label="16:9 게임 미리보기"><div className="preview-frame" style={{ width: `${previewWidth}px` }}><section className="stage" data-testid="studio-stage"><Stage background={scene.background} backgroundUrl={backgroundAt(scene,index,previewFlags)} cgUrl={cgAt(scene,index,previewFlags)} hideSprites={scene.hideSprites} framing={framingAt(scene,index,previewFlags)} characters={script.characters} sprites={spritesAt(scene,index,previewFlags)} speaking={line.speaker} chapter={null} sceneEpoch={0} transition="none" />{!artOnly && <DialogueBox speaker={speakerName(script, line.speaker)} color={speakerColor(script, line.speaker)} text={line.text} typing={true} />}</section></div></section>
            <div className="preview-transport"><button type="button" className="text-button" data-testid="studio-art-view" aria-pressed={artOnly} onClick={()=>setArtOnly(!artOnly)}><Icon name="image" size={13}/>{artOnly ? "대사 표시" : "원화 감상"}</button><span className="preview-resolution">GAME VIEW <span>·</span> {Math.round(previewWidth)} × {Math.round(previewWidth * 9 / 16)}</span><div><button className="icon-button" aria-label="이전 대사" disabled={index === 0} onClick={() => setLineIndex(index - 1)}><Icon name="left" size={14} /></button><span><b>{String(index + 1).padStart(2, "0")}</b> / {String(scene.lines.length).padStart(2, "0")}</span><button className="icon-button" aria-label="다음 대사" disabled={index === scene.lines.length - 1} onClick={() => setLineIndex(index + 1)}><Icon name="chevron" size={14} /></button></div><button className="text-button" onClick={() => { setRightTab("inspector"); setFocusMode(false); }}><Icon name="settings" size={13} />연출 편집</button></div>
          </section>
          <section className="script-timeline"><div className="timeline-heading"><h2><Icon name="file" size={15} />대사 트랙 <span>{scene.lines.length}</span></h2><div><button className="text-button ai-text" onClick={() => { setRightTab("ai"); setFocusMode(false); }}><Icon name="spark" size={14} />연출 노트</button><button className="icon-button" aria-label="선택한 대사 뒤에 새 줄 추가" data-testid="studio-add-line" onClick={addLine}><Icon name="plus" /></button><button className="icon-button" aria-label="선택한 대사 삭제" disabled={scene.lines.length <= 1} onClick={() => { patchScene({ ...scene, lines: scene.lines.filter((_, i) => i !== index) }); setLineIndex(Math.max(0, index - 1)); }}><Icon name="trash" size={14} /></button></div></div>
          <ol className="studio-line-list" data-testid="studio-line-list">{scene.lines.map((row, i) => <li key={i}><button type="button" className={i === index ? "is-selected" : ""} data-testid={`studio-line-${i}`} onClick={() => { setLineIndex(i); setRightTab("inspector"); }}><span className="line-number">{String(i + 1).padStart(2, "0")}</span><span className="line-speaker" style={{ color: speakerColor(script, row.speaker) }}><ActorAvatar script={script} id={row.speaker}/>{speakerName(script,row.speaker) ?? "내레이션"}</span><span className="line-copy">{row.text || "대사를 입력하세요…"}</span><span className="line-expression">{row.cgUrl !== undefined ? row.cgUrl ? "CG" : "BG" : row.expression ? expressionLabel(row.expression) : ""}</span>{i === index && <span className="line-selected-mark" />}</button></li>)}</ol>
          <div className="scene-exits"><Icon name={scene.choices?.length ? "graph" : "arrow"} size={13} />{scene.choices?.length ? scene.choices.map((choice, i) => <button key={i} onClick={() => selectScene(choice.next)}>{choice.text}<Icon name="chevron" size={11} /></button>) : scene.ending ? <span>ENDING <b>{scene.ending}</b></span> : <button onClick={() => scene.next && selectScene(scene.next)}>다음 장면 <b>{script.scenes.find(row => row.id === scene.next)?.chapter ?? "미연결"}</b><Icon name="chevron" size={11} /></button>}</div></section>
        </>}
        {view === "graph" && <StoryMap script={script} selected={scene.id} onSelect={id => { selectScene(id); setView("stage"); }} />}
        <div className="full-workspace art-workspace" hidden={view !== "assets"}><AssetLibrary generationEnabled={false} projectEpoch={projectEpoch} script={script} scene={scene} onChange={next => { if (projectEpoch === projectEpochRef.current) edit(next); }} onPatchScene={patch => patchScene({ ...scene, ...patch })} /></div>
        {view === "characters" && <CharacterManager script={script} onChange={edit}/>}
      </main>
      <aside className="studio-inspector"><div className="right-tabs" role="tablist" aria-label="작업 패널"><button type="button" role="tab" aria-selected={rightTab === "ai"} onClick={() => setRightTab("ai")}><Icon name="file" />연출 노트</button><button type="button" role="tab" aria-selected={rightTab === "inspector"} onClick={() => setRightTab("inspector")}><Icon name="settings" />속성</button></div><div className="right-panel-scroll"><div hidden={rightTab !== "ai"} className="scene-notes"><p className="eyebrow">SCENE DIRECTION</p><h2>{sceneTitle(scene)}</h2><img src={backgroundSrc(scene)} alt="장면 아트" /><p>{scene.artBrief || "이 장면의 감정과 시각적 방향을 속성 패널에 기록하세요."}</p><div><span>{scene.lines.length}줄</span><span>{scene.cgUrl ? "EVENT CG" : "BACKGROUND"}</span></div><button className="studio-button" onClick={() => setView("assets")}><Icon name="image" />아트 디렉션 열기</button><button className="studio-button" onClick={() => setView("production")}><Icon name="clock" />전체 원고 검수</button></div><div hidden={rightTab !== "inspector"}><Inspector script={script} scene={scene} lineIndex={index} patchScene={patchScene} patchLine={patchLine} onChange={edit} /></div></div></aside>
    </div>
    <footer className="studio-status"><span><i />{saveError ? "저장 상태 확인 필요" : autosave.pending ? "현재 원고 저장 중…" : "이 브라우저에 자동 저장"}</span><div><span>{script.scenes.length} scenes</span><span>{totalLines} lines</span><span>예상 {durationLabel(script)}</span><span>{script.scenes.filter(row => row.ending).length} endings</span></div><button type="button" className={errors.length ? "has-error" : ""} onClick={() => setShowIssues(!showIssues)} data-testid="studio-validation"><Icon name={issues.length ? "warning" : "check"} size={12} />{errors.length ? `수정 필요 ${errors.length}` : issues.length ? `검토 ${issues.length}건` : "스토리 연결 정상"}</button></footer>
    {notice && <div className="studio-toast" role="status">{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}><Icon name="close" size={13} /></button></div>}
    {commandOpen && <CommandPalette script={script} onClose={() => setCommandOpen(false)} onSelect={(id, targetLine) => { openScene(id); setLineIndex(targetLine); setRightTab("inspector"); setFocusMode(false); }} />}
    {showIssues && <section className="validation-popover" aria-label="작품 검증 결과"><div className="panel-heading"><Icon name="check" /><h2>작품 검증</h2><button className="icon-button" aria-label="검증 결과 닫기" onClick={() => setShowIssues(false)}><Icon name="close" /></button></div>{issues.length ? issues.map((issue, i) => <button className={`issue-row ${issue.severity}`} key={i} onClick={() => { selectScene(issue.sceneId); setView("stage"); setRightTab("inspector"); setShowIssues(false); }}><Icon name="warning" size={14} /><span><strong>{script.scenes.find(row => row.id === issue.sceneId)?.chapter}</strong>{issue.message}</span></button>) : <p>빈 대사, 끊긴 연결, 도달할 수 없는 씬이 없습니다.</p>}</section>}
  </div>;
}
