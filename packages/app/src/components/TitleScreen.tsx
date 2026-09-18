import type { VnScript } from "@vnmaker/content";
import { assetUrl } from "../assetUrl.js";
import { estimateScriptDuration, durationLabel } from "../studio/production.js";
interface Props { readonly script: VnScript; readonly standalone?: boolean; readonly hasSave: boolean; readonly onStart: () => void; readonly onContinue: () => void; readonly onLoad: () => void; readonly onCredits: () => void; readonly onGallery: () => void; }
export function TitleScreen({ script, standalone=false, hasSave, onStart, onContinue, onLoad, onCredits, onGallery }: Props) {
  const first = script.scenes.find(scene=>scene.id===script.start)!;
  const cover = standalone ? first.cgUrl ?? first.backgroundUrl ?? `/assets/bg/${first.background}.png` : script.assets?.find(asset=>asset.url.includes("nocturne-atrium"))?.url ?? first.backgroundUrl ?? `/assets/bg/${first.background}.png`;
  const endings = script.scenes.filter(scene=>scene.ending).length;
  return <section className="title-screen rain-title" data-testid="title-screen">
    <img className="title-bg" data-testid="bg-image" src={assetUrl(cover)} alt="" />
    <div className="rain-title-wash" />
    <div className="rain-title-header"><span>VNMAKER <b>{standalone ? "VISUAL NOVEL" : "ORIGINAL"}</b></span>{!standalone && <a href={`${import.meta.env.BASE_URL}studio.html`} data-testid="studio-button">작품 편집 ↗</a>}</div>
    <div className="rain-title-copy"><p className="rain-title-eyebrow">AN INTERACTIVE STORY</p><h1>{script.title}</h1><p className="rain-title-subtitle">{script.subtitle}</p><div className="rain-title-rule" />{!standalone && script.title==="비가 남긴 빈칸" && <p className="rain-title-description">사라진 유리 한 장. 재생하지 않은 목소리.<br />마지막 전시를 앞둔 네 사람이, 함께 비워 두기로 한 것.</p>}<nav aria-label="시작 메뉴"><button className="rain-start" data-testid="start-button" onClick={onStart}>이야기 시작 <span>→</span></button><button className="rain-continue" data-testid="continue-button" disabled={!hasSave} onClick={onContinue}>이어서 읽기 <span>↗</span></button>{hasSave && <button className="rain-saves" data-testid="title-saves" onClick={onLoad}>저장 기록 <span>6 SLOTS</span></button>}<button className="rain-saves" data-testid="gallery-button" onClick={onGallery}>갤러리 <span>ARCHIVE</span></button><button className="rain-saves" data-testid="credits-button" onClick={onCredits}>크레딧 <span>CREDITS</span></button></nav><p className="rain-title-meta">{durationLabel(estimateScriptDuration(script))} 예상 · {script.scenes.length}개 장면 · {endings}개의 결말</p></div>
    <footer className="rain-title-footer"><span>VISUAL NOVEL · INTERACTIVE DRAMA</span><span>진행과 선택은 자동으로 저장됩니다.</span></footer>
  </section>;
}
