import { script } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { fetchAuthStatus, startLogin, type AuthStatus } from "./api/gateway.js";
import { BgmPlayer } from "./audio/BgmPlayer.js";
import { playSfx } from "./audio/sfx.js";
import { ChoiceMenu } from "./components/ChoiceMenu.js";
import { DialogueBox } from "./components/DialogueBox.js";
import { EndingScreen } from "./components/EndingScreen.js";
import { HistoryPanel, SettingsPanel, SlotPicker, type BacklogEntry } from "./components/Panels.js";
import { PaperTexture } from "./components/PaperTexture.js";
import { Stage } from "./components/Stage.js";
import { Toolbar } from "./components/Toolbar.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { reduce } from "./engine/reducer.js";
import { currentLine, currentScene, speakerColor, speakerName, spritesAt } from "./engine/selectors.js";
import { initialState, type SaveData, type VnAction, type VnState } from "./engine/types.js";
import { useTypewriter } from "./hooks/useTypewriter.js";
import { defaultSettings, formatSlotDate, listSlots, loadSettings, migrateLegacySave, readAutoSlot, readSlot, writeAutoSlot, writeSettings, writeSlot, type Settings, type SlotSave } from "./storage/persist.js";

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

type Panel = "none" | "history" | "settings" | "save" | "load";

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
  const [slots, setSlots] = useState<readonly (SlotSave | null)[]>([]);
  const [autoSlot, setAutoSlot] = useState<SlotSave | null>(null);
  const [auth, setAuth] = useState<AuthStatus>(offlineAuth);
  const [connectBusy, setConnectBusy] = useState(false);
  const [helloError, setHelloError] = useState<string | null>(null);
  const autoTimer = useRef<number | null>(null);

  const refreshSlots = useCallback(() => {
    setSlots(listSlots());
    setAutoSlot(readAutoSlot());
  }, []);

  useEffect(() => {
    setSettings(loadSettings());
    migrateLegacySave();
    refreshSlots();
    void fetchAuthStatus().then(setAuth);
  }, [refreshSlots]);

  const [hideUi, setHideUi] = useState(false);
  const [skipping, setSkipping] = useState(false);

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
    // 글자 속도 설정이 빠를수록 대기열도 짧아진다. 느리게 읽는 설정이면 더 오래 머문다.
    const delay = 900 + text.length * (18 + settings.textSpeed);
    autoTimer.current = window.setTimeout(() => dispatch({ type: "advance" }), delay);
    return () => {
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    };
  }, [auto, state.phase, state.sceneId, state.lineIndex, typing, text.length, settings.textSpeed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPanel("none");
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "h" || event.key === "H") {
        event.preventDefault();
        setHideUi((v) => !v);
        return;
      }
      if (state.phase === "choice") {
        if (event.key === "1" || event.key === "2" || event.key === "3") {
          const index = Number(event.key) - 1;
          const choice = scene?.choices?.[index];
          if (choice && choice.disable !== true) {
            playSfx("ui-click", settings.sfxVolume);
            dispatch({ type: "choose", index });
          }
        }
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
  }, [advance, state.phase, scene, settings.sfxVolume]);

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

  const snapshot = useCallback((): SlotSave => {
    const current = currentScene(vnScript, state);
    const shown = state.history.length > 0 ? state.history[state.history.length - 1]?.text ?? "" : "";
    const data: SaveData = {
      sceneId: state.sceneId,
      lineIndex: state.lineIndex,
      affection: state.affection,
      savedAt: Date.now(),
    };
    return {
      ...data,
      preview: shown.slice(0, 80),
      chapter: current?.chapter ?? null,
      thumbnail: current?.background ?? null,
    };
  }, [vnScript, state]);

  const restoreSave = useCallback((save: SaveData) => {
    scriptRef.current = script;
    setVnScript(script);
    dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection });
  }, []);

  const onSaveSlot = useCallback((index: number) => {
    writeSlot(index, snapshot());
    refreshSlots();
    setPanel("none");
    playSfx("ui-click", settings.sfxVolume);
  }, [snapshot, refreshSlots, settings.sfxVolume]);

  const onLoadSlot = useCallback((save: SaveData | null) => {
    if (!save) return;
    restoreSave(save);
    setPanel("none");
    playSfx("ui-click", settings.sfxVolume);
  }, [restoreSave, settings.sfxVolume]);

  const onSkip = useCallback(() => {
    // 씬 스킵 직후 잠깐 SKIP 뱃지를 보여준다. 다음 줄이 스킵 모드를 유지하지는 않는다.
    setSkipping(true);
    dispatch({ type: "skipScene" });
    window.setTimeout(() => setSkipping(false), 1500);
  }, []);

  const pickChoice = useCallback(
    (index: number) => {
      const choice = currentScene(scriptRef.current, state)?.choices?.[index];
      if (!choice || choice.disable === true) return;
      // 선택지 진입 시점이 곧 분기 직전이므로 자동 슬롯에 스냅샷을 남긴다.
      writeAutoSlot(snapshot());
      refreshSlots();
      playSfx("ui-click", settings.sfxVolume);
      dispatch({ type: "choose", index });
    },
    [state, settings.sfxVolume, snapshot, refreshSlots],
  );

  const nameOf = useCallback(
    (speaker: string | null) => {
      if (speaker === null) return null;
      return speakerName(vnScript, speaker as never);
    },
    [vnScript],
  );

  const colorOf = useCallback(
    (speaker: string | null) => speakerColor(vnScript, speaker as never),
    [vnScript],
  );

  const bgmTrack = useMemo(() => {
    if (state.phase === "title") return "main-theme";
    return scene?.bgm ?? null;
  }, [state.phase, scene?.bgm]);

  const continueTarget: SlotSave | null = useMemo(() => {
    const manual = slots.filter((s): s is SlotSave => s !== null);
    const newestManual = manual.length > 0
      ? manual.reduce((a, b) => (a.savedAt >= b.savedAt ? a : b))
      : null;
    if (newestManual !== null && autoSlot !== null) {
      return autoSlot.savedAt >= newestManual.savedAt ? autoSlot : newestManual;
    }
    return newestManual ?? autoSlot;
  }, [slots, autoSlot]);

  const continueSummary: string | null = useMemo(() => {
    if (!continueTarget) return null;
    const head = continueTarget.chapter ?? continueTarget.sceneId;
    const tail = continueTarget.preview === "" ? "저장된 기록에서 이어한다" : continueTarget.preview;
    return `${head} · ${formatSlotDate(continueTarget.savedAt)} · ${tail}`;
  }, [continueTarget]);

  // 엔딩에 처음 도달하면 자동 슬롯에 스냅샷을 남긴다.
  const endingSeen = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== "ending") return;
    const key = `${state.sceneId}:${state.endingTitle ?? ""}`;
    if (endingSeen.current === key) return;
    endingSeen.current = key;
    writeAutoSlot(snapshot());
    refreshSlots();
  }, [state.phase, state.sceneId, state.endingTitle, snapshot, refreshSlots]);

  const backlogEntries: readonly BacklogEntry[] = useMemo(() => {
    // 장 라벨은 현재 씬 기준으로만 붙인다. 엔진 기록에는 장 정보가 없다.
    const chapter = scene?.chapter ?? null;
    return state.history.map((entry) => ({ ...entry, chapter }));
  }, [state.history, scene?.chapter]);

  const routeFlagsLine = useMemo(() => {
    const flags = [`호감도 ${state.affection}`];
    return flags.join(" · ");
  }, [state.affection]);

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
          hasSave={continueTarget !== null}
          continueSummary={continueSummary}
          auth={auth}
          connectBusy={connectBusy}
          helloError={helloError}
          onConnect={() => {
            unlock();
            void onConnect();
          }}
          onStart={() => {
            unlock();
            playSfx("ui-click", settings.sfxVolume);
            bootScript(script);
          }}
          onContinue={() => {
            unlock();
            if (!continueTarget) return;
            playSfx("ui-click", settings.sfxVolume);
            restoreSave(continueTarget);
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
          routeFlags={routeFlagsLine}
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

  const cgHidden = line?.cgHide === true;
  const cg = scene?.cg ?? null;
  const hidden = hideUi && panel === "none";

  return (
    <main className={`vn-root${hideUi ? " is-ui-hidden" : ""}${auto ? " is-auto" : ""}${skipping ? " is-skipping" : ""}`}>
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
          speaking={speaking}
          chapter={scene.chapter ?? null}
          sceneEpoch={state.sceneEpoch}
          transition={scene.transition ?? "fade"}
          cg={cg}
          cgHidden={cgHidden}
        />
        <div
          className="click-layer"
          data-testid="advance-button"
          role="button"
          tabIndex={0}
          aria-label="다음"
          onClick={() => {
            unlock();
            // H 숨김 모드에서는 클릭이 UI 를 다시 보여준다. 진행은 하지 않는다.
            if (hidden) {
              setHideUi(false);
              return;
            }
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
          canLoad={continueTarget !== null}
          onSave={() => setPanel((p) => (p === "save" ? "none" : "save"))}
          onLoad={() => setPanel((p) => (p === "load" ? "none" : "load"))}
          onAuto={() => setAuto((v) => !v)}
          onSkip={onSkip}
          onHistory={() => setPanel((p) => (p === "history" ? "none" : "history"))}
          onSettings={() => setPanel((p) => (p === "settings" ? "none" : "settings"))}
        />
        {!hidden && state.phase === "scene" && (
          <DialogueBox
            speaker={nameOf(speaking)}
            color={speakerColor(vnScript, speaking as never)}
            text={shown}
            typing={typing}
            auto={auto}
            skipping={skipping}
            onAdvance={() => {
              unlock();
              if (state.phase === "scene") advance();
            }}
          />
        )}
        {state.phase === "choice" && scene.choices && (
          <ChoiceMenu
            choices={scene.choices}
            onPick={pickChoice}
            onHover={() => playSfx("ui-hover", settings.sfxVolume * 0.5)}
          />
        )}
        {panel === "history" && (
          <HistoryPanel entries={backlogEntries} nameOf={nameOf} colorOf={colorOf} onClose={() => setPanel("none")} />
        )}
        {panel === "settings" && (
          <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setPanel("none")} />
        )}
        {panel === "save" && (
          <SlotPicker mode="save" slots={slots} autoSlot={autoSlot} onPick={onSaveSlot} onPickAuto={() => setPanel("none")} onClose={() => setPanel("none")} />
        )}
        {panel === "load" && (
          <SlotPicker mode="load" slots={slots} autoSlot={autoSlot} onPick={(index) => onLoadSlot(readSlot(index))} onPickAuto={() => onLoadSlot(readAutoSlot())} onClose={() => setPanel("none")} />
        )}
      </section>
      <div className="grain-overlay" aria-hidden="true" />
    </main>
  );
}
