import { useEffect, useRef, useState } from "react";
import { parseScript, type Artwork, type VnScript } from "@vnmaker/content";
import type { StoreCatalogItem } from "../api/store.js";
import { fetchHostCapabilities } from "../api/host.js";
import { STORE_SOURCES, storeSourceById } from "../api/storeSource.js";
import { Icon } from "./Icon.js";
import { installStoreAsset, type InstallProgress } from "./installFromStore.js";
import "./assets.css";

interface Props {
  /** 패널이 실제로 보일 때만 카탈로그를 조회한다. */
  readonly active?: boolean;
  readonly script: VnScript;
  readonly projectEpoch: number;
  readonly onChange: (script: VnScript) => void;
  /** 설치 후 아트 라이브러리가 새 카드를 바로 보여 줄 수 있게 한다. */
  readonly onInstalled?: (artworks: readonly Artwork[]) => void;
  /** 지정하면 종류 선택을 숨기고 그 종류만 보여 준다 — 음원 보관함의 "소리" 전용 패널처럼. */
  readonly fixedKind?: keyof typeof KIND_LABELS;
  /** 패널이 화면에 둘 이상 있을 때 구분한다. */
  readonly panelTestId?: string;
  /** 있으면 무대·CG 설치 직후 상태 줄에 '이 장면에 바로 적용' 버튼을 단다(현재 장면은 호출자가 안다). */
  readonly onApplyToScene?: (artwork: Artwork) => void;
}

const KIND_LABELS = { all: "전체", stage: "무대", character: "인물", sound: "소리" } as const;
const LICENSE_LABELS = { downloadable: "자유 다운로드", attribution: "출처 표시", embedded: "미리보기만" } as const;

/** 무대 변형은 이름이 같다(카페·밤이 넷). 분위기·날씨 facet으로 구분 라벨을 만든다. */
function variantLabel(item: StoreCatalogItem): string {
  const f = item.facets;
  if (!f) return "";
  return [f.mood, f.weather].filter(Boolean).join(" · ");
}

/** 캐릭터 선택의 '새 캐릭터 만들기' 센티넬 — 프로젝트에 캐릭터가 하나도 없어도 인물 에셋을 설치할 수 있다. */
const NEW_CHARACTER = "__new__";

/**
 * 에셋 스토어 패널. 출처를 골라 쓴다 — openvnmaker 저장소는 브라우저가 직접 받고,
 * losia.online 은 CORS 때문에 게이트웨이 프록시(/api/store/*)를 지난다.
 * 설치는 파일을 브라우저 보관함에 넣고 프로젝트 아트로 등록한다 — 플레이어와 ZIP 번들이 같은 경로를 쓴다.
 */
