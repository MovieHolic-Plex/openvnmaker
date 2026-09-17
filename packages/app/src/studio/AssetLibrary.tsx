import { ArtImage } from "../components/ArtImage.js";
import { useEffect, useRef, useState } from "react";
import { EXPRESSIONS, type Artwork, type Scene, type VnScript } from "@vnmaker/content";
import { fetchAuthStatus, generateImage, type ImageBackend, type ImageBackendInfo } from "../api/gateway.js";
import { fetchHostCapabilities } from "../api/host.js";
import { Icon } from "./Icon.js";
import { applyArtwork, artPrompt, assetUsage, createGeneratedArtwork, DEFAULT_ART_DIRECTION, libraryAssets, pendingArtScenes, recoveredArtwork, registerArtwork, rememberArtwork, sceneArtBrief, unregisterArtwork, type RecoveredArtwork } from "./assets.js";
import { removeUnreferencedAssets } from "./assetCleanup.js";
import { readActiveProjectId } from "./projects.js";
import { StorageUsage } from "./StorageUsage.js";
import "./assets.css";
import { ArtImportButton } from "./ArtImportButton.js";
import { StorePanel } from "./StorePanel.js";
import { MediaProvenanceEditor } from "./MediaProvenanceEditor.js";
import { LosiaAssetPublish } from "./LosiaAssetPublish.js";

interface Props {
  readonly generationEnabled?: boolean;
  /** 아트 작업 공간이 실제로 보이는지. 숨겨진 채 마운트만 된 동안에는 네트워크를 쓰지 않는다. */
  readonly active?: boolean;
  readonly script: VnScript;
  readonly scene: Scene;
  readonly projectEpoch: number;
  readonly onChange: (script: VnScript) => void;
  readonly onPatchScene: (patch: Partial<Scene>) => void;
}
const kindLabels = { background: "배경", cg: "이벤트 CG", character: "캐릭터" } as const;
const expressionLabels = { neutral: "기본", smile: "미소", sad: "슬픔", surprised: "놀람" } as const;

