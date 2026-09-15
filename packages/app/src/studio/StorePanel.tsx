import { useEffect, useRef, useState } from "react";
import { parseScript, type Artwork, type VnScript } from "@vnmaker/content";
import { searchStoreAssets, type StoreCatalogItem } from "../api/store.js";
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
}

const KIND_LABELS = { all: "전체", stage: "무대", character: "인물", sound: "소리" } as const;
const LICENSE_LABELS = { downloadable: "자유 다운로드", attribution: "출처 표시", embedded: "미리보기만" } as const;

/**
 * losia.online 스토어 패널. 카탈로그는 게이트웨이 프록시(/api/store/*)를 지난다.
 * 설치는 파일을 브라우저 보관함에 넣고 프로젝트 아트로 등록한다 — 플레이어와 ZIP 번들이 같은 경로를 쓴다.
 */
export function StorePanel({ active = true, script, projectEpoch, onChange, onInstalled }: Props) {
  const [kind, setKind] = useState<keyof typeof KIND_LABELS>("all");
  const [sort, setSort] = useState<"new" | "use" | "name">("new");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<readonly StoreCatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [take, setTake] = useState(12);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [brokenThumbs, setBrokenThumbs] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [characterId, setCharacterId] = useState(script.characters[0]?.id ?? "");
  const scriptRef = useRef(script);
  const epochRef = useRef(projectEpoch);
  // 목록 조회와 설치는 서로 다른 컨트롤러를 쓴다 — 검색 중 재조회가 설치 버튼을 '설치 중'에 가두면 안 된다.
  const listRef = useRef<AbortController | null>(null);
  const installRef = useRef<AbortController | null>(null);
  scriptRef.current = script;
  epochRef.current = projectEpoch;

  useEffect(() => () => { listRef.current?.abort(); installRef.current?.abort(); }, [projectEpoch]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const controller = new AbortController();
    listRef.current = controller;
    setLoading(true);
    setError("");
    void searchStoreAssets({ ...(kind === "all" ? {} : { kind }), ...(applied ? { q: applied } : {}), sort, take }, controller.signal)
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
  }, [active, kind, sort, applied, take]);

  async function install(item: StoreCatalogItem) {
    if (busy) return;
    const controller = new AbortController();
    const requestEpoch = projectEpoch;
    installRef.current = controller;
    setBusy(item.id); setError(""); setMessage(""); setProgress({ done: 0, total: 1 });
    try {
      const result = await installStoreAsset(item.id, {
        ...(item.kind === "character" && characterId ? { characterId } : {}),
        signal: controller.signal,
        onProgress: setProgress,
      });
      if (controller.signal.aborted || epochRef.current !== requestEpoch) {
        setMessage("작품이 변경되어 자동 등록을 중단했습니다. 파일은 브라우저 보관함에 남아 있습니다.");
        return;
      }
      const artworkIds = new Set(result.artworks.map(asset => asset.id));
      const audioIds = new Set(result.audio.map(asset => asset.id));
      const next = parseScript({
        ...scriptRef.current,
        assets: [...(scriptRef.current.assets ?? []).filter(asset => !artworkIds.has(asset.id)), ...result.artworks],
        audioAssets: [...(scriptRef.current.audioAssets ?? []).filter(asset => !audioIds.has(asset.id)), ...result.audio],
      });
      onChange(next);
      onInstalled?.(result.artworks);
      const parts = [result.artworks.length ? `이미지 ${result.artworks.length}개` : "", result.audio.length ? `음원 ${result.audio.length}개` : ""].filter(Boolean).join(" · ");
      setMessage(`‘${item.name}’ 설치 완료 — ${parts}. 라이브러리에서 장면에 적용하세요.${result.ignored.length ? ` (지원하지 않는 역할 ${result.ignored.length}개는 건너뛰었습니다)` : ""}`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (installRef.current === controller) { installRef.current = null; setBusy(""); setProgress(null); }
    }
  }

  const installedIds = new Set((script.assets ?? []).filter(asset => asset.id.startsWith("losia-")).map(asset => asset.id));

  return <section className="art-section art-store" data-testid="store-panel">
    <div className="art-section-title"><Icon name="download" /><h2>losia 스토어</h2><span className={loading ? "" : error ? "is-error" : "is-connected"}>{loading ? "불러오는 중" : error ? "연결 실패" : `${total}개`}</span></div>
    <form className="art-store-search" onSubmit={event => { event.preventDefault(); setApplied(query.trim()); }}>
      <input aria-label="스토어 검색" data-testid="store-search" placeholder="무대·인물·소리 검색" value={query} onChange={event => setQuery(event.target.value)} />
      <button type="submit" className="art-text-button">검색</button>
    </form>
    <div className="art-store-filters">
      <label>종류<select aria-label="스토어 종류" data-testid="store-kind" value={kind} onChange={event => setKind(event.target.value as keyof typeof KIND_LABELS)}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>정렬<select aria-label="스토어 정렬" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="new">최신</option><option value="use">사용순</option><option value="name">이름</option></select></label>
    </div>
    {kind !== "stage" && kind !== "sound" && <label className="art-store-character">설치할 캐릭터<select aria-label="스토어 캐릭터" data-testid="store-character" value={characterId} onChange={event => setCharacterId(event.target.value)}>{script.characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>}
    <p className="art-store-hint">losia.online의 공개 자산입니다. 설치하면 이 작품의 보관함에 들어가고, 플레이어와 게임 ZIP에 함께 담깁니다.</p>
    <div className="art-store-list" data-testid="store-list">
      {items.map(item => <div className="art-store-item" key={item.id} data-testid={`store-item-${item.id}`}>
        <div className="art-store-thumb">
          {item.thumb && !brokenThumbs.has(item.id) ? <img src={item.thumb} alt="" loading="lazy" onError={() => setBrokenThumbs(previous => new Set(previous).add(item.id))} /> : <span className="art-store-thumb-empty"><Icon name="image" size={18} /></span>}
        </div>
        <div className="art-store-copy">
          <strong>{item.name}</strong>
          <small>{KIND_LABELS[item.kind]} · {LICENSE_LABELS[item.license]}{item.tags?.length ? ` · ${item.tags.slice(0, 3).join(" ")}` : ""}</small>
          <span className={`art-store-license is-${item.license}`}>{item.license === "embedded" ? "미리보기만 볼 수 있습니다(설치 불가)" : item.kind === "sound" ? "음원으로 설치" : "이미지로 설치"}</span>
        </div>
        <button type="button" className={`art-primary art-store-install ${busy === item.id ? "is-busy" : ""}`} data-testid={`store-install-${item.id}`} disabled={busy !== "" || item.license === "embedded"} onClick={() => void install(item)}>
          {busy === item.id ? `설치 중 ${progress?.done ?? 0}/${progress?.total ?? 1}` : installedIds.has(`losia-${item.id}-base`) || installedIds.has(`losia-${item.id}-audio`) ? "다시 설치" : "설치"}
        </button>
      </div>)}
      {!items.length && !loading && !error && <p className="art-empty-line">조건에 맞는 자산이 없습니다.</p>}
      {items.length > 0 && items.length < total && <button type="button" className="art-text-button" data-testid="store-more" onClick={() => setTake(value => value + 12)}>더 보기 ({items.length}/{total})</button>}
    </div>
    {error && <p className="art-store-error" role="alert">{error}</p>}
    {message && <p className="art-store-message" role="status" data-testid="store-status">{message}</p>}
  </section>;
}