export function StorePanel({ active = true, script, projectEpoch, onChange, onInstalled, fixedKind, panelTestId = "store-panel", onApplyToScene }: Props) {
  const [sourceId, setSourceId] = useState<string>(STORE_SOURCES[0]!.id);
  const [sources, setSources] = useState<readonly typeof STORE_SOURCES[number][]>(STORE_SOURCES);
  const source = storeSourceById(sourceId);
  const [kindChoice, setKind] = useState<keyof typeof KIND_LABELS>(fixedKind ?? "all");
  const kind = fixedKind ?? kindChoice;
  const [sort, setSort] = useState<"new" | "use" | "name">("new");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<readonly StoreCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [take, setTake] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 설치 실패는 카탈로그 조회 실패와 다른 상태다 — 같은 변수에 쓰면
  // 목록 뱃지가 '연결 실패'로 바뀌어 스토어가 죽은 것처럼 보인다.
  const [installError, setInstallError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [pendingApply, setPendingApply] = useState<Artwork | null>(null);
  const [characterId, setCharacterId] = useState(script.characters[0]?.id ?? NEW_CHARACTER);
  const scriptRef = useRef(script);
  const epochRef = useRef(projectEpoch);
  // 목록 조회와 설치는 서로 다른 컨트롤러를 쓴다 — 검색 중 재조회가 설치 버튼을 '설치 중'에 가두면 안 된다.
  const listRef = useRef<AbortController | null>(null);
  const installRef = useRef<AbortController | null>(null);
  scriptRef.current = script;
  epochRef.current = projectEpoch;

  useEffect(() => () => { listRef.current?.abort(); installRef.current?.abort(); }, [projectEpoch]);

  // losia 위에서 열렸다면 losia 카탈로그가 주 출처다 — 첫 탭이 되고 기본 선택도 losia.
  useEffect(() => {
    void fetchHostCapabilities().then(caps => {
      if (caps?.host !== "losia") return;
      setSources([...STORE_SOURCES].sort((a, b) => Number(b.id === "losia") - Number(a.id === "losia")));
      setSourceId("losia");
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const controller = new AbortController();
    listRef.current = controller;
    setLoading(true);
    setError("");
    void source.search({ ...(kind === "all" ? {} : { kind }), ...(applied ? { q: applied } : {}), sort, take }, controller.signal)
      .then(catalog => {
        if (!alive) return;
        setItems(catalog.items);
        setTotal(catalog.total);
        setError("");
      })
      .catch((cause: unknown) => {
        if (!alive || controller.signal.aborted) return;
        // 실패한 재조회가 성공했을 때의 목록을 그 위에 남기지 않는다(오류와 오래된 목록이 같이 보이면 상태가 거짓말한다).
        setItems([]);
        setTotal(0);
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [active, source, kind, sort, applied, take]);

  async function install(item: StoreCatalogItem) {
    if (busy) return;
    // '새 캐릭터' 선택이면 설치 전에 id 를 발급한다 — 파일이 그 id 로 태깅되고 캐릭터가 같은 id 로 생긴다.
    const wantNew = item.kind === "character" && characterId === NEW_CHARACTER;
    const targetCharacterId = wantNew ? crypto.randomUUID() : characterId;
    const controller = new AbortController();
    const requestEpoch = projectEpoch;
    installRef.current = controller;
    setBusy(item.id); setInstallError(""); setMessage(""); setPendingApply(null); setProgress({ done: 0, total: 1 });
    try {
      const result = await installStoreAsset(source, item.id, {
        ...(item.kind === "character" && targetCharacterId && targetCharacterId !== NEW_CHARACTER ? { characterId: targetCharacterId } : {}),
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted || epochRef.current !== requestEpoch) {
        setMessage("작품이 변경되어 자동 등록을 중단했습니다. 파일은 브라우저 보관함에 남아 있습니다.");
        return;
      }
      const artworkIds = new Set(result.artworks.map(asset => asset.id));
      const audioIds = new Set(result.audio.map(asset => asset.id));
      // 설치는 어느 캐릭터의 어떤 표정인지 이미 안다. 표정표에 걸어 주지 않으면 그림만 보관함에 쌓이고
      // 무대에는 아무것도 뜨지 않는다 — 원본이 초록 배경이면 그 색도 같이 걸어야 초록 상자가 안 보인다.
      const chroma = result.manifest.chromaKey;
      const expressions = Object.fromEntries(result.artworks.flatMap(asset => asset.kind === "character" && asset.expression ? [[asset.expression, asset.url]] : []));
      // base 만 있고 무표정 표정이 없는 자산은 base 를 neutral 로 채운다 — 안 채우면 스프라이트가
      // 존재하지 않는 내장 경로로 빠져 무대에 아무것도 안 뜬다.
      if (expressions["neutral"] === undefined) {
        const base = result.artworks.find(asset => asset.kind === "character" && asset.expression === undefined);
        if (base) expressions["neutral"] = base.url;
      }
      const touched = targetCharacterId !== "" && targetCharacterId !== NEW_CHARACTER && result.artworks.some(asset => asset.kind === "character");
      const keyed = touched && chroma !== undefined;
      const newCharacter = wantNew && touched ? {
        id: targetCharacterId as VnScript["characters"][number]["id"],
        name: item.name,
        color: "#b6d7e8",
        bio: "",
        ...(Object.keys(expressions).length ? { expressionImages: expressions } : {}),
        ...(chroma === undefined ? {} : { chromaKey: chroma }),
      } : null;
      const next = parseScript({
        ...scriptRef.current,
        ...(touched ? { characters: [
          ...scriptRef.current.characters.map(character => character.id !== targetCharacterId ? character : {
            ...character,
            ...(chroma === undefined ? {} : { chromaKey: chroma }),
            ...(Object.keys(expressions).length ? { expressionImages: { ...character.expressionImages, ...expressions } } : {}),
          }),
          ...(newCharacter ? [newCharacter] : []),
        ] } : {}),
        assets: [...(scriptRef.current.assets ?? []).filter(asset => !artworkIds.has(asset.id)), ...result.artworks],
        audioAssets: [...(scriptRef.current.audioAssets ?? []).filter(asset => !audioIds.has(asset.id)), ...result.audio],
      });
      if (newCharacter) setCharacterId(newCharacter.id);
      onChange(next);
      onInstalled?.(result.artworks);
      if (onApplyToScene) setPendingApply(result.artworks.find(asset => asset.kind === "background" || asset.kind === "cg") ?? null);
      const parts = [result.artworks.length ? `이미지 ${result.artworks.length}개` : "", result.audio.length ? `음원 ${result.audio.length}개` : ""].filter(Boolean).join(" · ");
      const linkNote = Object.keys(expressions).length
        ? newCharacter
          ? ` ‘${item.name}’ 캐릭터를 새로 만들고 표정 ${Object.keys(expressions).length}종을 연결했습니다.`
          : ` 표정 ${Object.keys(expressions).length}종을 이 캐릭터에 연결했습니다.`
        : "";
      setMessage(`‘${item.name}’ 설치 완료 — ${parts}. 라이브러리에서 장면에 적용하세요.${linkNote}${keyed ? " 원본이 단색 배경이라 배경 제거도 켰습니다." : ""}${result.ignored.length ? ` (지원하지 않는 역할 ${result.ignored.length}개는 건너뛰었습니다)` : ""}`);
    } catch (cause) {
      if (!controller.signal.aborted) setInstallError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (installRef.current === controller) { installRef.current = null; setBusy(""); setProgress(null); }
    }
  }

  const installedIds = new Set((script.assets ?? []).filter(asset => asset.id.startsWith(`${source.idPrefix}-`)).map(asset => asset.id));

  return <section className="art-section art-store" data-testid={panelTestId}>
    <div className="art-section-title"><Icon name="download" /><h2>에셋 스토어</h2><span className={loading ? "" : error ? "is-error" : "is-connected"}>{loading ? "불러오는 중" : error ? "연결 실패" : `${total}개`}</span></div>
    <div className="art-store-sources" role="tablist" aria-label="에셋 출처">
      {sources.map(option => <button
        key={option.id}
        type="button"
        role="tab"
        aria-selected={option.id === sourceId}
        className={`art-store-source ${option.id === sourceId ? "is-active" : ""}`}
        data-testid={`store-source-${option.id}`}
        onClick={() => { if (option.id === sourceId) return; setSourceId(option.id); setItems([]); setTotal(0); setError(""); setInstallError(""); setMessage(""); setTake(12); }}
      >{option.label}</button>)}
    </div>
    <form className="art-store-search" onSubmit={event => { event.preventDefault(); setApplied(query.trim()); }}>
      <input aria-label="스토어 검색" data-testid="store-search" placeholder="무대·인물·소리 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="submit" className="art-text-button">검색</button>
    </form>
    <div className="art-store-filters">
      {fixedKind === undefined && <label>종류<select aria-label="스토어 종류" data-testid="store-kind" value={kind} onChange={event => setKind(event.target.value as keyof typeof KIND_LABELS)}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <label>정렬<select aria-label="스토어 정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="new">최신</option><option value="use">사용순</option><option value="name">이름</option></select></label>
    </div>
    {kind !== "stage" && kind !== "sound" && <label className="art-store-character">인물 에셋을 입힐 캐릭터<select aria-label="스토어 캐릭터" data-testid="store-character" value={characterId} onChange={event => setCharacterId(event.target.value)}><option value={NEW_CHARACTER}>＋ 이 에셋으로 새 캐릭터</option>{script.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}
    <p className="art-store-hint" data-testid="store-hint">{source.hint}</p>
    <div className="art-store-list" data-testid="store-list">
      {items.map(item => <div className="art-store-item" key={item.id} data-testid={`store-item-${item.id}`}>
        <div className="art-store-thumb">
          {item.thumb && !brokenThumbs.has(item.id) ? <img src={item.thumb} alt="" loading="lazy" onError={() => setBrokenThumbs(previous => new Set(previous).add(item.id))} /> : <span className="art-store-thumb-empty"><Icon name="image" size={18} /></span>}
        </div>
        <div className="art-store-copy">
          <strong>{item.name}</strong>
          <small>{KIND_LABELS[item.kind]} · {LICENSE_LABELS[item.license]}{variantLabel(item) ? ` · ${variantLabel(item)}` : ""}{item.tags?.length ? ` · ${item.tags.slice(0, 3).join(" ")}` : ""}</small>
          <span className={`art-store-license is-${item.license}`}>{item.license === "embedded" ? "미리보기만 볼 수 있습니다(설치 불가)" : item.kind === "sound" ? "음원으로 설치" : item.kind === "character" ? (characterId === NEW_CHARACTER ? "이 에셋으로 새 캐릭터를 만듭니다" : characterId ? `‘${script.characters.find(c => c.id === characterId)?.name ?? ""}’의 외형으로 설치` : "선택한 캐릭터의 외형으로 설치") : "이미지로 설치"}</span>
        </div>
        <button type="button" className={`art-primary art-store-install ${busy === item.id ? "is-busy" : ""}`} data-testid={`store-install-${item.id}`} disabled={busy !== "" || item.license === "embedded"} onClick={() => void install(item)}>
          {busy === item.id ? `설치 중 ${progress?.done ?? 0}/${progress?.total ?? 1}` : installedIds.has(`${source.idPrefix}-${item.id}-base`) || installedIds.has(`${source.idPrefix}-${item.id}-audio`) ? "다시 설치" : "설치"}
        </button>
      </div>)}
      {!items.length && !loading && !error && <p className="art-empty-line">조건에 맞는 자산이 없습니다.</p>}
      {items.length > 0 && items.length < total && <button type="button" className="art-text-button" data-testid="store-more" onClick={() => setTake(value => value + 12)}>더 보기 ({items.length}/{total})</button>}
    </div>
    {error && <p className="art-store-error" role="alert">{error}</p>}
    {installError && <p className="art-store-error" role="alert" data-testid="store-install-error">{installError}</p>}
    {message && <p className="art-store-message" role="status" data-testid="store-status">{message}{pendingApply && <button type="button" className="art-text-button art-store-apply-now" data-testid="store-apply-now" onClick={() => { const artwork = pendingApply; setPendingApply(null); onApplyToScene?.(artwork); }}>이 장면에 바로 적용</button>}</p>}
  </section>;
}
