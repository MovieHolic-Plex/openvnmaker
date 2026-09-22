import {manuscriptKey} from "./storage/manuscriptKey.js";
import { lineAllowed, parseScript, script as bundledScript } from "@vnmaker/content";
import type { VnScript } from "@vnmaker/content";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BgmPlayer } from "./audio/BgmPlayer.js";
import { VoicePlayer } from "./audio/VoicePlayer.js";
import { playSfx } from "./audio/sfx.js";
import { ChoiceMenu } from "./components/ChoiceMenu.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { DialogueBox } from "./components/DialogueBox.js";
import { EndingScreen } from "./components/EndingScreen.js";
import { GalleryPanel, HistoryPanel, SettingsPanel, SlotPicker } from "./components/Panels.js";
import { LineInputPanel } from "./components/LineInput.js";
import { PaperTexture } from "./components/PaperTexture.js";
import { Stage } from "./components/Stage.js";
import { Toolbar } from "./components/Toolbar.js";
import { CreditsPanel } from "./components/CreditsPanel.js";
import { TitleScreen } from "./components/TitleScreen.js";
import { autoAdvanceDelay, typewriterMsPerChar } from "./engine/pacing.js";
import { reduce, rollbackLog } from "./engine/reducer.js";
import { resolveInline, resolveText, truncateParts } from "./engine/inlineText.js";
import { currentLine, currentScene, backgroundAt, bgmAt, cgAt, effectAt, framingAt, speakerColor, speakerName, spritesAt, tintAt } from "./engine/selectors.js";
import { initialState, readKey, ROLLBACK_LIMIT, type SaveData, type VnAction, type VnState } from "./engine/types.js";
import { useReducedMotion } from "./hooks/useReducedMotion.js";
import { useScenePrefetch } from "./hooks/useScenePrefetch.js";
import { useTypewriter } from "./hooks/useTypewriter.js";
import { defaultSettings, EMPTY_GALLERY, latestSave, listSlots, loadSettings, readAutoSlot, readGallery, readLineKeys, readQuickSlot, readSlot, reconcileFlags, rememberRead, unlockGalleryCg, unlockGalleryEnding, writeAutoSlot, writeQuickSlot, writeSave, writeSettings, writeSlot, type GalleryUnlocks, type Settings, type SlotSave } from "./storage/persist.js";

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
      /** 되돌릴 수 있는 과거 상태 수. 불러온 뒤 롤백 검증용. */
      pastLength: number;
      reducedMotion: boolean;
    };
  }
}

type Panel = "credits" | "gallery" | "none" | "history" | "settings" | "save" | "load" | "title-confirm";
/** Ctrl 을 이만큼 누르고 있으면 빨리 감기가 시작된다. 단축키 조합(Ctrl+Enter 등)은 이 시간 안에 끝난다. */
const HOLD_SKIP_DELAY_MS = 150;
const HOLD_SKIP_INTERVAL_MS = 80;
/** 읽은 대사 기록은 진행마다 쓰지 않고 잠시 모아 쓴다. */
const READ_FLUSH_MS = 1500;

