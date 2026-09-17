import { useEffect, useRef, useState } from "react";
import type { VnScript } from "@vnmaker/content";
import { fetchAuthStatus, generateLine, type AuthStatus } from "../api/gateway";
import { fetchHostCapabilities } from "../api/host.js";
import { Icon } from "./Icon";
import { assembleProduction, createPlan, DEFAULT_READING_SPEED, durationLabel, estimateScriptDuration, makeDraftPrompt, makeOutlinePrompt, parseDraft, parseOutline, planDraftScript, PRODUCTION_BACKUP_KEY, PRODUCTION_KEY, restoreProduction, sceneCharacters, scriptFingerprint, type DraftJob, type ProductionPlan } from "./production";
import "./production.css";

interface Props {
  script: VnScript;
  onApply: (next: VnScript, sceneId?: string) => void;
  onSelectScene: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}
function initialCheckpoint(): { plan: ProductionPlan | null; error: string; blocked: boolean } {
  try {
    const saved = localStorage.getItem(PRODUCTION_KEY);
    return { plan: saved ? restoreProduction(JSON.parse(saved)) : null, error: "", blocked: false };
  } catch { return { plan: null, error: "저장된 장편 계획을 읽지 못했습니다. 기존 체크포인트는 보존했습니다. 파일을 백업한 뒤 새 계획을 시작할 수 있습니다.", blocked: true }; }
}
function saveDownload(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const statuses: Record<DraftJob["status"], string> = { pending: "집필 대기", running: "집필 중", ready: "분량 충족", short: "분량 보강", error: "재시도 필요" };

export function ProductionPanel({ script, onApply, onSelectScene, onBusyChange }: Props) {
  const [initial] = useState(initialCheckpoint);
  const [plan, setPlan] = useState(initial.plan);
  const planRef = useRef(plan);
  const [blocked, setBlocked] = useState(initial.blocked);
  const [error, setError] = useState(initial.error);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(true);
  const [brief, setBrief] = useState(initial.plan?.brief ?? `${script.title}의 인물로 만드는 감성 미스터리. 졸업을 앞둔 마지막 밤, 사라진 그림과 오래 숨겨 온 진실을 따라 관계가 달라진다. 섬세한 대화, 선명한 시각적 모티프, 복선 회수와 서로 다른 두 결말.`);
  const [target, setTarget] = useState(initial.plan?.targetMinutes ?? 90);
  const [readingSpeed, setReadingSpeed] = useState(initial.plan?.charsPerMinute ?? DEFAULT_READING_SPEED);
  const [selectedId, setSelectedId] = useState(initial.plan?.outline.start ?? "");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [formOpen, setFormOpen] = useState(!initial.plan);
  const [editingBeat, setEditingBeat] = useState(false);
  const [beatTitle, setBeatTitle] = useState("");
  const [beatSummary, setBeatSummary] = useState("");
  const [beatArt, setBeatArt] = useState("");
  const [bibleText, setBibleText] = useState(initial.plan?.outline.bible ?? "");
  const controllerRef = useRef<AbortController | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [noGateway, setNoGateway] = useState(false);
  useEffect(() => { let alive = true; void fetchHostCapabilities().then(host => { if (!alive) return; if (host && !host.gateway) { setNoGateway(true); return; } void fetchAuthStatus().then(value => { if (alive) setAuth(value); }); }); return () => { alive = false; }; }, []);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => () => { controllerRef.current?.abort(); }, []);
  useEffect(() => { setEditingBeat(false); }, [selectedId]);

  function commit(next: ProductionPlan): boolean {
    planRef.current = next; setPlan(next);
    try { localStorage.setItem(PRODUCTION_KEY, JSON.stringify(next)); setSaved(true); return true; }
    catch { setSaved(false); setNotice(""); setError("장편 체크포인트를 저장하지 못해 집필을 중단했습니다. 아래 ‘계획 백업’으로 현재 원고를 내보내 주세요."); return false; }
  }
  function begin(label: string) {
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(true); setActivity(label); setError(""); setNotice("");
    return controller;
  }
  function end(controller: AbortController) {
    if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); setActivity(""); }
  }
  async function outline() {
    if (busy || controllerRef.current || blocked || !saved || !brief.trim()) return;
    const controller = begin("전체 챕터와 분기를 설계하고 있습니다");
    const base = structuredClone(script);
    try {
      const result = await generateLine(makeOutlinePrompt(brief, target, base), controller.signal);
      if (controller.signal.aborted) return;
      const parsed = parseOutline(result.text, target);
      const next = createPlan(parsed, base, brief.trim(), target, readingSpeed);
      if (planRef.current) localStorage.setItem(`${PRODUCTION_KEY}.previous`, JSON.stringify(planRef.current));
      if (commit(next)) { setSelectedId(next.outline.start); setBibleText(next.outline.bible); setFormOpen(false); setNotice("설계를 검증해 저장했습니다. 씬 집필을 시작하면 한 씬씩 원고와 연속성을 기록합니다."); }
    } catch (cause) { setError(controller.signal.aborted ? "설계 요청을 중단했습니다. 기존 계획은 유지했습니다." : cause instanceof Error ? cause.message : String(cause)); }
    finally { end(controller); }
  }
  async function draft(ids: string[], extend = false) {
    if (busy || controllerRef.current || !saved || !planRef.current) return;
    const controller = begin("집필을 준비하고 있습니다");
    let failed = false;
    try {
      for (const id of ids) {
        if (controller.signal.aborted) break;
        const current: ProductionPlan = planRef.current!;
        const beat = current.outline.scenes.find(scene => scene.id === id)!;
        const previous = current.jobs[id] ?? { status: "pending" as const };
        setActivity(`${beat.chapter} · ${beat.title}`); setSelectedId(id);
        if (!commit({ ...current, jobs: { ...current.jobs, [id]: { ...previous, status: "running" } } })) { failed = true; break; }
        try {
          const result = await generateLine(makeDraftPrompt(current, beat, extend), controller.signal);
          if (planRef.current?.id !== current.id) { failed = true; setError("계획이 변경되어 이전 요청의 응답을 적용하지 않았습니다."); break; }
          if (controller.signal.aborted) { commit({ ...planRef.current!, jobs: { ...planRef.current!.jobs, [id]: previous } }); break; }
          const nextJob = parseDraft(result.text, current, beat, result.model, extend);
          if (!commit({ ...planRef.current!, jobs: { ...planRef.current!.jobs, [id]: nextJob } })) { failed = true; break; }
        } catch (cause) {
          const message = controller.signal.aborted ? "요청을 중단했습니다. 마지막 저장 지점부터 재개할 수 있습니다." : cause instanceof Error ? cause.message : String(cause);
          commit({ ...planRef.current!, jobs: { ...planRef.current!.jobs, [id]: controller.signal.aborted ? previous : { ...previous, status: "error", error: message } } });
          failed = true; setError(message); break;
        }
      }
      if (!controller.signal.aborted && !failed) setNotice("집필 결과를 체크포인트에 저장했습니다. 짧은 씬은 ‘분량 보강’으로 이어 쓸 수 있습니다.");
    } finally { end(controller); }
  }
  function runQueue() {
    if (!plan) return;
    // Plan JSON ordering is not necessarily causal: visit parents before each scene.
    const visited = new Set<string>(); const ordered: string[] = [];
    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const parent of plan.outline.scenes) if (parent.next === id || parent.choices?.some(choice => choice.next === id)) visit(parent.id);
      ordered.push(id);
    };
    for (const scene of plan.outline.scenes) visit(scene.id);
    void draft(ordered.filter(id => !plan.jobs[id]?.draft));
  }
  function apply() {
    if (!plan || busy) return;
    if (scriptFingerprint(script) !== plan.baseFingerprint) { setError("계획을 만든 이후 현재 작품이 변경되었습니다. 아래에서 현재 작품을 기준으로 다시 연결한 뒤 적용하세요."); return; }
    try {
      const manuscript = assembleProduction(plan);
      localStorage.setItem(PRODUCTION_BACKUP_KEY, JSON.stringify(script));
      onApply(manuscript, manuscript.start);
      commit({ ...plan, baseFingerprint: scriptFingerprint(manuscript), baseTitle: manuscript.title });
      setNotice(`원고를 작품에 적용했습니다. 이전 작품은 별도 백업으로 보관했습니다. 예상 1회차 ${durationLabel(estimateScriptDuration(manuscript, plan.charsPerMinute))}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function importCheckpoint(file: File | undefined) {
    if (!file || busy || controllerRef.current) return;
    const controller = begin("계획 체크포인트를 읽고 있습니다");
    try {
      if (file.size > 5_000_000) throw new Error("체크포인트는 5MB 이하여야 합니다.");
      const fileText = await file.text();
      if (controller.signal.aborted) return;
      const next = restoreProduction(JSON.parse(fileText));
      if (planRef.current) localStorage.setItem(`${PRODUCTION_KEY}.previous`, JSON.stringify(planRef.current));
      if (commit(next)) { setBlocked(false); setSelectedId(next.outline.start); setBrief(next.brief); setBibleText(next.outline.bible); setTarget(next.targetMinutes); setReadingSpeed(next.charsPerMinute); setFormOpen(false); setError(""); setNotice("장편 계획과 집필 체크포인트를 복원했습니다. 요청은 자동으로 재시작하지 않습니다."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { end(controller); }
  }

  const actual = estimateScriptDuration(script, plan?.charsPerMinute ?? readingSpeed);
  const staged = plan ? estimateScriptDuration(planDraftScript(plan), plan.charsPerMinute) : null;
  const selected = plan?.outline.scenes.find(scene => scene.id === selectedId) ?? plan?.outline.scenes[0];
  const job = selected ? plan?.jobs[selected.id] : undefined;
  const completed = plan ? Object.values(plan.jobs).filter(value => value.draft).length : 0;
  const fulfilled = plan ? Object.values(plan.jobs).filter(value => value.status === "ready").length : 0;
  const changedBase = plan && scriptFingerprint(script) !== plan.baseFingerprint;
  const totalScenes = plan?.outline.scenes.length ?? 0;
  const chapters = [...new Set(plan?.outline.scenes.map(scene => scene.chapter) ?? [])];
  const authenticated = auth?.authenticated === true;
  const controlsDisabled = busy || !authenticated || !saved;
  const downstream = new Set<string>();
  const inspectDownstream = (id: string) => {
    if (downstream.has(id)) return;
    downstream.add(id);
    const beat = plan?.outline.scenes.find(scene => scene.id === id);
    for (const next of beat?.choices?.map(choice => choice.next) ?? (beat?.next ? [beat.next] : [])) inspectDownstream(next);
  };
  if (selected) inspectDownstream(selected.id);
  const canEditBeat = !busy && ![...downstream].some(id => plan?.jobs[id]?.draft);
  function saveBeat() {
    if (!plan || !selected || !canEditBeat) return;
    try {
      const outline = parseOutline({ ...plan.outline, scenes: plan.outline.scenes.map(beat => beat.id === selected.id ? { ...beat, title: beatTitle, summary: beatSummary, artDirection: beatArt } : beat) }, plan.targetMinutes);
      if (commit({ ...plan, outline })) { setEditingBeat(false); setError(""); setNotice("씬의 사건과 아트 디렉션을 저장했습니다. 다음 집필에 이 설계를 사용합니다."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  function saveBible() {
    if (!plan || busy || completed) return;
    try { const outline = parseOutline({ ...plan.outline, bible: bibleText }, plan.targetMinutes); if (commit({ ...plan, outline })) { setError(""); setNotice("작품 설정집을 저장했습니다."); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  return <section className={`production-panel${plan ? " has-plan" : ""}`} data-testid="production-panel" aria-label="장편 제작실">
    <header className="production-heading"><div><span className="production-eyebrow">LONGFORM WORKSPACE</span><h1>한 장면의 영감에서,<br /><em>{plan?.targetMinutes ?? target}분의 이야기로.</em></h1><p>기획 · 챕터 설계 · 연속성 집필 · 분기 검증</p></div><div className="production-heading-art" aria-hidden="true"><img src="/assets/bg/rooftop-night.png" alt="" /><span>EVERY SCENE<br />HAS A PURPOSE.</span></div></header>
    <div className="production-metrics">
      <article><span>목표 플레이 시간</span><strong>{plan?.targetMinutes ?? target}<small>분 / 1회차</small></strong><p>선택한 한 경로로 엔딩까지</p></article>
      <article><span>현재 작품 실제 원고</span><strong data-testid="production-current-duration">{durationLabel(actual)}</strong><p>{actual.totalCharacters.toLocaleString()}자 · {script.scenes.length}개 씬{actual.hasCycle ? " · 반복 경로 있음" : ""}</p></article>
      <article><span>장편 초안의 집필 분량</span><strong data-testid="production-draft-duration">{staged ? durationLabel(staged) : "0분"}</strong><p>{completed} / {totalScenes || "—"} 씬 집필 · {fulfilled} 씬 분량 충족</p></article>
    </div>
    <p className="production-method">공백 제외 {plan?.charsPerMinute ?? readingSpeed}자/분으로 추정합니다. 분기별 최단–최장 경로를 계산하며, 빈 설계와 읽기 대기·음성 재생 시간은 포함하지 않습니다.</p>
    {error && <div role="alert" className="production-alert error"><Icon name="warning" /><span>{error}</span></div>}
    {notice && <div role="status" className="production-alert"><Icon name="check" /><span>{notice}</span></div>}
    {!saved && plan && <button type="button" disabled={busy} onClick={() => { if (commit(plan)) { setError(""); setNotice("체크포인트 저장을 완료했습니다. 집필을 재개할 수 있습니다."); } }}>로컬 저장 다시 시도</button>}
    {blocked && <button type="button" onClick={() => { const saved = localStorage.getItem(PRODUCTION_KEY); if (saved) saveDownload(saved, "production-recovery.json"); setBlocked(false); }}>손상된 체크포인트 백업 후 새 계획 시작</button>}
    <div className="production-section-bar"><div><h2>{plan ? plan.outline.title : "작품의 방향부터 정하세요"}</h2><span>{plan ? `${chapters.length}개 챕터 · ${totalScenes}개 씬 · ${plan.baseTitle}에서 시작한 계획` : "구체적인 사건과 인물의 욕망이 긴 이야기를 만듭니다."}</span></div><div className="production-actions">
      {plan && <button type="button" disabled={busy} onClick={() => setFormOpen(!formOpen)}><Icon name="settings" />새 기획</button>}
      <button type="button" disabled={busy} onClick={() => importRef.current?.click()}><Icon name="upload" />계획 가져오기</button>
      {plan && <button type="button" onClick={() => saveDownload(JSON.stringify(plan, null, 2), `${plan.outline.title}.production.json`)}><Icon name="download" />계획 백업</button>}
      <input type="file" accept="application/json,.json" hidden ref={importRef} data-testid="production-import" onChange={event => { void importCheckpoint(event.target.files?.[0]); event.target.value = ""; }} />
    </div></div>
    {formOpen && <form className="production-brief" onSubmit={event => { event.preventDefault(); void outline(); }}>
      <label className="production-brief-text">작품 기획<textarea value={brief} maxLength={2200} disabled={busy} onChange={event => setBrief(event.target.value)} rows={4} placeholder="장르, 주제, 주인공의 목표, 관계 변화, 원하는 결말을 적어 주세요." data-testid="production-brief" /></label>
      <div className="production-brief-controls"><label>목표 분량<select aria-label="목표 플레이 시간" value={target} disabled={busy} onChange={event => setTarget(Number(event.target.value))}><option value={30}>30분 · 중편</option><option value={60}>60분 · 장편</option><option value={90}>90분 · 장편</option><option value={120}>120분 · 장편</option><option value={180}>180분 · 장편</option></select></label><label>읽기 속도<select aria-label="읽기 속도" value={readingSpeed} disabled={busy} onChange={event => setReadingSpeed(Number(event.target.value))}><option value={240}>천천히 · 240자/분</option><option value={320}>보통 · 320자/분</option><option value={400}>빠르게 · 400자/분</option></select></label><button type="submit" className="production-primary" disabled={controlsDisabled || blocked || !brief.trim()} data-testid="production-outline"><Icon name="spark" />{busy ? "작업 중…" : plan ? "새 장편 설계 생성" : "장편 설계 생성"}</button></div>
      <p>AI가 전체 흐름을 먼저 설계합니다. 현재 작품은 ‘원고 적용’을 누를 때까지 유지되며, 새 계획 생성 시 이전 계획을 자동 백업합니다.</p>
    </form>}
    {!authenticated && <div className="production-alert"><Icon name="spark" /><span>{noGateway ? "이 배포에는 AI 서버가 없어 제작실을 쓸 수 없습니다." : auth ? "AI 연결이 필요합니다. AI 어시스턴트에서 로그인한 뒤 연결을 다시 확인하세요." : "AI 연결을 확인하고 있습니다…"}</span>{!noGateway && <button type="button" disabled={busy} onClick={() => { void fetchAuthStatus().then(setAuth); }}>연결 확인</button>}</div>}
    {plan && <>
      <div className="production-progress"><div><span>{busy ? activity : saved ? `${completed}개 씬의 초안이 안전하게 저장되었습니다` : `${completed}개 씬 작성 · 로컬 저장 실패, 파일 백업 필요`}</span><strong>{Math.round(completed / totalScenes * 100)}%</strong></div><div role="progressbar" aria-label="씬 집필 진행률" aria-valuemin={0} aria-valuemax={totalScenes} aria-valuenow={completed}><i style={{ width: `${completed / totalScenes * 100}%` }} /></div><div className="production-queue-actions">{busy ? <button type="button" onClick={() => { controllerRef.current?.abort(); setNotice("중단을 요청했습니다. 이미 완료한 씬은 보존됩니다."); }}><Icon name="stop" />집필 중단</button> : <button type="button" className="production-primary" disabled={!authenticated || !saved || editingBeat || completed === totalScenes} onClick={runQueue} data-testid="production-run"><Icon name="spark" />{completed ? "남은 씬 이어서 집필" : "전체 씬 순차 집필"}</button>}<p>{totalScenes - completed}개 씬을 한 번씩 요청합니다. 오류가 발생하면 멈추며 새로고침 뒤에도 저장 지점에서 재개할 수 있습니다.</p></div></div>
      <div className="production-workbench"><div className="production-chapters">{chapters.map((chapter, index) => <section key={chapter}><h3><span>{String(index + 1).padStart(2, "0")}</span>{chapter}</h3>{plan.outline.scenes.filter(scene => scene.chapter === chapter).map(scene => { const state = plan.jobs[scene.id]!; return <button type="button" key={scene.id} onClick={() => setSelectedId(scene.id)} aria-pressed={selected?.id === scene.id} className={`production-scene ${selected?.id === scene.id ? "selected" : ""}`} data-testid={`production-scene-${scene.id}`}><span className={`production-dot ${state.status}`} /><span><strong>{scene.title}</strong><small>{scene.targetMinutes}분 목표 · {statuses[state.status]}{scene.ending ? " · END" : scene.choices ? " · 분기" : ""}</small></span>{state.draft && <em>{(sceneCharacters(state.draft.scene) / plan.charsPerMinute).toFixed(1)}분</em>}</button>; })}</section>)}</div>
      {selected && <article className="production-scene-detail"><span className="production-eyebrow">SCENE BRIEF · {selected.id}</span><h2>{selected.title}</h2><p className="production-synopsis">{selected.summary}</p><div className="production-art-brief"><Icon name="image" /><div><h3>아트 디렉션</h3><p>{selected.artDirection}</p></div></div><div className="production-scene-stats"><span><b>{selected.targetMinutes}분</b> 목표 · {(selected.targetMinutes * plan.charsPerMinute).toLocaleString()}자</span><span><b>{job?.draft ? sceneCharacters(job.draft.scene).toLocaleString() : "0"}자</b> 작성</span></div>
        <div className="production-connections">{selected.choices?.map(choice => <span key={choice.next}>{choice.text} → {plan.outline.scenes.find(scene => scene.id === choice.next)?.title}</span>)}{selected.next && <span>다음 → {plan.outline.scenes.find(scene => scene.id === selected.next)?.title}</span>}{selected.ending && <span>ENDING · {selected.ending}</span>}</div>
        {job?.error && <p className="production-job-error">{job.error}</p>}
        <div className="production-actions"><button type="button" disabled={controlsDisabled || editingBeat} onClick={() => { void draft([selected.id], Boolean(job?.draft)); }} data-testid="production-draft-scene"><Icon name="spark" />{job?.draft ? "분량 보강" : job?.status === "error" ? "이 씬 다시 집필" : "이 씬 집필"}</button><button type="button" disabled={!canEditBeat} onClick={() => { setBeatTitle(selected.title); setBeatSummary(selected.summary); setBeatArt(selected.artDirection); setEditingBeat(true); }} data-testid="production-edit-beat"><Icon name="settings" />설계 수정</button>{script.scenes.some(scene => scene.id === selected.id) && <button type="button" onClick={() => onSelectScene(selected.id)}>에디터에서 열기<Icon name="arrow" /></button>}</div>
        {editingBeat && <form className="production-design-editor" onSubmit={event => { event.preventDefault(); saveBeat(); }}><label>씬 제목<input value={beatTitle} maxLength={100} onChange={event => setBeatTitle(event.target.value)} data-testid="production-beat-title" /></label><label>사건과 감정의 흐름<textarea value={beatSummary} maxLength={900} rows={4} onChange={event => setBeatSummary(event.target.value)} data-testid="production-beat-summary" /></label><label>아트 디렉션<textarea value={beatArt} maxLength={700} rows={3} onChange={event => setBeatArt(event.target.value)} /></label><div className="production-actions"><button type="submit" className="production-primary" disabled={!canEditBeat}>설계 저장</button><button type="button" onClick={() => setEditingBeat(false)}>취소</button></div><p>이 씬이나 이후 씬에 원고가 있으면 연속성을 보호하기 위해 설계를 잠급니다.</p></form>}
        {job?.draft ? <div className="production-manuscript"><h3>원고 미리보기 <span>{job.draft.scene.lines.length}줄 · {job.draft.model}</span></h3><div className="production-manuscript-lines">{job.draft.scene.lines.map((line, index) => <p key={index}><span>{line.speaker ? line.speaker === "me" ? "나" : plan.characters.find(character => character.id === line.speaker)?.name : "내레이션"}</span>{line.text}</p>)}</div><details><summary>다음 씬에 전달할 연속성 기록</summary><p>{job.draft.summary}</p><ul>{job.draft.continuity.map((fact, index) => <li key={index}>{fact}</li>)}</ul></details></div> : <div className="production-unwritten"><Icon name="file" size={28} /><h3>이 장면은 아직 설계 단계입니다</h3><p>사건과 시각적 방향을 확인한 뒤 집필하세요.<br />설계 내용은 원고 분량에 포함되지 않습니다.</p></div>}
      </article>}</div>
      <details className="production-bible"><summary>작품 설정집 · 인물과 복선의 기준</summary><div className="production-design-editor"><label>설정 · 인물 동기 · 말투 · 시간선 · 복선<textarea value={bibleText} maxLength={5000} rows={7} disabled={busy || completed > 0} onChange={event => setBibleText(event.target.value)} data-testid="production-bible-text" /></label>{completed > 0 ? <p>집필한 원고의 연속성을 유지하도록 설정집을 잠갔습니다. 새 기획에서 다른 설정으로 시작할 수 있습니다.</p> : <button type="button" disabled={busy || bibleText === plan.outline.bible} onClick={saveBible}>설정집 저장</button>}</div></details>
      <div className="production-publish"><div><h2>원고를 작품으로</h2><p>{completed === totalScenes ? `모든 씬을 집필했습니다. 현재 예상 1회차 ${staged ? durationLabel(staged) : "—"} / 목표 ${plan.targetMinutes}분. 적용 후 장면 편집과 플레이로 검수하세요.` : `아직 ${totalScenes - completed}개 씬의 원고가 필요합니다. 전체 원고와 연결을 검증한 뒤 작품에 적용합니다.`}</p>{changedBase && <p className="production-job-error">현재 작품이 계획의 시작 시점과 달라졌습니다. 적용할 작품: {script.title}</p>}</div><div className="production-actions">{changedBase ? <button type="button" disabled={busy} onClick={() => { commit({ ...plan, baseFingerprint: scriptFingerprint(script), baseTitle: script.title }); setError(""); }}>현재 작품 기준으로 다시 연결</button> : <button type="button" className="production-primary" disabled={busy || completed !== totalScenes} onClick={apply} data-testid="production-apply"><Icon name="check" />원고 적용</button>}<button type="button" disabled={completed !== totalScenes} onClick={() => { try { saveDownload(JSON.stringify(assembleProduction(plan), null, 2), `${plan.outline.title}.vn.json`); } catch (cause) { setError(String(cause)); } }}><Icon name="download" />원고 JSON</button></div></div>
    </>}
  </section>;
}
