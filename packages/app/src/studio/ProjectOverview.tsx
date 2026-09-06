import type { VnScript } from "@vnmaker/content";
import { auditScript } from "@vnmaker/content";
import { Icon } from "./Icon.js";
import { backgroundSrc, sceneTitle } from "./project.js";
import { estimateScriptDuration } from "./production.js";
import { TeamCreditsEditor } from "./TeamCreditsEditor.js";

export function durationLabel(script: VnScript): string {
  const duration = estimateScriptDuration(script);
  if (duration.hasCycle) return "순환 경로";
  if (duration.minMinutes === null || duration.maxMinutes === null) return "연결 확인";
  const low = Math.round(duration.minMinutes * 10) / 10;
  const high = Math.round(duration.maxMinutes * 10) / 10;
  return low === high ? `${low}분` : `${low}–${high}분`;
}

interface Props {
  script: VnScript;
  onEdit: (script: VnScript, group?: string) => void;
  onNavigate: (view: "stage" | "production" | "assets" | "graph") => void;
  onSelectScene: (id: string) => void;
  onValidate: () => void;
}

export function ProjectOverview({ script, onEdit, onNavigate, onSelectScene, onValidate }: Props) {
  const duration = estimateScriptDuration(script);
  const issues = auditScript(script);
  const errors = issues.filter(issue => issue.severity === "error").length;
  const branches = script.scenes.filter(scene => scene.choices?.length).length;
  const endings = script.scenes.filter(scene => scene.ending).length;
  const artworkCount = new Set(script.assets?.map(asset => asset.url) ?? script.scenes.map(backgroundSrc)).size;
  const coverScene = script.scenes.find(scene => scene.id === script.start) ?? script.scenes[0]!;
  const cover = backgroundSrc(coverScene);
  const art = script.assets?.find(asset => asset.kind === "cg")?.url ?? cover;
  const progress = Math.min(100, (duration.minMinutes ?? 0) / 90 * 100);
  return <section className="project-overview" data-testid="project-overview">
    <div className="overview-heading"><div><p className="eyebrow">YOUR STORY, IN THE MAKING</p><h1>작품의 다음 장을 열어볼까요.</h1></div><span className="overview-local"><i /> LOCAL WORKSPACE</span></div>
    <div className="overview-hero">
      <img className="overview-hero-art" src={cover} alt={`${script.title}의 시작 장면 배경`} />
      <div className="overview-hero-copy"><span className="hero-tag"><Icon name="file" size={13} /> ORIGINAL VISUAL NOVEL</span><h2>{script.title}</h2><p>{script.subtitle || "아직 쓰이지 않은 이야기를, 플레이할 수 있는 세계로."}</p><div className="hero-actions"><button className="studio-button primary" onClick={() => onNavigate("stage")}><Icon name="play" size={15} />편집 이어가기</button><button className="studio-button hero-secondary" onClick={() => onNavigate("production")}><Icon name="clock" size={15} />원고·분량 검수</button></div></div>
      <div className="hero-art-credit"><span>ART COLLECTION / 01</span><b>{sceneTitle(coverScene)}</b></div>
    </div>
    <div className="overview-metrics">
      <article><span><Icon name="clock" />예상 플레이 시간</span><strong>{durationLabel(script)}</strong><small>현재 원고 · 공백 제외 320자/분</small></article>
      <article><span><Icon name="scenes" />이야기의 구성</span><strong>{script.scenes.length}<em> scenes</em></strong><small>선택 장면 {branches}개 · 엔딩 {endings}개</small></article>
      <article><span><Icon name="image" />작품의 이미지</span><strong>{artworkCount}<em> images</em></strong><small>배경 · 이벤트 CG · 캐릭터 표정</small></article>
      <button onClick={onValidate}><span><Icon name={errors ? "warning" : "check"} />작품 검증</span><strong className={errors ? "has-error" : "metric-ready"}>{errors ? `${errors}건 수정` : issues.length ? `${issues.length}건 검토` : "연결 정상"}</strong><small>빈 대사 · 분기 · 엔딩 도달 여부 <Icon name="arrow" size={12} /></small></button>
    </div>
    <TeamCreditsEditor script={script} onEdit={onEdit} />
    <div className="overview-columns">
      <article className="overview-production"><div className="section-heading"><div><p className="eyebrow">LONGFORM PRODUCTION</p><h2>90분, 밀도 있는 이야기로.</h2></div><span className="outline-badge">TARGET 90 MIN</span></div><p>실제 집필된 원고와 모든 선택 경로를 살펴보세요. 장면마다 배치한 이미지와 연출도 함께 편집할 수 있습니다.</p><div className="production-progress-label"><span>현재 원고의 최단 엔딩 경로</span><strong>{durationLabel(script)} <small>/ 90분</small></strong></div><div className="overview-progress" role="progressbar" aria-label="90분 기준 현재 원고 분량" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress}%` }} /></div><div className="overview-process"><span><b>01</b> 완성 원고</span><Icon name="chevron" size={12} /><span><b>02</b> 장면 아트</span><Icon name="chevron" size={12} /><span><b>03</b> 플레이 검수</span></div><button className="studio-button" onClick={() => onNavigate("production")}>원고와 챕터 살펴보기 <Icon name="arrow" size={14} /></button></article>
      <button className="overview-art" onClick={() => onNavigate("assets")}><img src={art} alt="현재 작품의 원화" /><div><span className="eyebrow">ART DIRECTION</span><h2>장면 너머의 감정까지.</h2><p>배경 · 이벤트 CG · 캐릭터 표정</p><span className="art-open">아트 라이브러리 <Icon name="arrow" size={15} /></span></div></button>
    </div>
    <div className="section-heading overview-scenes-heading"><div><p className="eyebrow">SCENE EXPLORER</p><h2>이야기의 순간들</h2></div><button className="text-button" onClick={() => onNavigate("graph")}>전체 스토리 맵 <Icon name="arrow" size={14} /></button></div>
    <div className="overview-scenes">{script.scenes.slice(0, 6).map((scene, index) => <button key={scene.id} onClick={() => onSelectScene(scene.id)}><div><img src={backgroundSrc(scene)} alt="" loading="lazy" /><span>{String(index + 1).padStart(2, "0")}</span>{scene.ending && <b>ENDING</b>}</div><strong>{sceneTitle(scene)}</strong><small>{scene.lines.length}줄 · {scene.choices?.length ? `${scene.choices.length}개의 선택` : scene.ending ? "마지막 장면" : "스토리 장면"}<Icon name="arrow" size={13} /></small></button>)}</div>
    <p className="overview-estimate-note">플레이 시간은 시작부터 각 엔딩까지의 원고 길이로 추정합니다. 읽기 속도, 보이스, 연출 대기 시간에 따라 실제 시간은 달라집니다. 설계 분량은 완성 원고에 포함하지 않습니다.</p>
  </section>;
}