export function AssetLibrary({ script, scene, projectEpoch, onChange, onPatchScene, generationEnabled = true, active = true }: Props) {
  const [filter, setFilter] = useState<Artwork["kind"] | "all">("all");
  const [selectedId, setSelectedId] = useState("curated-nocturne-atrium");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<Artwork["kind"]>("background");
  const [brief, setBrief] = useState("");
  const [characterId, setCharacterId] = useState<Artwork["characterId"]>(script.characters[0]?.id);
  const [expression, setExpression] = useState<NonNullable<Artwork["expression"]>>("neutral");
  const [authenticated, setAuthenticated] = useState(false);
  const [model, setModel] = useState("");
  const [authRequired, setAuthRequired] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [backends, setBackends] = useState<readonly ImageBackendInfo[]>([]);
  const [backend, setBackend] = useState<ImageBackend | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState(recoveredArtwork);
  const [storageEpoch, setStorageEpoch] = useState(0);
  const scriptRef = useRef(script);
  const epochRef = useRef(projectEpoch);
  epochRef.current = projectEpoch;
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => { scriptRef.current = script; }, [script]);
  useEffect(() => { controllerRef.current?.abort(); }, [projectEpoch]);
  useEffect(() => {
    // 수동 편집만 하는 동안 내부 API 를 부르지 않는다 — 아트 작업 공간을 열었을 때 확인한다.
    if (!generationEnabled || !active) return;
    let alive = true;
    void fetchHostCapabilities().then(host => {
      // 게이트웨이 없는 배포에는 생성 엔드포인트가 없다 — 죽은 프로브를 보내지 않는다.
      if (!alive || (host && !host.gateway)) return;
      void fetchAuthStatus().then(status => { if (alive) setAuthenticated(status.authenticated); });
      void fetch("/api/image/config").then(async (response): Promise<Record<string, unknown>> => response.ok ? await response.json() as Record<string, unknown> : {}).then(config => {
      if (!alive) return;
      if (typeof config["model"] === "string") setModel(config["model"]);
      if (config["authRequired"] === false) setAuthRequired(false);
      if (config["available"] === false) setBackendAvailable(false);
      if (Array.isArray(config["backends"])) { const list = config["backends"] as ImageBackendInfo[]; setBackends(list); setBackend(prev => prev ?? (config["backend"] as ImageBackend | undefined) ?? list[0]?.id); }
      }).catch(() => {});
    });
    return () => { alive = false; controllerRef.current?.abort(); };
  }, [generationEnabled, active]);
  useEffect(() => { setBrief(sceneArtBrief(script, scene, kind)); }, [scene.id, scene.artBrief, kind]);
  const activeBackend = backends.find(b => b.id === backend);
  // 선택한 백엔드 기준으로 로그인 필요/사용 가능 여부를 판단한다(둘 다 없으면 옛 단일 값).
  const needsAuth = activeBackend ? activeBackend.authRequired : authRequired;
  const canUseBackend = activeBackend ? activeBackend.available : backendAvailable;
  const ready = (!needsAuth && canUseBackend) || (needsAuth && authenticated);
  const assets = libraryAssets(script);
  const selected = assets.find(asset => asset.id === selectedId) ?? assets[0];
  const artworkCounts = { background: assets.filter(asset => asset.kind === "background").length, cg: assets.filter(asset => asset.kind === "cg").length, character: assets.filter(asset => asset.kind === "character").length };
  const cover = assets.find(asset => asset.kind === "background");
  const selectedCharacter = selected?.kind === "character" ? script.characters.find(character => character.id === selected.characterId) : undefined;
  const selectedExpression = selected?.expression ?? "neutral";
  const selectedContext = selectedCharacter ? `${selectedCharacter.name} · ${expressionLabels[selectedExpression as keyof typeof expressionLabels] ?? selectedExpression} 표정` : `현재 장면 · ${scene.chapter || scene.id}`;
  const visible = assets.filter(asset => (filter === "all" || asset.kind === filter) && `${asset.name} ${asset.prompt ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const missing = pendingArtScenes(script);
  const recoverable = recovery.filter(entry => !script.assets?.some(asset => asset.id === entry.asset.id));

  function recover(entry: RecoveredArtwork) {
    try {
      const { sceneId: _oldScene, ...asset } = entry.asset;
      onChange(registerArtwork(scriptRef.current, asset));
      setSelectedId(asset.id); setFilter(asset.kind);
      setMessage("이미지를 현재 라이브러리로 가져왔습니다. 장면에 적용하려면 이미지를 확인하세요.");
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function apply(asset: Artwork) {
    try {
      onChange(applyArtwork(scriptRef.current, scene.id, asset));
      setMessage(asset.kind === "character" ? (asset.expression ? "캐릭터의 표정 이미지에 적용했습니다." : "현재 장면의 배우 포즈에 적용했습니다.") : `‘${scene.chapter || scene.id}’에 ${kindLabels[asset.kind]}를 적용했습니다.`);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  /** 카드는 바로 빼고, 파일은 어떤 작품도 더 쓰지 않을 때만 지운다(보관함 파일은 작품 사이에서 공유된다). */
  async function remove(asset: Artwork) {
    if (assetUsage(scriptRef.current, asset) > 0) { setError("장면이나 배우가 아직 이 이미지를 사용합니다. 먼저 다른 이미지로 바꾸세요."); return; }
    let next: VnScript;
    try { next = unregisterArtwork(scriptRef.current, asset.id); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
    scriptRef.current = next; onChange(next); setError("");
    setSelectedId(""); setMessage(`‘${asset.name}’ 카드를 라이브러리에서 제거했습니다.`);
    if (!asset.url.startsWith("/assets/user/")) return;
    try {
      const result = await removeUnreferencedAssets([asset.url], { id: readActiveProjectId(), script: next });
      setMessage(result.removed.length ? `‘${asset.name}’ 카드와 보관함 파일을 삭제했습니다.` : `‘${asset.name}’ 카드를 제거했습니다. 다른 작품이나 버전 기록이 같은 파일을 써서 파일은 보관함에 남겼습니다.`);
      setStorageEpoch(value => value + 1);
    } catch (cause) { setMessage(`‘${asset.name}’ 카드를 제거했습니다. 보관함 파일 정리는 실패했습니다: ${cause instanceof Error ? cause.message : String(cause)}`); }
  }

  async function generate(batch: boolean) {
    if (busy) return;
    const queue = batch ? pendingArtScenes(scriptRef.current).slice(0, 6) : [scene];
    if (!queue.length) return;
    const controller = new AbortController();
    const requestEpoch = projectEpoch;
    controllerRef.current = controller;
    setBusy(true); setError(""); setMessage(""); setProgress({ done: 0, total: queue.length });
    let done = 0;
    try {
      for (const target of queue) {
        if (controller.signal.aborted) break;
        const snapshot = scriptRef.current;
        const role = batch ? "background" : kind;
        const text = artPrompt(snapshot, target, role, batch ? sceneArtBrief(snapshot, target) : brief, role === "character" ? characterId : undefined, role === "character" ? expression : undefined);
        const result = await generateImage(text, role === "character" ? "2:3" : "16:9", controller.signal, backend);
        const asset = createGeneratedArtwork(role, target, result, text, role === "character" ? characterId : undefined, role === "character" ? expression : undefined);
        // Keep a receipt before applying to the live project: imports/undo may replace it while a response is in flight.
        const receipts = rememberArtwork(asset, snapshot.title);
        setRecovery(receipts);
        if (controller.signal.aborted || epochRef.current !== requestEpoch) {
          setMessage("작품이 변경되어 자동 등록을 중단했습니다. 완료된 이미지는 생성 이미지 복구함에 보관했습니다.");
          return;
        }
        // Save each finished image immediately. Cancelling a later job cannot discard earlier work.
        const next = registerArtwork(scriptRef.current, asset);
        scriptRef.current = next;
        onChange(next);
        setSelectedId(asset.id); setFilter(role); setSearch("");
        done += 1; setProgress({ done, total: queue.length });
      }
      setMessage(`${done}개 이미지를 라이브러리에 저장했습니다. 이미지를 확인한 뒤 장면에 적용하세요.`);
    } catch (cause) {
      if (controller.signal.aborted) setMessage(`생성을 중단했습니다. 완료된 ${done}개 이미지는 라이브러리에 남아 있습니다.`);
      else setError(`${done ? `${done}개 저장 완료. ` : ""}${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  }

  return <section className="art-library" data-testid="art-library">
    <div className="art-library-main">
      <header className="art-library-heading"><div><span className="art-eyebrow">VISUAL DEVELOPMENT</span><h1>이야기의 온도를 그리다</h1><p>배경, 결정적인 순간, 인물의 표정까지. 작품의 모든 이미지를 한곳에서.</p></div><span className="art-count">{assets.length}<small>ARTWORKS</small></span></header>
      <StorageUsage refreshKey={storageEpoch} />
      <div className="art-curation-banner"><img src={cover?.url ?? "/assets/art/nocturne-atrium.png"} alt={cover?.name ?? "비 내린 유리 아트리움"} /><div><span>PROJECT ART COLLECTION</span><h2>{script.title}</h2><p>배경 {artworkCounts.background}장 · 이벤트 CG {artworkCounts.cg}장<br />캐릭터 원화 {artworkCounts.character}종이 준비되어 있습니다.</p></div></div>
      <div className="art-library-tools"><div className="art-filters" role="group" aria-label="이미지 종류">{(["all", "background", "cg", "character"] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === "all" ? "전체" : kindLabels[value]}<span>{assets.filter(asset => value === "all" || asset.kind === value).length}</span></button>)}</div><label className="art-search"><Icon name="search" /><input aria-label="아트 검색" placeholder="이미지 검색" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
      <div className="art-grid">{visible.map(asset => <button className={`art-card ${selected?.id === asset.id ? "is-selected" : ""} art-card--${asset.kind}`} key={asset.id} type="button" onClick={() => setSelectedId(asset.id)} aria-pressed={selected?.id === asset.id} data-testid={`art-card-${asset.id}`}><div className="art-card-image"><ArtImage src={asset.url} alt={asset.name} chromaKey={asset.kind === "character" ? script.characters.find(character => character.id === asset.characterId)?.chromaKey : undefined} /><span className="art-kind">{kindLabels[asset.kind]}</span>{assetUsage(script, asset) > 0 && <span className="art-used"><Icon name="check" size={11} />사용 중</span>}</div><strong>{asset.name}</strong><small>{script.assets?.some(saved => saved.id === asset.id) ? "작품에 등록된 이미지" : "컬렉션 에셋"}</small></button>)}</div>
      {visible.length === 0 && <div className="art-empty"><Icon name="image" size={28} /><p>일치하는 이미지가 없습니다.</p><button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>모든 이미지 보기</button></div>}
    </div>
    {selected && <div className="art-mobile-selection"><ArtImage className={`art-mobile-preview art-mobile-preview--${selected.kind}`} src={selected.url} alt={selected.name} chromaKey={selectedCharacter?.chromaKey} testId="art-mobile-preview" /><div><strong>{selected.name}</strong><small>{message || selectedContext}</small></div><button type="button" data-testid="art-quick-apply" onClick={() => apply(selected)}>적용<Icon name="check" size={13} /></button></div>}
    <aside className="art-workbench">
      {selected && <MediaProvenanceEditor key={selected.id} value={selected.provenance} onChange={provenance => onChange(registerArtwork(script, { ...selected, provenance }))} />}
      <StorePanel active={active} script={script} projectEpoch={projectEpoch} onChange={onChange} onInstalled={artworks => { const first = artworks[0]; if (first) { setSelectedId(first.id); setFilter(first.kind); setSearch(""); } }} />
      <ArtImportButton script={script} onImport={rows=>{let next=script;for(const asset of rows)next=registerArtwork(next,asset);onChange(next);setSelectedId(rows[0]!.id);setFilter("all");setSearch("");setMessage(`${rows.length}개 원화를 가져왔습니다. 장면에 적용할 이미지를 선택하세요.`);}}/>
      {selected && <section className="art-selection"><div className="art-section-title"><Icon name="image" /><h2>선택한 이미지</h2><span>{kindLabels[selected.kind]}</span></div><ArtImage className={`art-selected-preview art-selected-preview--${selected.kind}`} src={selected.url} alt={selected.name} chromaKey={selectedCharacter?.chromaKey} testId="art-selected-preview" /><strong>{selected.name}</strong><p>{selectedContext}{selected.kind === "character" ? "에 적용됩니다." : ""}</p><button className="art-primary" type="button" data-testid="art-apply" onClick={() => apply(selected)}><Icon name="check" />{selected.kind === "character" ? (selected.expression ? "이 표정에 적용" : "현재 장면에 포즈 적용") : "현재 장면에 적용"}</button>{script.assets?.some(saved => saved.id === selected.id) && <button className="art-secondary" type="button" data-testid="art-remove" disabled={assetUsage(script, selected) > 0} title={assetUsage(script, selected) > 0 ? "장면·배우의 이미지 지정을 먼저 바꾸세요." : "라이브러리에서 제거"} onClick={() => void remove(selected)}><Icon name="trash" size={13} />{assetUsage(script, selected) > 0 ? "사용 중이라 제거할 수 없음" : "라이브러리에서 제거"}</button>}<LosiaAssetPublish target={{ type: "image", asset: selected }} script={script} /></section>}
      <section className="art-direction"><div className="art-section-title"><Icon name="settings" /><h2>작품 아트 디렉션</h2></div><textarea aria-label="작품 아트 디렉션" value={script.artDirection ?? DEFAULT_ART_DIRECTION} placeholder="화풍, 색감, 조명과 캐릭터 외형을 적어 주세요." onChange={event => onChange({ ...script, artDirection: event.target.value })} maxLength={3000} rows={4} /><p>현재 작품의 색감, 화풍과 인물 외형을 정리한 제작 기준입니다.</p></section>
      {generationEnabled && <section className="art-generation"><div className="art-section-title"><Icon name="spark" /><h2>이미지 스튜디오</h2><span className={ready ? "is-connected" : ""}>{needsAuth ? (authenticated ? "연결됨" : "로그인 필요") : (canUseBackend ? (backend === "codex" ? "Codex 준비됨" : "준비됨") : (backend === "codex" ? "Codex 없음" : "사용 불가"))}</span></div>
        {backends.length > 1 && <label>생성 엔진<select aria-label="이미지 생성 엔진" value={backend ?? ""} disabled={busy} data-testid="art-backend" onChange={event => setBackend(event.target.value as ImageBackend)}>{backends.map(info => <option key={info.id} value={info.id} disabled={!info.available}>{info.id === "codex" ? "Codex (로컬 ChatGPT)" : "Agy (Google Gemini)"}{info.available ? "" : " · 사용 불가"}</option>)}</select></label>}
        <label>만들 이미지<select aria-label="생성 이미지 종류" value={kind} disabled={busy} onChange={event => setKind(event.target.value as Artwork["kind"])}><option value="background">장면 배경</option><option value="cg">이벤트 CG</option><option value="character">캐릭터 원화</option></select></label>
        {kind === "character" && <div className="art-character-fields"><label>캐릭터<select aria-label="이미지 캐릭터" value={characterId ?? ""} disabled={busy} onChange={event => setCharacterId(event.target.value as Artwork["characterId"])}>{script.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label><label>표정<select aria-label="이미지 표정" value={expression} disabled={busy} onChange={event => setExpression(event.target.value as typeof expression)}>{EXPRESSIONS.map(value => <option key={value}>{value}</option>)}</select></label></div>}
        <label>장면 아트 브리프<textarea aria-label="장면 아트 브리프" value={brief} disabled={busy} onChange={event => setBrief(event.target.value)} maxLength={4000} rows={5} /></label>
        <button className="art-text-button" type="button" disabled={busy} onClick={() => { onPatchScene({ artBrief: brief }); setMessage("장면에 아트 브리프를 저장했습니다."); }}>이 브리프를 장면에 저장</button>
        {kind === "character" && <p>캐릭터 원화 생성 후 투명 배경 처리가 필요합니다. 자동 누끼 제거는 지원하지 않습니다.</p>}
        <button className="art-primary" type="button" data-testid="art-generate" disabled={busy || !ready || !brief.trim() || (kind === "character" && !characterId)} onClick={() => void generate(false)}><Icon name="spark" />{busy ? `이미지 생성 중 ${progress?.done ?? 0}/${progress?.total ?? 1}` : "이미지 생성"}</button>
        {busy ? <button className="art-secondary" type="button" onClick={() => controllerRef.current?.abort()}><Icon name="stop" />생성 중단</button> : missing.length > 0 && <button className="art-secondary" type="button" disabled={!ready} onClick={() => void generate(true)}>미완성 장면 {Math.min(missing.length, 6)}개 배경 생성</button>}
        <p className="art-model">{model || "이미지 모델 연결 확인 중"} · 16:9 / 캐릭터 2:3<br />{authRequired ? "연결 계정의 비공식 API · 계정 할당량을 공유합니다." : "로컬 Codex CLI로 생성 · 플랜 사용량을 소비합니다."}</p>
      </section>}
      {recoverable.length > 0 && <section className="art-recovery"><div className="art-section-title"><Icon name="undo" /><h2>생성 이미지 복구함</h2><span>{recoverable.length}</span></div><p>다른 작품에서 만든 이미지와 등록 전 완료된 이미지를 최대 20개 보관합니다.</p>{recoverable.map(entry => <div className="art-recovery-item" key={entry.asset.id}><img src={entry.asset.url} alt={entry.asset.name} /><div><strong>{entry.asset.name}</strong><small>{entry.projectTitle}</small><button type="button" onClick={() => recover(entry)}>라이브러리로 가져오기</button><a href={entry.asset.url} download>원본 저장</a></div></div>)}</section>}
      {error && <p className="art-error" role="alert">{error}</p>}{message && <p className="art-message" role="status">{message}</p>}
    </aside>
  </section>;
}
