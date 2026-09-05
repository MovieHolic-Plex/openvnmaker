import { parseScript, script } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { helloNode } from "@vnmaker/ir";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchAuthStatus, generateLine, runAgent, saveNode, startLogin, type AgentDiff, type AuthStatus } from "./api/gateway.js";
import { BgmPlayer } from "./audio/BgmPlayer.js";
import { playSfx } from "./audio/sfx.js";
import { ChoiceMenu } from "./components/ChoiceMenu.js";
import { DialogueBox } from "./components/DialogueBox.js";
import { EndingScreen } from "./components/EndingScreen.js";
import { HistoryPanel, SettingsPanel } from "./components/Panels.js";
import { PaperTexture } from "./components/PaperTexture.js";
import { Stage } from "./components/Stage.js";
import { Toolbar } from "./components/Toolbar.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { reduce } from "./engine/reducer.js";
import { currentLine, currentScene, backgroundAt, cgAt, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { initialState, type VnAction, type VnState } from "./engine/types.js";
import { helloScript, scriptFromNode } from "./helloScript.js";
import { useTypewriter } from "./hooks/useTypewriter.js";
import { defaultSettings, loadSave, loadSettings, writeSave, writeSettings, type Settings } from "./storage/persist.js";

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
    };
  }
}

type Panel = "none" | "history" | "settings";

export function App() {
  const isStudioPreview = new URLSearchParams(window.location.search).get("preview") === "1";
  const scriptRef = useRef<VnScript>(script);
  const [vnScript, setVnScript] = useState<VnScript>(script);
  const [state, dispatch] = useReducer(
    (s: VnState, a: VnAction) => reduce(scriptRef.current, s, a),
    script,
    initialState,
  );
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [panel, setPanel] = useState<Panel>("none");
  const [auto, setAuto] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const autoTimer = useRef<number | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setSavedAt(loadSave(isStudioPreview)?.savedAt ?? null);
  }, [isStudioPreview]);

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
    };
  }, [state, typing]);

  useEffect(() => {
    if (state.phase !== "scene" || !line?.sfx || !unlocked) return;
    playSfx(line.sfx, settings.sfxVolume);
  }, [state.phase, state.sceneId, state.lineIndex, line?.sfx, settings.sfxVolume, unlocked]);

  const advance = useCallback(() => {
    if (typing) {
      finish();
      return;
    }
    dispatch({ type: "advance" });
  }, [typing, finish]);

  useEffect(() => {
    if (!auto || state.phase !== "scene" || typing) return;
    const delay = 700 + text.length * 45;
    autoTimer.current = window.setTimeout(() => dispatch({ type: "advance" }), delay);
    return () => {
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    };
  }, [auto, state.phase, state.sceneId, state.lineIndex, typing, text.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel("none");
        return;
      }
      if (state.phase !== "scene" || panel !== "none") return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, state.phase, panel]);

  const unlock = useCallback(() => setUnlocked(true), []);
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
      const position = JSON.parse(sessionStorage.getItem("vnmaker.previewPosition") ?? "null") as { sceneId?: string; lineIndex?: number } | null;
      const previewScene = parsed.scenes.find(row => row.id === position?.sceneId);
      if (previewScene && typeof position?.lineIndex === "number") {
        dispatch({ type: "restore", sceneId: previewScene.id, lineIndex: Math.max(0, Math.min(position.lineIndex, previewScene.lines.length - 1)), affection: 0 });
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
    return scene?.bgm ?? null;
  }, [state.phase, scene?.bgm]);

  const onSave = useCallback(() => {
    const now = Date.now();
    const saved = writeSave({ sceneId: state.sceneId, lineIndex: state.lineIndex, affection: state.affection, savedAt: now, script: vnScript }, isStudioPreview);
    if (saved) setSavedAt(now);
    setSaveFeedback(saved ? "작품과 플레이 위치를 저장했습니다." : "저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.");
    playSfx("ui-click", settings.sfxVolume);
  }, [state.sceneId, state.lineIndex, state.affection, settings.sfxVolume, vnScript, isStudioPreview]);

  const onLoad = useCallback(() => {
    const save = loadSave(isStudioPreview);
    if (!save) return;
    const savedScript = save.script ?? [vnScript, script].find(candidate => candidate.scenes.some(row => row.id === save.sceneId)) ?? script;
    scriptRef.current = savedScript;
    setVnScript(savedScript);
    dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection });
  }, [isStudioPreview, vnScript]);

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
        <BgmPlayer track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
        <TitleScreen title={script.title} subtitle={script.subtitle} hasSave={savedAt !== null} onStart={() => { unlock(); playSfx("ui-click", settings.sfxVolume); bootScript(script); }} onContinue={() => { unlock(); onLoad(); }} />
        <div className="grain-overlay" aria-hidden="true" />
      </main>
    );
  }

  if (state.phase === "ending") {
    return (
      <main className="vn-root">
        {isStudioPreview && <a className="studio-return" href="/studio.html">← 스튜디오로 돌아가기</a>}
        <PaperTexture />
        <BgmPlayer track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
        <EndingScreen
          title={state.endingTitle ?? "END"}
          affection={state.affection}
          background={scene?.background ?? "title"}
          backgroundUrl={scene ? backgroundAt(scene, scene.lines.length - 1) : undefined}
          cgUrl={scene ? cgAt(scene, scene.lines.length - 1) : undefined}
          showAffection={vnScript.scenes.some(row => row.choices?.some(choice => choice.affection !== undefined))}
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
      <BgmPlayer track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
      <section
        className={`stage ${line?.shake ? "is-shaking" : ""} ${state.phase === "choice" ? "is-choice" : ""}`}
        data-testid="stage"
        data-scene={scene.id}
      >
        <Stage
          background={scene.background}
          backgroundUrl={backgroundAt(scene, state.lineIndex)}
          cgUrl={cgAt(scene, state.lineIndex)}
          hideSprites={scene.hideSprites}
          framing={scene.framing}
          characters={vnScript.characters}
          sprites={spritesAt(scene, state.lineIndex)}
          speaking={speaking === "me" ? null : speaking}
          chapter={scene.chapter ?? null}
          sceneEpoch={state.sceneEpoch}
          transition={scene.transition ?? "fade"}
        />
        <div
          className="click-layer"
          data-testid="advance-button"
          role="button"
          tabIndex={0}
          aria-label="다음"
          onClick={() => {
            unlock();
            if (panel !== "none") {
              setPanel("none");
              return;
            }
            if (state.phase === "scene") advance();
          }}
          onKeyDown={() => undefined}
        />
        <Toolbar
          auto={auto}
          canLoad={savedAt !== null}
          onSave={onSave}
          onLoad={onLoad}
          onAuto={() => setAuto((v) => !v)}
          onSkip={() => dispatch({ type: "skipScene" })}
          onHistory={() => setPanel((p) => (p === "history" ? "none" : "history"))}
          onSettings={() => setPanel((p) => (p === "settings" ? "none" : "settings"))}
        />
        {state.phase === "scene" && (
          <DialogueBox
            speaker={nameOf(speaking)}
            color={speakerColor(vnScript, speaking as never)}
            text={shown}
            typing={typing}
          />
        )}
        {state.phase === "choice" && scene.choices && (
          <ChoiceMenu
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
          <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setPanel("none")} />
        )}
      </section>
      <div className="grain-overlay" aria-hidden="true" />
    </main>
  );
}