export function App({ initialScript, standalone = false, projectNamespace = "" }: { initialScript?: VnScript; standalone?: boolean; projectNamespace?: string } = {}) {
  const script = initialScript ?? bundledScript;
  const isStudioPreview = !standalone && new URLSearchParams(window.location.search).get("preview") === "1";
  const saveScope = [projectNamespace,isStudioPreview ? "preview" : ""].filter(Boolean).join(":");
  // 독립 배포판은 게임마다 설정을 따로 둔다 — 같은 오리진의 다른 게임이 음량·속도를 덮어쓰지 않는다.
  const settingsScope = standalone ? projectNamespace : "";
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
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryUnlocks>(EMPTY_GALLERY);
  const [fullscreen, setFullscreen] = useState(false);
  /** 저장소 쓰기마다 증가 — 저장 창의 슬롯 목록을 다시 읽는 유일한 계기다. */
  const [saveRevision, setSaveRevision] = useState(0);
  const autoTimer = useRef<number | null>(null);
  const wheelAcc = useRef(0);
  const reducedMotion = useReducedMotion();
  const readKeys = useRef<Set<string>>(new Set());
  const unsavedRead = useRef<Set<string>>(new Set());
  const readFlush = useRef<number | null>(null);

  useEffect(() => {
    setSettings(loadSettings(settingsScope));
    setSavedAt(latestSave(isStudioPreview,projectNamespace)?.savedAt ?? null);
    setGallery(readGallery(saveScope));
    readKeys.current = readLineKeys(saveScope);
  }, [isStudioPreview,projectNamespace,saveScope,settingsScope]);

  useEffect(() => { document.title = `${vnScript.title} — VN Maker`; }, [vnScript.title]);
  useEffect(() => {
    if (!saveFeedback) return;
    const timer = window.setTimeout(() => setSaveFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [saveFeedback]);
  useEffect(() => {
    if (!mediaNotice) return;
    const timer = window.setTimeout(() => setMediaNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [mediaNotice]);
  useEffect(() => {
    if (typeof document.fullscreenEnabled !== "boolean") return;
    const update = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  const scene = currentScene(vnScript, state);
  const line = currentLine(vnScript, state);
  const text = line?.text ?? "";
  // 표기({c:…}, **…**)를 걷고 플래그를 풀어 쓴 뒤 타이프라이터를 돌린다 — 태그가 반쪽 타이핑되지 않게.
  const resolved = useMemo(() => resolveInline(text, state.flags), [text, state.flags]);
  const { shown, typing, finish } = useTypewriter(resolved.plain, state.phase === "scene" && !reducedMotion ? typewriterMsPerChar(resolved.plain.length, settings.textSpeed) : 0);
  useScenePrefetch(vnScript, scene, state.lineIndex, state.flags, state.phase === "scene" || state.phase === "choice");

  // 화면에 뜬 대사는 읽은 것으로 기억한다. 「읽은 텍스트만 스킵」의 근거이며 잠시 모아서 저장한다.
  useEffect(() => {
    if (state.phase !== "scene" || !scene || !line) return;
    const key = readKey(scene.id, state.lineIndex, line);
    if (readKeys.current.has(key)) return;
    readKeys.current.add(key); unsavedRead.current.add(key);
    if (readFlush.current !== null) return;
    readFlush.current = window.setTimeout(() => {
      readFlush.current = null;
      const pending = unsavedRead.current; unsavedRead.current = new Set();
      rememberRead(pending, saveScope);
    }, READ_FLUSH_MS);
  }, [state.phase, state.lineIndex, scene, line, saveScope]);
  useEffect(() => {
    const flush = () => { if (unsavedRead.current.size) { const pending = unsavedRead.current; unsavedRead.current = new Set(); rememberRead(pending, saveScope); } };
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush); document.addEventListener("visibilitychange", visibility);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility); flush(); };
  }, [saveScope]);

  // 본 CG·도달한 결말을 갤러리에 해금 기록한다.
  useEffect(() => {
    if (state.phase === "ending" && state.endingTitle) {
      setGallery(unlockGalleryEnding(state.endingTitle, saveScope));
      return;
    }
    if (state.phase !== "scene" || !scene) return;
    const cg = cgAt(vnScript, scene, state.lineIndex, state.flags);
    if (cg && !gallery.cgs.includes(cg)) setGallery(unlockGalleryCg(cg, saveScope));
  }, [state.phase, state.endingTitle, state.lineIndex, state.flags, scene, vnScript, saveScope, gallery.cgs]);

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
      pastLength: state.past.length,
      reducedMotion,
    };
  }, [state, typing, reducedMotion]);

  const snapshot = useCallback((): SlotSave => ({ sceneId:state.sceneId,lineIndex:state.lineIndex,affection:state.affection,flags:state.flags,phase:state.phase,history:state.history,rollback:rollbackLog(state,ROLLBACK_LIMIT),savedAt:Date.now(),script:vnScript,preview:resolved.plain,chapter:scene?.chapter ?? null,thumbnail:scene ? cgAt(vnScript,scene,state.lineIndex,state.flags) ?? backgroundAt(scene,state.lineIndex,state.flags) ?? `/assets/bg/${scene.background}.png` : null }),[state,vnScript,resolved,scene]);
  const checkpoint = useRef({ state, snapshot });
  checkpoint.current = { state, snapshot };
  // 자동 저장 실패는 한 번만 알린다. 매 진행마다 다시 띄우면 읽기를 방해할 뿐이고, 성공하면 다시 알릴 수 있게 푼다.
  const autosaveFailed = useRef(false);
  useEffect(() => {
    if (state.phase === "title" || state.error) return;
    const data = snapshot();
    if (writeAutoSlot(data,saveScope)) { setSavedAt(data.savedAt); setSaveRevision(value => value + 1); autosaveFailed.current = false; }
    else if (!autosaveFailed.current) { autosaveFailed.current = true; setSaveFeedback("자동 저장하지 못했습니다. 마지막으로 저장된 위치는 유지됩니다. 저장 공간을 확보한 뒤 다시 저장해 주세요."); }
  }, [state,snapshot,saveScope]);
  useEffect(() => {
    const flush = () => { const current=checkpoint.current; if(current.state.phase!=="title" && !current.state.error) writeAutoSlot(current.snapshot(),saveScope); };
    const visibility = () => { if(document.visibilityState==="hidden") flush(); };
    window.addEventListener("pagehide",flush); document.addEventListener("visibilitychange",visibility);
    return () => { window.removeEventListener("pagehide",flush); document.removeEventListener("visibilitychange",visibility); };
  }, [saveScope]);

  const muted = settings.muted === true;
  const sfxVolume = muted ? 0 : settings.sfxVolume;
  const sfxVolumeRef=useRef(sfxVolume);
  sfxVolumeRef.current=sfxVolume;
  const onMediaError = useCallback((kind: string) => setMediaNotice(`${kind} 파일을 재생하지 못했습니다. 작품 파일이 빠졌거나 주소가 바뀌었을 수 있습니다.`), []);
  useEffect(() => {
    if (state.phase !== "scene" || !line?.sfx || !unlocked) return;
    playSfx(line.sfx, sfxVolumeRef.current, () => onMediaError("효과음"));
  }, [state.phase, state.sceneId, state.lineIndex, line?.sfx, unlocked, onMediaError]);

  const advance = useCallback(() => {
    if (typing) {
      finish();
      return;
    }
    dispatch({ type: "advance" });
  }, [typing, finish]);
  const skip = useCallback(() => {
    dispatch({ type: "skipToChoice", readKeys: settings.skipUnread ? undefined : readKeys.current });
  }, [settings.skipUnread]);

  useEffect(() => {
    if (!auto || artOnly || state.phase !== "scene" || typing || panel !== "none" || line?.input || (line?.voice && voiceDone!==`${state.sceneEpoch}:${state.lineIndex}`)) return;
    const delay = autoAdvanceDelay(resolved.plain.length, settings.autoSpeed);
    autoTimer.current = window.setTimeout(() => dispatch({ type: "advance" }), delay);
    return () => {
      if (autoTimer.current !== null) window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    };
  }, [auto, artOnly, state.phase, state.sceneId, state.sceneEpoch, state.lineIndex, typing, text.length, panel,line?.voice,voiceDone,settings.autoSpeed]);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    writeSettings(next, settingsScope);
  }, [settingsScope]);
  const toggleMute = useCallback(() => updateSettings({ ...settings, muted: !muted }), [settings, muted, updateSettings]);
  const fullscreenAvailable = typeof document !== "undefined" && document.fullscreenEnabled === true;
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen().catch(() => setMediaNotice("이 브라우저에서는 전체화면으로 전환할 수 없습니다."));
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
      // NaN 은 typeof number 를 통과한다 — 유한한 정수만 위치로 받는다.
      if (previewScene && typeof position?.lineIndex === "number" && Number.isFinite(position.lineIndex)) {
        dispatch({ type: "restore", sceneId: previewScene.id, lineIndex: Math.max(0, Math.min(Math.floor(position.lineIndex), previewScene.lines.length - 1)), affection: 0, ...(position.flags ? {flags:position.flags} : {}) });
      }
    } catch {
      // 깨진 미리보기 JSON 은 무시한다.
    }
  }, [bootScript, isStudioPreview]);

  const backToTitle = useCallback(() => {
    scriptRef.current = script;
    setVnScript(script);
    setAuto(false); setArtOnly(false); setPanel("none");
    dispatch({ type: "backToTitle" });
  }, [script]);

  const nameOf = useCallback(
    (speaker: string | null) => {
      if (speaker === null) return null;
      const name = speakerName(vnScript, speaker as never);
      // 이름 안의 {flag:…}·{player} 를 풀어 쓴다 — 입력받은 주인공 이름을 띄우는 용도.
      return name === null ? null : resolveInline(name, state.flags).plain;
    },
    [vnScript, state.flags],
  );

  const bgmTrack = useMemo(() => {
    if (state.phase === "title") return script.titleBgm ?? "main-theme";
    return scene ? bgmAt(scene,state.lineIndex,state.flags) : null;
  }, [state.phase,state.lineIndex,state.flags,scene,script.titleBgm]);

  const onSave = useCallback(() => {
    const data = snapshot();
    const saved = writeSave(data,isStudioPreview,projectNamespace);
    if (saved) { setSavedAt(data.savedAt); setSaveRevision(value => value + 1); }
    setSaveFeedback(saved ? "작품과 플레이 위치를 저장했습니다." : "저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.");
    playSfx("ui-click", sfxVolumeRef.current);
    setPanel("save");
  }, [snapshot,isStudioPreview,projectNamespace]);

  const restoreSave = useCallback((save: SaveData | null) => {
    if (!save) return;
    const savedScript = save.script ?? [vnScript, script].find(candidate => candidate.scenes.some(row => row.id === save.sceneId)) ?? script;
    setSaveFeedback(manuscriptKey(savedScript)!==manuscriptKey(vnScript)?"저장 당시의 원고로 이어갑니다. 현재 원고의 수정 내용은 반영되지 않습니다.":null);
    scriptRef.current = savedScript;
    setVnScript(savedScript);
    // 원고를 내장하지 않은 저장은 여기서 타입을 맞춘다(내장 저장은 persist 가 이미 맞췼다).
    const flags = reconcileFlags(save.flags, savedScript.flags);
    dispatch({ type: "restore", sceneId: save.sceneId, lineIndex: save.lineIndex, affection: save.affection, ...(flags?{flags}:{}), ...(save.phase?{phase:save.phase}:{}), ...(save.history?{history:save.history}:{}), ...(save.rollback?{rollback:save.rollback}:{}) });
    setPanel("none"); setUnlocked(true);
  }, [vnScript,script]);
  const onLoad = useCallback(() => restoreSave(latestSave(isStudioPreview,projectNamespace)), [restoreSave, isStudioPreview, projectNamespace]);
  const quickSave = useCallback(() => {
    const data = snapshot();
    if (writeQuickSlot(data, saveScope)) { setSavedAt(data.savedAt); setSaveRevision(value => value + 1); setSaveFeedback("퀵 세이브했습니다. F9 로 불러올 수 있습니다."); }
    else setSaveFeedback("퀵 세이브하지 못했습니다. 브라우저 저장 공간을 확인하세요.");
  }, [snapshot, saveScope]);
  const quickLoad = useCallback(() => {
    const quick = readQuickSlot(saveScope);
    if (quick) restoreSave(quick); else setSaveFeedback("퀵 세이브가 없습니다. F5 로 먼저 저장하세요.");
  }, [saveScope, restoreSave]);

  // Ctrl 을 누르고 있으면 읽은 대사를 빨리 감는다. 읽지 않은 대사(설정으로 허용하지 않으면)나 선택지·엔딩 앞에서 멈춘다.
  const latest = useRef({ state, typing, finish, settings, panel, artOnly, scene });
  latest.current = { state, typing, finish, settings, panel, artOnly, scene };
  useEffect(() => {
    let delay: number | null = null, interval: number | null = null;
    const stop = () => { if (delay !== null) window.clearTimeout(delay); if (interval !== null) window.clearInterval(interval); delay = interval = null; };
    const step = () => {
      const now = latest.current;
      if (now.panel !== "none" || now.artOnly || now.state.phase !== "scene" || !now.scene) { stop(); return; }
      // 입력 줄은 빨리 감기로도 건너뛰지 않는다 — 독자가 직접 넣어야 한다.
      if (now.scene.lines[now.state.lineIndex]?.input) { stop(); return; }
      if (now.typing) { now.finish(); return; }
      const scene = now.scene;
      let upcoming = -1;
      for (let index = now.state.lineIndex + 1; index < scene.lines.length; index += 1) if (lineAllowed(scene.lines[index]!, now.state.flags)) { upcoming = index; break; }
      if (upcoming < 0 && scene.ending && !scene.choices?.length) { stop(); return; }
      if (!now.settings.skipUnread && upcoming >= 0 && !readKeys.current.has(readKey(scene.id, upcoming, scene.lines[upcoming]))) { stop(); return; }
      dispatch({ type: "advance" });
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key !== "Control" || event.repeat || delay !== null || interval !== null) return;
      delay = window.setTimeout(() => { delay = null; step(); interval = window.setInterval(step, HOLD_SKIP_INTERVAL_MS); }, HOLD_SKIP_DELAY_MS);
    };
    const onUp = (event: KeyboardEvent) => { if (event.key === "Control") stop(); };
    window.addEventListener("keydown", onDown); window.addEventListener("keyup", onUp); window.addEventListener("blur", stop);
    return () => { stop(); window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); window.removeEventListener("blur", stop); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        setArtOnly(false);
        setPanel("none");
        return;
      }
      if (event.key === "PageUp") {
        if (panel === "none" && (state.phase === "scene" || state.phase === "choice" || state.phase === "ending")) { event.preventDefault(); dispatch({ type: "back" }); }
        return;
      }
      if ((event.key === "F5" || event.key === "F9") && panel === "none" && (state.phase === "scene" || state.phase === "choice")) {
        event.preventDefault();
        if (event.key === "F5") quickSave(); else quickLoad();
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
  }, [advance, state.phase, panel, artOnly, quickSave, quickLoad]);

  const unlock = useCallback(() => setUnlocked(true), []);
  useEffect(()=>{window.addEventListener("pointerdown",unlock,{once:true});window.addEventListener("keydown",unlock,{once:true});return()=>{window.removeEventListener("pointerdown",unlock);window.removeEventListener("keydown",unlock);};},[unlock]);

  // 저장 창이 열린 동안에도 타이프라이터가 프레임마다 다시 그린다 — 슬롯 목록은 저장이 바뀔 때만 다시 읽는다.
  const slotList = useMemo(() => (panel === "save" || panel === "load") ? { slots: listSlots(saveScope), auto: readAutoSlot(saveScope), quick: readQuickSlot(saveScope) } : null, [panel, saveScope, saveRevision]);
  const saveDialog = slotList && (panel === "save" || panel === "load") && <SlotPicker currentScript={vnScript} mode={panel} error={saveFeedback?.includes("못했") ? saveFeedback : null} slots={slotList.slots} autoSlot={slotList.auto} quickSlot={slotList.quick} onClose={()=>setPanel("none")} onPickAuto={()=>restoreSave(readAutoSlot(saveScope))} onPickQuick={()=>restoreSave(readQuickSlot(saveScope))} onPick={slot=>{
    if(panel==="load") {restoreSave(readSlot(slot,saveScope));return;}
    const data=snapshot();
    if(writeSlot(slot,data,saveScope)){setSavedAt(data.savedAt);setSaveRevision(value=>value+1);setSaveFeedback(`슬롯 ${slot+1}에 작품과 선택 기록을 저장했습니다.`);setPanel("none");}
    else setSaveFeedback("슬롯에 저장하지 못했습니다. 기존 저장은 유지됩니다.");
  }}/>;

  const creditsDialog = panel === "credits" && <CreditsPanel script={vnScript} standalone={standalone} onClose={() => setPanel("none")} />;

  const galleryDialog = panel === "gallery" && <GalleryPanel script={vnScript} gallery={gallery} onClose={() => setPanel("none")} />;
  const titleConfirm = panel === "title-confirm" && <ConfirmDialog testId="title-confirm" title="타이틀로 돌아갈까요?" message="지금까지의 진행은 자동 저장되어 있습니다. 타이틀에서 「이어서 읽기」로 돌아올 수 있습니다." confirmLabel="타이틀로" onCancel={() => setPanel("none")} onConfirm={backToTitle} />;
  const bgmVolume = muted ? 0 : settings.bgmVolume;
  const voiceVolume = muted ? 0 : settings.voiceVolume ?? 0.8;

  if (state.error !== null) {
    return (
      <main className="vn-root">
        <section className="fatal-dialog">
          <p className="fatal" data-testid="fatal">
            {state.error}
          </p>
          <div className="fatal-actions">
            {state.past.length > 0 && <button type="button" data-testid="fatal-back" onClick={() => dispatch({ type: "back" })}>이전</button>}
            <button type="button" data-testid="fatal-title" onClick={backToTitle}>타이틀로</button>
            {latestSave(isStudioPreview, projectNamespace) && <button type="button" data-testid="fatal-continue" onClick={onLoad}>이어서 읽기</button>}
            <button type="button" data-testid="fatal-restart" onClick={() => bootScript(script)}>처음부터 다시</button>
          </div>
        </section>
      </main>
    );
  }

  if (state.phase === "title") {
    return (
      <main className="vn-root" onClick={unlock}>
        <PaperTexture />
        <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={bgmVolume} unlocked={unlocked} onError={() => onMediaError("배경음악")} />
        <TitleScreen onCredits={()=>setPanel("credits")} onGallery={()=>setPanel("gallery")} script={script} standalone={standalone} hasSave={savedAt !== null} onLoad={()=>setPanel("load")} onStart={() => { unlock(); playSfx("ui-click", sfxVolumeRef.current); bootScript(script); }} onContinue={() => { unlock(); onLoad(); }} />
        {mediaNotice && <p className="player-save-notice media-notice" data-testid="media-notice" aria-live="polite">{mediaNotice}</p>}
        {saveDialog}{creditsDialog}{galleryDialog}
        <div className="grain-overlay" aria-hidden="true" />
      </main>
    );
  }

  if (state.phase === "ending") {
    return (
      <main className="vn-root">
        {isStudioPreview && <a className="studio-return" href={`${import.meta.env.BASE_URL}studio.html`}>← 스튜디오로 돌아가기</a>}
        <PaperTexture />
        <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={bgmVolume} unlocked={unlocked} onError={() => onMediaError("배경음악")} />
        {mediaNotice && <p className="player-save-notice media-notice" data-testid="media-notice" aria-live="polite">{mediaNotice}</p>}
        {creditsDialog}
        <EndingScreen
          title={state.endingTitle ?? "END"}
          affection={state.affection}
          background={scene?.background ?? "title"}
          backgroundUrl={scene ? backgroundAt(scene, scene.lines.length - 1,state.flags) : undefined}
          cgUrl={scene ? cgAt(vnScript,scene, scene.lines.length - 1,state.flags) : undefined}
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
        <section className="fatal-dialog">
          <p className="fatal">{state.error ?? "씬을 찾을 수 없다"}</p>
          <div className="fatal-actions">
            {state.past.length > 0 && <button type="button" data-testid="fatal-back" onClick={() => dispatch({ type: "back" })}>이전</button>}
            <button type="button" data-testid="fatal-title" onClick={backToTitle}>타이틀로</button>
            {latestSave(isStudioPreview, projectNamespace) && <button type="button" data-testid="fatal-continue" onClick={onLoad}>이어서 읽기</button>}
            <button type="button" data-testid="fatal-restart" onClick={() => bootScript(script)}>처음부터 다시</button>
          </div>
        </section>
      </main>
    );
  }

  const speaking = line?.speaker ?? null;
  // 다음 보이는 대사가 아직 읽지 않은 것인지 — 스킵 버튼이 왜 멈추는지 알려 주기 위해서다.
  let nextUnread = false;
  if (state.phase === "scene" && !settings.skipUnread) {
    for (let index = state.lineIndex + 1; index < scene.lines.length; index += 1) if (lineAllowed(scene.lines[index]!, state.flags)) { nextUnread = !readKeys.current.has(readKey(scene.id, index, scene.lines[index])); break; }
  }

  return (
    <main className="vn-root">
      {isStudioPreview && <a className="studio-return" href={`${import.meta.env.BASE_URL}studio.html`} data-testid="studio-return">← 스튜디오로 돌아가기</a>}
      {saveFeedback && <p className="player-save-notice" role="status">{saveFeedback}</p>}
      {mediaNotice && <p className="player-save-notice media-notice" data-testid="media-notice" aria-live="polite">{mediaNotice}</p>}
      <PaperTexture />
      <BgmPlayer fadeSeconds={vnScript.musicFadeSeconds} track={bgmTrack} volume={bgmVolume} unlocked={unlocked} onError={() => onMediaError("배경음악")} /><VoicePlayer source={state.phase==="scene"?line?.voice:undefined} cue={`${state.sceneEpoch}:${state.lineIndex}`} volume={voiceVolume} paused={panel!=="none"} unlocked={unlocked} onDone={setVoiceDone}/>
      <section
        className={`stage ${line?.shake ? "is-shaking" : ""} ${state.phase === "choice" ? "is-choice" : ""}`}
        data-testid="stage"
        data-scene={scene.id}
        onWheel={(event) => {
          if (panel !== "none" || artOnly || (state.phase !== "scene" && state.phase !== "choice")) return;
          // 위로 굴리면 되돌리고, 아래로 굴리면 다음 대사로 간다(선택지에서는 진행하지 않는다).
          if (event.deltaY !== 0 && Math.sign(event.deltaY) !== Math.sign(wheelAcc.current)) wheelAcc.current = 0;
          wheelAcc.current += event.deltaY;
          if (wheelAcc.current <= -120) { wheelAcc.current = 0; dispatch({ type: "back" }); }
          else if (wheelAcc.current >= 120) { wheelAcc.current = 0; if (state.phase === "scene") advance(); }
        }}
      >
        <Stage
          background={scene.background}
          backgroundUrl={backgroundAt(scene, state.lineIndex,state.flags)}
          cgUrl={cgAt(vnScript,scene, state.lineIndex,state.flags)}
          hideSprites={scene.hideSprites}
          framing={framingAt(scene,state.lineIndex,state.flags)}
          characters={vnScript.characters}
          sprites={spritesAt(scene, state.lineIndex,state.flags)}
          speaking={speaking}
          chapter={scene.chapter ?? null}
          sceneEpoch={state.sceneEpoch}
          transition={scene.transition ?? "fade"}
          effect={effectAt(scene, state.lineIndex, state.flags)}
          tint={tintAt(scene, state.lineIndex, state.flags)}
          reducedMotion={reducedMotion}
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
          canBack={state.past.length > 0}
          onBack={() => dispatch({ type: "back" })}
          canLoad={savedAt !== null}
          onSave={onSave}
          onLoad={()=>setPanel("load")}
          onAuto={() => setAuto((v) => !v)}
          onSkip={() => { if (nextUnread) setSaveFeedback("읽지 않은 대사는 건너뛰지 않습니다. 설정에서 「읽지 않은 대사도 스킵」을 켤 수 있습니다."); skip(); }}
          onHistory={() => setPanel((p) => (p === "history" ? "none" : "history"))}
          onSettings={() => setPanel((p) => (p === "settings" ? "none" : "settings"))}
          onTitle={() => setPanel("title-confirm")}
          muted={muted}
          onMute={toggleMute}
          fullscreen={fullscreen}
          onFullscreen={fullscreenAvailable ? toggleFullscreen : undefined}
        />}
        {state.phase === "scene" && <button type="button" className="art-view-button" data-testid="art-view-button" aria-pressed={artOnly} onClick={()=>setArtOnly(!artOnly)}>{artOnly ? "대사 표시 · H" : "원화 감상 · H"}</button>}
        {state.phase === "scene" && !artOnly && (
          <DialogueBox
            speaker={nameOf(speaking)}
            color={speakerColor(vnScript, speaking as never)}
            parts={truncateParts(resolved.parts, shown.length)}
            textLength={shown.length}
            fullText={resolved.plain}
            typing={typing}
            awaitingInput={line?.input !== undefined}
            onAdvance={advance}
          />
        )}
        {state.phase === "scene" && !artOnly && line?.input && !typing && (
          <LineInputPanel key={`${state.sceneEpoch}:${state.lineIndex}`} input={{ ...line.input, ...(line.input.prompt !== undefined ? { prompt: resolveText(line.input.prompt, state.flags) } : {}), ...(line.input.placeholder !== undefined ? { placeholder: resolveText(line.input.placeholder, state.flags) } : {}) }} onSubmit={(value) => dispatch({ type: "input", flag: line.input!.flag, value })} />
        )}
        {state.phase === "choice" && scene.choices && (
          <ChoiceMenu
            flags={state.flags}
            choices={scene.choices}
            onPick={(index) => {
              playSfx("ui-click", sfxVolumeRef.current);
              dispatch({ type: "choose", index });
            }}
            onHover={() => playSfx("ui-hover", sfxVolumeRef.current * 0.5)}
          />
        )}
        {panel === "history" && (
          <HistoryPanel entries={state.history} flags={state.flags} nameOf={nameOf} colorOf={(speaker) => speakerColor(vnScript, speaker as never)} onClose={() => setPanel("none")} />
        )}
        {panel === "settings" && (
          <SettingsPanel onCredits={()=>setPanel("credits")} settings={settings} onChange={updateSettings} onClose={() => setPanel("none")} />
        )}
      </section>
      {saveDialog}{creditsDialog}{titleConfirm}
      <div className="grain-overlay" aria-hidden="true" />
    </main>
  );
}
