import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { script } from "@vnmaker/content";
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
import { currentLine, currentScene, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { initialState, type VnAction, type VnState } from "./engine/types.js";
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
    };
  }
}

type Panel = "none" | "history" | "settings";

export function App() {
  const [state, dispatch] = useReducer(
    (s: VnState, a: VnAction) => reduce(script, s, a),
    script,
    initialState,
  );
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [panel, setPanel] = useState<Panel>("none");
  const [auto, setAuto] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const autoTimer = useRef<number | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setSavedAt(loadSave()?.savedAt ?? null);
  }, []);

  const scene = currentScene(script, state);
  const line = currentLine(script, state);
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
      if (state.phase !== "scene") return;
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance, state.phase]);

  const unlock = useCallback(() => setUnlocked(true), []);
  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    writeSettings(next);
  }, []);

  const nameOf = useCallback((speaker: string | null) => {
    if (speaker === null) return null;
    return speakerName(script, speaker as never);
  }, []);

  const bgmTrack = useMemo(() => {
    if (state.phase === "title") return "main-theme";
    return scene?.bgm ?? null;
  }, [state.phase, scene?.bgm]);

  const onSave = useCallback(() => {
    const now = Date.now();
    writeSave({ sceneId: state.sceneId, lineIndex: state.lineIndex, affection: state.affection, savedAt: now });
    setSavedAt(now);
    playSfx("ui-click", settings.sfxVolume);
  }, [state.sceneId, state.lineIndex, state.affection, settings.sfxVolume]);

  const onLoad = useCallback(() => {
    const save = loadSave();
    if (!save) return;
    dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection });
  }, []);

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
        <TitleScreen
          title={script.title}
          subtitle={script.subtitle}
          hasSave={savedAt !== null}
          onStart={() => {
            unlock();
            playSfx("ui-click", settings.sfxVolume);
            dispatch({ type: "start" });
          }}
          onContinue={() => {
            unlock();
            const save = loadSave();
            if (!save) return;
            dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection });
          }}
        />
        <div className="grain-overlay" aria-hidden="true" />
      </main>
    );
  }

  if (state.phase === "ending") {
    return (
      <main className="vn-root">
        <PaperTexture />
        <BgmPlayer track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
        <EndingScreen
          title={state.endingTitle ?? "END"}
          affection={state.affection}
          onBack={() => dispatch({ type: "backToTitle" })}
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
      <PaperTexture />
      <BgmPlayer track={bgmTrack} volume={settings.bgmVolume} unlocked={unlocked} />
      <section
        className={`stage ${line?.shake ? "is-shaking" : ""}`}
        data-testid="stage"
        data-scene={scene.id}
      >
        <Stage
          background={scene.background}
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
            color={speakerColor(script, speaking as never)}
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
          <HistoryPanel entries={state.history} nameOf={nameOf} onClose={() => setPanel("none")} />
        )}
        {panel === "settings" && (
          <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setPanel("none")} />
        )}
      </section>
      <div className="grain-overlay" aria-hidden="true" />
    </main>
  );
}
