import { BACKGROUNDS, validBackgroundUrl } from "@vnmaker/content";
import type { Scene, VnScript } from "@vnmaker/content";
import { useEffect, useRef, useState } from "react";
import { fetchAuthStatus, generateImage, generateLine, startLogin, type AuthStatus } from "../api/gateway.js";
import { Icon } from "./Icon.js";
import { AI_MODES, makePrompt, parseProposal, sceneTitle, type AiMode, type Proposal } from "./project.js";

interface Props { script: VnScript; scene: Scene; lineIndex: number; onApply: (script: VnScript, sceneId: string, lineIndex: number) => void }
export function AiPanel({ script, scene, lineIndex, onApply }: Props) {
  const [mode, setMode] = useState<AiMode>("continue");
  const [instruction, setInstruction] = useState("");
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const proposalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (proposal && proposalRef.current?.getClientRects().length) proposalRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [proposal]);
  useEffect(() => {
    void fetchAuthStatus().then(setAuth);
    void fetch("/api/generate/config").then(res => res.json()).then((data: { model?: string }) => setModel(data.model ?? "")).catch(() => {});
    return () => abortRef.current?.abort();
  }, []);
  const stale = proposal !== null && JSON.stringify(proposal.base) !== JSON.stringify(script);
  async function connect() {
    setConnecting(true); setError(null);
    try { setAuth(await startLogin()); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setConnecting(false); }
  }
  async function generate() {
    if (!instruction.trim() || busy || !auth?.authenticated) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true); setError(null); setProposal(null); setNotice("");
    try {
      if (mode === "image") {
        const result = await generateImage(`Visual novel background, cinematic full-bleed composition, no people, no text, 16:9. ${BACKGROUNDS[scene.background as keyof typeof BACKGROUNDS]}. ${instruction}`, "16:9", controller.signal);
        if (!validBackgroundUrl(result.url)) throw new Error("생성된 배경 주소가 올바르지 않습니다.");
        if (controller.signal.aborted) return;
        setProposal({ title: "새 배경 제안", detail: `${sceneTitle(scene)}에 적용합니다.`, base: script, next: { ...script, scenes: script.scenes.map(row => row.id === scene.id ? { ...row, backgroundUrl: result.url } : row) }, sceneId: scene.id, lineIndex, before: [], after: [], model: "이미지 생성", imageUrl: result.url });
      } else {
        const result = await generateLine(makePrompt(mode, instruction.trim(), script, scene, lineIndex), controller.signal);
        if (controller.signal.aborted) return;
        setProposal(parseProposal(result.text, mode, script, scene, lineIndex, result.model));
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abortRef.current === controller) { setBusy(false); abortRef.current = null; }
    }
  }
  const suggestions = mode === "rewrite" ? ["속마음을 숨기는 말투로", "짧고 자연스럽게"] : mode === "image" ? ["비 오는 저녁, 따뜻한 불빛", "노을빛 수채화 분위기"] : mode === "project" ? ["졸업 전날의 고백, 두 가지 엔딩", "사라진 전시 작품을 찾는 미스터리"] : mode === "branch" ? ["솔직하게 말하기와 숨기기", "함께 남기와 혼자 떠나기"] : ["두 사람 사이에 미묘한 긴장감", "예상치 못한 문자가 도착한다"];
  return <div className="ai-panel" data-testid="studio-ai-panel">
    <div className="ai-intro"><span className="ai-orb"><Icon name="spark" size={24} /></span><p className="eyebrow">YOUR CREATIVE PARTNER</p><h2>다음 이야기를,<br /><em>함께 만들어 볼까요?</em></h2><p>장면의 맥락을 읽고, 당신의 의도를<br />플레이할 수 있는 이야기로.</p></div>
    <div className="ai-context"><Icon name="file" /><span>{sceneTitle(scene)}</span><small>{mode === "rewrite" ? `${lineIndex + 1}번째 대사` : `${scene.lines.length}줄의 맥락`}</small></div>
    <form className="ai-composer" onSubmit={event => { event.preventDefault(); void generate(); }}>
      <label className="studio-field">만들고 싶은 것<select data-testid="studio-ai-mode" value={mode} disabled={busy} onChange={event => { setMode(event.target.value as AiMode); setProposal(null); setError(null); }}>{AI_MODES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <p className="field-help">{AI_MODES.find(item => item.id === mode)?.hint}</p>
      <textarea data-testid="studio-ai-prompt" aria-label="AI에게 요청할 내용" placeholder="예: 서린이 진심을 말하려다 망설이는 장면을 이어 써줘…" rows={4} maxLength={2000} value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)} />
      <div className="ai-suggestions">{suggestions.map(text => <button key={text} type="button" disabled={busy} onClick={() => setInstruction(text)}>{text}<Icon name="plus" size={12} /></button>)}</div>
      {busy ? <button type="button" className="studio-button ai-generate" onClick={() => { abortRef.current?.abort(); setBusy(false); setNotice("요청 대기를 취소했습니다. 서버에서 시작한 생성은 계속될 수 있습니다."); }}><span className="loading-dot" />쓰는 중 · 대기 취소<Icon name="stop" size={13} /></button> : <button type="submit" className="studio-button ai-generate" data-testid="studio-ai-generate" disabled={!instruction.trim() || !auth?.authenticated}><Icon name="spark" />{mode === "image" ? "배경 생성하기" : "제안 생성하기"}<Icon name="arrow" /></button>}
    </form>
    <div className={`ai-connection ${auth?.authenticated ? "connected" : ""}`}><i />{auth === null ? "연결 확인 중" : auth.authenticated ? "AI 연결됨" : auth.reachable ? "AI 연결 필요" : "게이트웨이 연결 불가"}{auth && !auth.authenticated && <button type="button" onClick={() => void connect()} disabled={connecting || !auth.reachable}>{connecting ? "연결 중…" : "Google 연결"}</button>}</div>
    {model && <p className="ai-model">{model}</p>}
    <p className="ai-disclosure">비공식 Antigravity 연결 · 텍스트와 이미지가 계정 할당량을 공유합니다.</p>
    {error && <div className="studio-alert" role="alert" data-testid="studio-ai-error"><Icon name="warning" /><div><strong>생성하지 못했습니다</strong><p>{error}</p><small>현재 작품은 변경되지 않았습니다.</small></div></div>}
    {notice && <p role="status" className="studio-notice">{notice}</p>}
    {proposal && <section ref={proposalRef} className="ai-proposal" data-testid="studio-ai-proposal"><div className="panel-heading"><Icon name="spark" /><h3>{proposal.title}</h3></div><p>{proposal.detail}</p>{proposal.before.length > 0 && <div className="diff-before"><small>변경 전</small>{proposal.before.map((text, index) => <p key={index}>{text}</p>)}</div>}{proposal.imageUrl && <img src={proposal.imageUrl} alt="AI가 제안한 배경" data-testid="studio-gen-preview" />}<div className="diff-after"><small>제안 · {proposal.model}</small>{proposal.after.map((text, index) => <p key={index}>{text}</p>)}</div>{stale && <p className="studio-error" role="alert">생성 후 작품이 변경됐습니다. 최신 내용으로 다시 생성하세요.</p>}<div className="proposal-actions"><button className="studio-button" type="button" onClick={() => setProposal(null)}>버리기</button><button className="studio-button primary" type="button" data-testid="studio-ai-apply" disabled={stale} onClick={() => { if (stale) return; onApply(proposal.next, proposal.sceneId, proposal.lineIndex); setProposal(null); setNotice("작품에 적용했습니다. 실행 취소로 되돌릴 수 있습니다."); }}><Icon name="check" />작품에 적용</button></div></section>}
    {!proposal && !busy && <div className="ai-footnote"><span>01 <b>요청</b></span><Icon name="chevron" size={12} /><span>02 <b>검토</b></span><Icon name="chevron" size={12} /><span>03 <b>적용</b></span></div>}
  </div>;
}
