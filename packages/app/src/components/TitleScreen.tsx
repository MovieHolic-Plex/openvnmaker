import { script } from "@vnmaker/content";
import { estimateScriptDuration, durationLabel } from "../studio/production.js";
interface Props { readonly title: string; readonly subtitle: string; readonly hasSave: boolean; readonly onStart: () => void; readonly onContinue: () => void; }
export function TitleScreen({ title, subtitle, hasSave, onStart, onContinue }: Props) {
  return <section className="title-screen rain-title" data-testid="title-screen">
    <img className="title-bg" data-testid="bg-image" src="/assets/art/nocturne-atrium.png" alt="비가 그친 유리별관의 밤" />
    <div className="rain-title-wash" />
    <div className="rain-title-header"><span>VNMAKER <b>ORIGINAL</b></span><a href="/studio.html" data-testid="studio-button">작품 편집 ↗</a></div>
    <div className="rain-title-copy"><p className="rain-title-eyebrow">THE SPACE THE RAIN LEFT</p><h1>{title}</h1><p className="rain-title-subtitle">{subtitle}</p><div className="rain-title-rule" /><p className="rain-title-description">사라진 유리 한 장. 재생하지 않은 목소리.<br />마지막 전시를 앞둔 네 사람이, 함께 비워 두기로 한 것.</p><nav aria-label="시작 메뉴"><button className="rain-start" data-testid="start-button" onClick={onStart}>이야기 시작 <span>→</span></button><button className="rain-continue" data-testid="continue-button" disabled={!hasSave} onClick={onContinue}>이어서 읽기 <span>↗</span></button></nav><p className="rain-title-meta">{durationLabel(estimateScriptDuration(script))} 예상 · {script.scenes.length}개 장면 · 두 개의 결말</p></div>
    <footer className="rain-title-footer"><span>청춘 미스터리 · 인터랙티브 드라마</span><span>소리를 켜고 천천히 머물러 주세요.</span></footer>
  </section>;
}
