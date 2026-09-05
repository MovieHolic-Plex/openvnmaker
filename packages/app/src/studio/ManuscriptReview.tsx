import type { VnScript } from "@vnmaker/content";
import { auditScript } from "@vnmaker/content";
import { estimateScriptDuration, durationLabel, sceneCharacters } from "./production.js";
import { backgroundSrc, sceneTitle } from "./project.js";
import { Icon } from "./Icon.js";
import { useState } from "react";

export function ManuscriptReview({ script, onSelectScene }: { script: VnScript; onSelectScene: (id: string) => void }) {
  const [speed, setSpeed] = useState(320);
  const [query, setQuery] = useState("");
  const duration = estimateScriptDuration(script, speed);
  const issues = auditScript(script);
  const images = new Set(script.scenes.flatMap(scene => [scene.backgroundUrl, scene.cgUrl, ...scene.lines.flatMap(line=>[line.cgUrl,line.backgroundUrl])].filter(Boolean)));
  const complete = !duration.incomplete && !duration.hasCycle && (duration.minMinutes ?? 0) >= 90;
  return <section className="manuscript-review" data-testid="manuscript-review">
    <header className="manuscript-heading"><div><p className="eyebrow">MANUSCRIPT & PACING</p><h1>끝까지 읽을 수 있는,<br /><em>하나의 완성된 세계.</em></h1><p>실제 원고와 이미지, 선택의 연결을 확인하세요.</p></div><img src="/assets/art/glass-exhibition-dawn.png" alt="새벽빛을 받는 유리 전시" /></header>
    <div className="overview-metrics"><article><span><Icon name="clock" />1회차 예상 시간</span><strong>{durationLabel(duration)}</strong><small>시작부터 선택한 엔딩까지</small></article><article><span><Icon name="file" />완성 원고</span><strong>{duration.totalCharacters.toLocaleString()}<em> 자</em></strong><small>{script.scenes.reduce((total, scene) => total + scene.lines.length, 0)}줄 · 모든 분기 포함</small></article><article><span><Icon name="image" />장면 아트</span><strong>{images.size}<em> images</em></strong><small>{script.scenes.filter(scene => scene.cgUrl || scene.lines.some(line=>line.cgUrl)).length}개 장면의 이벤트 CG</small></article><article><span><Icon name={complete ? "check" : "warning"} />90분 기준</span><strong className={complete ? "metric-ready" : ""}>{complete ? "분량 충족" : "검토 필요"}</strong><small>{issues.length ? `${issues.length}건 작품 검토` : `${duration.endingCount}개 엔딩 · 연결 정상`}</small></article></div>
    <div className="manuscript-controls"><label>읽기 속도<select value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value={240}>천천히 · 240자/분</option><option value={320}>보통 · 320자/분</option><option value={400}>빠르게 · 400자/분</option></select></label><p>공백을 제외한 글자 수로 추정합니다. 보이스·연출 대기는 포함하지 않으며, 서로 다른 분기를 합쳐 플레이 시간을 늘리지 않습니다.</p></div>
    <div className="section-heading"><div><p className="eyebrow">CHAPTER INDEX</p><h2>장면별 원고와 연출</h2></div><label className="manuscript-search"><Icon name="search" size={14} /><input aria-label="원고 장면 검색" placeholder="챕터 또는 장면 검색" value={query} onChange={event => setQuery(event.target.value)} /></label></div>
    <div className="manuscript-scenes">{script.scenes.filter(scene => `${sceneTitle(scene)} ${scene.id}`.includes(query)).map((scene, index) => <button key={scene.id} onClick={() => onSelectScene(scene.id)}><div className="manuscript-thumb"><img src={backgroundSrc(scene)} alt="" /><span>{String(index + 1).padStart(2, "0")}</span></div><div className="manuscript-scene-copy"><small>{scene.id} {scene.choices?.length ? `· CHOICE × ${scene.choices.length}` : scene.ending ? "· ENDING" : ""}</small><h3>{sceneTitle(scene)}</h3><p>{scene.artBrief || scene.lines[0]?.text}</p></div><div className="manuscript-scene-stat"><strong>{(sceneCharacters(scene) / speed).toFixed(1)}분</strong><small>{scene.lines.length}줄 · {sceneCharacters(scene).toLocaleString()}자</small><span>{scene.cgUrl ? "이벤트 CG" : scene.backgroundUrl ? "전용 배경" : "기본 배경"}</span></div><Icon name="chevron" /></button>)}</div>
  </section>;
}
