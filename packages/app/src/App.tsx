import { script } from "@vnmaker/content";
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
import { currentLine, currentScene, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
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

const offlineAuth: AuthStatus = {
  reachable: false,
  authenticated: false,
  email: null,
  projectId: null,
  error: null,
};

export function App() {
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
  const [auth, setAuth] = useState<AuthStatus>(offlineAuth);
  const [connectBusy, setConnectBusy] = useState(false);
  const [helloBusy, setHelloBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [helloError, setHelloError] = useState<string | null>(null);
  const [agentDiffs, setAgentDiffs] = useState<readonly AgentDiff[]>([]);
  const autoTimer = useRef<number | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
    setSavedAt(loadSave()?.savedAt ?? null);
    void fetchAuthStatus().then(setAuth);
  }, []);

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
      lastDiff: agentDiffs[0]?.summary ?? null,
    };
  }, [state, typing, agentDiffs]);

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

  const bootScript = useCallback((next: VnScript) => {
    scriptRef.current = next;
    setVnScript(next);
    dispatch({ type: "start" });
  }, []);

  const backToTitle = useCallback(() => {
    scriptRef.current = script;
    setVnScript(script);
    dispatch({ type: "backToTitle" });
  }, []);

  const onConnect = useCallback(async () => {
    setConnectBusy(true);
    setHelloError(null);
    try {
      const next = await startLogin();
      setAuth(next);
    } catch (err) {
      setHelloError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectBusy(false);
    }
  }, []);

  const onHello = useCallback(async () => {
    setHelloBusy(true);
    setHelloError(null);
    try {
      const result = await generateLine();
      await saveNode(helloNode(result.text));
      unlock();
      bootScript(helloScript(result.text));
    } catch (err) {
      setHelloError(err instanceof Error ? err.message : String(err));
    } finally {
      setHelloBusy(false);
    }
  }, [bootScript, unlock]);

  const onAgent = useCallback(
    async (message: string) => {
      setAgentBusy(true);
      setHelloError(null);
      try {
        const result = await runAgent(message, "hello");
        if (result.node === null) throw new Error("에이전트가 노드를 안 남겼다");
        setAgentDiffs(result.diffs);
        unlock();
        bootScript(scriptFromNode(result.node));
      } catch (err) {
        setHelloError(err instanceof Error ? err.message : String(err));
      } finally {
        setAgentBusy(false);
      }
    },
    [bootScript, unlock],
  );

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
    writeSave({ sceneId: state.sceneId, lineIndex: state.lineIndex, affection: state.affection, savedAt: now });
    setSavedAt(now);
    playSfx("ui-click", settings.sfxVolume);
  }, [state.sceneId, state.lineIndex, state.affection, settings.sfxVolume]);

  const onLoad = useCallback(() => {
    const save = loadSave();
    if (!save) return;
    scriptRef.current = script;
    setVnScript(script);
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
          title={vnScript.title}
          subtitle={vnScript.subtitle}
          hasSave={savedAt !== null}
          auth={auth}
          connectBusy={connectBusy}
          helloBusy={helloBusy}
          agentBusy={agentBusy}
          helloError={helloError}
          onConnect={() => {
            unlock();
            void onConnect();
          }}
          onHello={() => {
            unlock();
            playSfx("ui-click", settings.sfxVolume);
            void onHello();
          }}
          onAgent={(message) => {
            unlock();
            playSfx("ui-click", settings.sfxVolume);
            void onAgent(message);
          }}
          onStart={() => {
            unlock();
            playSfx("ui-click", settings.sfxVolume);
            bootScript(script);
          }}
          onContinue={() => {
            unlock();
            const save = loadSave();
            if (!save) return;
            scriptRef.current = script;
            setVnScript(script);
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
        {agentDiffs.length > 0 && (
          <p className="agent-diff" data-testid="agent-diff">
            {agentDiffs.map((diff) => diff.summary).join(" · ")}
          </p>
        )}
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
