import {manuscriptKey} from "./storage/manuscriptKey.js";
import { parseScript, script as bundledScript } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BgmPlayer } from "./audio/BgmPlayer.js";
import { VoicePlayer } from "./audio/VoicePlayer.js";
import { playSfx } from "./audio/sfx.js";
import { ChoiceMenu } from "./components/ChoiceMenu.js";
import { DialogueBox } from "./components/DialogueBox.js";
import { EndingScreen } from "./components/EndingScreen.js";
import { HistoryPanel, SettingsPanel, SlotPicker } from "./components/Panels.js";
import { PaperTexture } from "./components/PaperTexture.js";
import { Stage } from "./components/Stage.js";
import { Toolbar } from "./components/Toolbar.js";
import { CreditsPanel } from "./components/CreditsPanel.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { reduce } from "./engine/reducer.js";
import { currentLine, currentScene, backgroundAt, bgmAt, cgAt, framingAt, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { initialState, type SaveData, type VnAction, type VnState } from "./engine/types.js";
import { useTypewriter } from "./hooks/useTypewriter.js";
import { defaultSettings, latestSave, listSlots, loadSettings, readAutoSlot, readSlot, writeAutoSlot, writeSave, writeSettings, writeSlot, type Settings, type SlotSave } from "./storage/persist.js";

declare global {
  interface Window {
    __vn?: {
      sceneId: string;
      lineIndex: number;
      affection: number;
      typing: boolean;
      phase: string;
      error: string | null;
      lastDiff: string | null;
      flags: VnState["flags"];
    };
  }
}

type Panel = "credits" | "none" | "history" | "settings" | "save" | "load";

export function App({ initialScript, standalone = false, projectNamespace = "" }: { initialScript?: VnScript; standalone?: boolean; projectNamespace?: string } = {}) {
  const script = initialScript ?? bundledScript;
  const isStudioPreview = !standalone && new URLSearchParams(window.location.search).get("preview") === "1";
  const saveScope = [projectNamespace,isStudioPreview ? "preview" : ""].filter(Boolean).join(":");
  const scriptRef = useRef<VnScript>(script);
  const [vnScript, setVnScript] = useState<VnScript>(script);
  const [state, dispatch] = useReducer(
    (s: VnState, a: VnAction) => reduce(scriptRef.current, s, a),
    script,
    initialState,
  );
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [voiceDone,setVoiceDone]=useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [auto, setAuto] = useState(false);
  const [artOnly, setArtOnly] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const autoTimer = useRef<number | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setSavedAt(latestSave(isStudioPreview,projectNamespace)?.savedAt ?? null);
  }, [isStudioPreview,projectNamespace]);

  useEffect(() => { document.title = `${vnScript.title} — VN Maker`; }, [vnScript.title]);
  useEffect(() => {
    if (!saveFeedback) return;
    const timer = window.setTimeout(() => setSaveFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveFeedback]);

  const scene = currentScene(vnScript, state);
  const line = currentLine(vnScript, state);
  const text = line?.text ?? "";
  const { shown, typing, finish } = useTypewriter(text, state.phase === "scene" ? settings.textSpeed : 0);

  useEffect(() => {
    window.__vn = {
      sceneId: state.sceneId,
      lineIndex: state.lineIndex,
      affection: state.affection,
      typing,
      phase: state.phase,
      error: state.error,
      lastDiff: null,
      flags: state.flags,
    };
  }, [state, typing]);

  const snapshot = useCallback((): SlotSave => ({ sceneId:state.sceneId,lineIndex:state.lineIndex,affection:state.affection,flags:state.flags,phase:state.phase,history:state.history,savedAt:Date.now(),script:vnScript,preview:line?.text ?? "",chapter:scene?.chapter ?? null,thumbnail:scene ? cgAt(scene,state.lineIndex,state.flags) ?? backgroundAt(scene,state.lineIndex,state.flags) ?? `/assets/bg/${scene.background}.png` : null }),[state,vnScript,line,scene]);
  const checkpoint = useRef({ state, snapshot });
  checkpoint.current = { state, snapshot };
  useEffect(() => {
    if (state.phase === "title" || state.error) return;
    const data = snapshot();
    if (writeAutoSlot(data,saveScope)) setSavedAt(data.savedAt);
    else setSaveFeedback("자동 저장하지 못했습니다. 저장 공간을 확보한 뒤 다시 저장해 주세요.");
  }, [state,snapshot,saveScope]);
  useEffect(() => {
    const flush = () => { const current=checkpoint.current; if(current.state.phase!=="title" && !current.state.error) writeAutoSlot(current.snapshot(),saveScope); };
    const visibility = () => { if(document.visibilityState==="hidden") flush(); };
    window.addEventListener("pagehide",flush); document.addEventListener("visibilitychange",visibility);
    return () => { window.removeEventListener("pagehide",flush); document.removeEventListener("visibilitychange",visibility); };
  }, [saveScope]);

  const sfxVolumeRef=useRef(settings.sfxVolume);
  sfxVolumeRef.current=settings.sfxVolume;
  useEffect(() => {
    if (state.phase !== "scene" || !line?.sfx || !unlocked) return;
    playSfx(line.sfx, sfxVolumeRef.current);
  }, [state.phase, state.sceneId, state.lineIndex, line?.sfx, unlocked]);

  const advance = useCallback(() => {
    if (typing) {
      finish();
      return;
    }
    dispatch({ type: "advance" });
  }, [typing, finish]);

  useEffect(() => {
    if (!auto || artOnly || state.phase !== "scene" || typing || panel !== "none" || (line?.voice && voiceDone!==`${state.sceneEpoch}:${state.lineIndex}`)) return;
    const delay = 700 + text.length * 45;
    autoTimer.current = window.setTimeout(() => dispatch({ type: "advance" }), delay);
    return () => {
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    };
  }, [auto, artOnly, state.phase, state.sceneId, state.sceneEpoch, state.lineIndex, typing, text.length, panel,line?.voice,voiceDone]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        setArtOnly(false);
        setPanel("none");
        return;
      }
      if (state.phase !== "scene" || panel !== "none") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.closest('button, a, input, textarea, select, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="slider"], [role="textbox"]')) return;
      if (event.key.toLowerCase() === "h" && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); setArtOnly(value=>!value); return; }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (artOnly) setArtOnly(false); else advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, state.phase, panel, artOnly]);

  const unlock = useCallback(() => setUnlocked(true), []);
  useEffect(()=>{window.addEventListener("pointerdown",unlock,{once:true});window.addEventListener("keydown",unlock,{once:true});return()=>{window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};},[unlock]);
  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    writeSettings(next);
  }, []);

  const bootScript = useCallback((next: VnScript) => {
    scriptRef.current = next;
    setVnScript(next);
    dispatch({ type: "start" });
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("vnmaker.previewScript");
      if (!raw || !isStudioPreview) return;
      const parsed = parseScript(JSON.parse(raw));
      bootScript(parsed);
      const position = JSON.parse(sessionStorage.getItem("vnmaker.previewPosition") ?? "null") as { sceneId?: string; lineIndex?: number; flags?: VnState["flags"] } | null;
      const previewScene = parsed.scenes.find(row => row.id === position?.sceneId);
      if (previewScene && typeof position?.lineIndex === "number") {
        dispatch({ type: "restore", sceneId: previewScene.id, lineIndex: Math.max(0, Math.min(position.lineIndex, previewScene.lines.length - 1)), affection: 0, ...(position.flags ? {flags:position.flags} : {}) });
      }
    } catch {
      // 깨진 미리보기 JSON 은 무시한다.
    }
  }, [bootScript, isStudioPreview]);

  const backToTitle = useCallback(() => {
    scriptRef.current = script;
    setVnScript(script);
    dispatch({ type: "backToTitle" });
  }, []);

  const nameOf = useCallback(
    (speaker: string | null) => {
      if (speaker === null) return null;
      return speakerName(vnScript, speaker as never);
    },
    [vnScript],
  );

  const bgmTrack = useMemo(() => {
    if (state.phase === "title") return "main-theme";
    return scene ? bgmAt(scene,state.lineIndex,state.flags) : null;
  }, [state.phase,state.lineIndex,state.flags,scene]);

  const onSave = useCallback(() => {
    const data = snapshot();
    const saved = writeSave(data,isStudioPreview,projectNamespace);
    if (saved) setSavedAt(data.savedAt);
    setSaveFeedback(saved ? "작품과 플레이 위치를 저장했습니다." : "저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.");
    playSfx("ui-click", settings.sfxVolume);
    setPanel("save");
  }, [snapshot,settings.sfxVolume,isStudioPreview,projectNamespace]);

  const restoreSave = useCallback((save: SaveData | null) => {
    if (!save) return;
    const savedScript = save.script ?? [vnScript, script].find(candidate => candidate.scenes.some(row => row.id === save.sceneId)) ?? script;
    setSaveFeedback(manuscriptKey(savedScript)!==manuscriptKey(vnScript)?"저장 당시의 원고로 이어갑니다. 현재 원고의 수정 내용은 반영되지 않습니다.":null);
    scriptRef.current = savedScript;
    setVnScript(savedScript);
    dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection, ...(save.flags?{flags:save.flags}:{}), ...(save.phase?{phase:save.phase}:{}), ...(save.history?{history:save.history}:{}) });
    setPanel("none"); unlock();
  }, [vnScript,script,unlock]);
  const onLoad = () => restoreSave(latestSave(isStudioPreview,projectNamespace));
  const saveDialog = (panel === "save" || panel === "load") && <SlotPicker currentScript={vnScript} mode={panel} error={saveFeedback?.includes("못했") ? saveFeedback : null} slots={listSlots(saveScope)} autoSlot={readAutoSlot(saveScope)} onClose={()=>setPanel("none")} onPickAuto={()=>restoreSave(readAutoSlot(saveScope))} onPick={slot=>{
    if(panel==="load") {restoreSave(readSlot(slot,saveScope));return;}
    const data=snapshot();
    if(writeSlot(slot,data,saveScope)){setSavedAt(data.savedAt);setSaveFeedback(`슬롯 ${slot+1}에 작품과 선택 기록을 저장했습니다.`);setPanel("none");}
    else setSaveFeedback("슬롯에 저장하지 못했습니다. 기존 저장은 유지됩니다.");
  }}/>;

  const creditsDialog = panel === "credits" && <CreditsPanel script={vnScript} standalone={standalone} onClose={() => setPanel("none")} />;

  if (state.error !== null) {
    return (
      <main className="vn-root">
        <p className="fatal" data-testid="fatal">
          {state.error}
        </p>
      </main>
    );
  }

  if (state.phase === "title") {
    return (
      <main className="vn-root" onClick={unlock}>
        <PaperTexture />
        <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
        <TitleScreen onCredits={()=>setPanel("credits")} script={script} standalone={standalone} hasSave={savedAt !== null} onLoad={()=>setPanel("load")} onStart={() => { unlock(); playSfx("ui-click", settings.sfxVolume); bootScript(script); }} onContinue={() => { unlock(); onLoad(); }} />
        {saveDialog}{creditsDialog}
        <div className="grain-overlay" aria-hidden="true" />
      </main>
    );
  }

  if (state.phase === "ending") {
    return (
      <main className="vn-root">
        {isStudioPreview && <a className="studio-return" href="/studio.html">← 스튜디오로 돌아가기</a>}
        <PaperTexture />
        <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
        {creditsDialog}
        <EndingScreen
          title={state.endingTitle ?? "END"}
          affection={state.affection}
          background={scene?.background ?? "title"}
          backgroundUrl={scene ? backgroundAt(scene, scene.lines.length - 1,state.flags) : undefined}
          cgUrl={scene ? cgAt(scene, scene.lines.length - 1,state.flags) : undefined}
          showAffection={vnScript.scenes.some(row => row.choices?.some(choice => choice.affection !== undefined))}
          onCredits={()=>setPanel("credits")}
          onBack={backToTitle}
        />
        <div className="grain-overlay" aria-hidden="true" />
      </main>
    );
  }

  if (!scene) {
    return (
      <main className="vn-root">
        <p className="fatal">{state.error ?? "씬을 찾을 수 없다"}</p>
      </main>
    );
  }

  const speaking = line?.speaker ?? null;

  return (
    <main className="vn-root">
      {isStudioPreview && <a className="studio-return" href="/studio.html" data-testid="studio-return">← 스튜디오로 돌아가기</a>}
      {saveFeedback && <p className="player-save-notice" role="status">{saveFeedback}</p>}
      <PaperTexture />
      <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} /><VoicePlayer source={state.phase==="scene"?line?.voice:undefined} cue={`${state.sceneEpoch}:${state.lineIndex}`} volume={settings.voiceVolume??0.8} paused={panel!=="none"} unlocked={unlocked} onDone={setVoiceDone}/>
      <section
        className={`stage ${line?.shake ? "is-shaking" : ""} ${state.phase === "choice" ? "is-choice" : ""}`}
        data-testid="stage"
        data-scene={scene.id}
      >
        <Stage
          background={scene.background}
          backgroundUrl={backgroundAt(scene, state.lineIndex,state.flags)}
          cgUrl={cgAt(scene, state.lineIndex,state.flags)}
          hideSprites={scene.hideSprites}
          framing={framingAt(scene,state.lineIndex,state.flags)}
          characters={vnScript.characters}
          sprites={spritesAt(scene, state.lineIndex,state.flags)}
          speaking={speaking}
          chapter={scene.chapter ?? null}
          sceneEpoch={state.sceneEpoch}
          transition={scene.transition ?? "fade"}
        />
        <button
          type="button"
          className="click-layer"
          data-testid="advance-button"
          aria-label="다음"
          onClick={() => {
            unlock();
            if (artOnly) { setArtOnly(false); return; }
            if (panel !== "none") {
              setPanel("none");
              return;
            }
            if (state.phase === "scene") advance();
          }}
          onKeyDown={event => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
        />
        {!artOnly && <Toolbar
          auto={auto}
          canLoad={savedAt !== null}
          onSave={onSave}
          onLoad={()=>setPanel("load")}
          onAuto={() => setAuto((v) => !v)}
          onSkip={() => dispatch({ type: "skipScene" })}
          onHistory={() => setPanel((p) => (p === "history" ? "none" : "history"))}
          onSettings={() => setPanel((p) => (p === "settings" ? "none" : "settings"))}
        />}
        {state.phase === "scene" && <button type="button" className="art-view-button" data-testid="art-view-button" aria-pressed={artOnly} onClick={()=>setArtOnly(!artOnly)}>{artOnly ? "대사 표시 · H" : "원화 감상 · H"}</button>}
        {state.phase === "scene" && !artOnly && (
          <DialogueBox
            speaker={nameOf(speaking)}
            color={speakerColor(vnScript, speaking as never)}
            text={shown}
            typing={typing}
          />
        )}
        {state.phase === "choice" && scene.choices && (
          <ChoiceMenu
            flags={state.flags}
            choices={scene.choices}
            onPick={(index) => {
              playSfx("ui-click", settings.sfxVolume);
              dispatch({ type: "choose", index });
            }}
            onHover={() => playSfx("ui-hover", settings.sfxVolume * 0.5)}
          />
        )}
        {panel === "history" && (
          <HistoryPanel entries={state.history} nameOf={nameOf} colorOf={(speaker) => speakerColor(vnScript, speaker as never)} onClose={() => setPanel("none")} />
        )}
        {panel === "settings" && (
          <SettingsPanel onCredits={()=>setPanel("credits")} settings={settings} onChange={updateSettings} onClose={() => setPanel("none")} />
        )}
      </section>
      {saveDialog}{creditsDialog}
      <div className="grain-overlay" aria-hidden="true" />
    </main>
  );
}
