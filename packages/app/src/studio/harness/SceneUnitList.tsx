import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { VnScript } from "@vnmaker/content";
import type { AuthorUnitView } from "../../api/harness.js";
import { StatusBadge, type QualityTone } from "./QualityReport.js";
import {
  CONTEXT_SEARCH_LIMIT, SCENE_ROW_HEIGHT, SCENE_VIEWPORT, listKeyAction, listWindow, scrollToIndex,
  searchManuscriptWindow, windowSlice,
} from "./listWindow.js";

function unitTone(status: string): QualityTone {
  switch (status) {
    case "ready": return "success";
    case "running": return "info";
    case "pending": return "incomplete";
    case "blocked": return "warning";
    case "failed": return "error";
    case "cancelled": return "limit";
    default: return "incomplete";
  }
}

export function SceneUnitList({
  script, units, selectedSceneId, onSelect,
}: {
  readonly script: VnScript;
  readonly units: readonly AuthorUnitView[];
  readonly selectedSceneId?: string;
  readonly onSelect?: (sceneId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [unitScroll, setUnitScroll] = useState(0);
  const [selected, setSelected] = useState(0);
  const [composing, setComposing] = useState(false);
  const scenePane = useRef<HTMLDivElement>(null);
  const search = useMemo(() => searchManuscriptWindow(script, query, CONTEXT_SEARCH_LIMIT), [script, query]);
  const showingSearch = query.trim().length > 0;
  const sceneFrame = listWindow({
    total: script.scenes.length, scrollTop, viewportHeight: SCENE_VIEWPORT, rowHeight: SCENE_ROW_HEIGHT,
  });
  const unitFrame = listWindow({
    total: units.length, scrollTop: unitScroll, viewportHeight: SCENE_VIEWPORT, rowHeight: SCENE_ROW_HEIGHT,
  });
  const scenes = windowSlice(script.scenes, sceneFrame);
  const visibleUnits = windowSlice(units, unitFrame);
  useEffect(() => {
    const index = script.scenes.findIndex(scene => scene.id === selectedSceneId);
    const pane = scenePane.current;
    if (index < 0 || pane === null) return;
    const next = scrollToIndex({
      index, rowHeight: SCENE_ROW_HEIGHT, viewportHeight: SCENE_VIEWPORT, scrollTop: pane.scrollTop,
    });
    if (next !== pane.scrollTop) pane.scrollTop = next;
  }, [selectedSceneId, script.scenes]);
  function onSearchKey(event: KeyboardEvent<HTMLInputElement>): void {
    const total = showingSearch ? search.hits.length : script.scenes.length;
    const action = listKeyAction({
      key: event.key, composing: composing || event.nativeEvent.isComposing, selected, total,
    });
    if (!action.handled) return;
    event.preventDefault();
    setSelected(action.selected);
    if (showingSearch) {
      const hit = search.hits[action.selected];
      if (action.activate && hit !== undefined) onSelect?.(hit.sceneId);
      return;
    }
    const scene = script.scenes[action.selected];
    if (scene === undefined) return;
    onSelect?.(scene.id);
    const pane = scenePane.current;
    if (pane === null) return;
    pane.scrollTop = scrollToIndex({
      index: action.selected, rowHeight: SCENE_ROW_HEIGHT, viewportHeight: SCENE_VIEWPORT, scrollTop: pane.scrollTop,
    });
  }
  return <div className="harness-lists" data-testid="harness-scene-unit-list" data-selected={selectedSceneId ?? ""}>
    <label>맥락 검색<input
      data-testid="harness-context-search" aria-label="맥락 검색" value={query}
      onChange={event => {
        setQuery(event.target.value);
        const native = event.nativeEvent;
        if (native instanceof InputEvent && native.isComposing) return;
        setSelected(0);
      }}
      onKeyDown={onSearchKey}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={() => setComposing(false)}
    /></label>
    <p role="status" data-testid="harness-search-status" data-copied={search.copiedExcerpts} data-hits={search.hits.length}>
      {showingSearch ? `검색 결과 ${search.hits.length}개` : `장면 ${script.scenes.length}개`}
    </p>
    {showingSearch ? <ul data-testid="harness-search-hits" role="listbox" aria-label="맥락 검색 결과">
      {search.hits.map((hit, index) => <li key={`${hit.kind}-${hit.sceneId}-${hit.lineIndex}`}>
        <button type="button" role="option" aria-selected={index === selected}
          data-testid={index === 0 ? "harness-search-hit" : `harness-search-hit-${index}`}
          className={index === selected ? "is-selected" : ""}
          onClick={() => { setSelected(index); onSelect?.(hit.sceneId); }}>
          {hit.sceneId}<small>{hit.excerpt}</small>
        </button>
      </li>)}
    </ul> : <section>
      <h3>장면</h3>
      <div ref={scenePane} className="harness-window" data-testid="harness-scene-window"
        data-start={sceneFrame.start} data-end={sceneFrame.end} data-total={sceneFrame.total}
        data-visible={sceneFrame.visible} data-row-height={SCENE_ROW_HEIGHT}
        style={{ height: SCENE_VIEWPORT }} onScroll={event => setScrollTop(event.currentTarget.scrollTop)}>
        <div className="harness-window-pad" style={{ height: sceneFrame.padTop }} />
        <ul role="listbox" aria-label="장면">{scenes.map((scene, offset) => {
          const index = sceneFrame.start + offset;
          const active = scene.id === selectedSceneId;
          return <li key={scene.id} style={{ height: SCENE_ROW_HEIGHT }}>
            <button type="button" role="option" aria-selected={active} aria-setsize={script.scenes.length}
              aria-posinset={index + 1} data-testid={`harness-scene-${scene.id}`}
              className={active ? "is-selected" : ""}
              onClick={() => { setSelected(index); onSelect?.(scene.id); }}>
              {scene.id}<small>{scene.lines.length}</small>
            </button>
          </li>;
        })}</ul>
        <div className="harness-window-pad" style={{ height: sceneFrame.padBottom }} />
      </div>
    </section>}
    <section>
      <h3>작업 단위</h3>
      {units.length === 0 ? <p data-testid="harness-units-empty">pending units 0</p> : <div
        className="harness-window" data-testid="harness-unit-window" data-visible={unitFrame.visible}
        data-total={unitFrame.total} data-row-height={SCENE_ROW_HEIGHT}
        style={{ height: Math.min(SCENE_VIEWPORT, units.length * SCENE_ROW_HEIGHT) }}
        onScroll={event => setUnitScroll(event.currentTarget.scrollTop)}>
        <div className="harness-window-pad" style={{ height: unitFrame.padTop }} />
        <ul>{visibleUnits.map(unit => <li key={unit.id} data-testid={`harness-unit-${unit.id}`} data-status={unit.status}
          style={{ height: SCENE_ROW_HEIGHT }}>
          <StatusBadge kind={unitTone(unit.status)} label={`${unit.kind}:${unit.status}`} testId={`harness-unit-status-${unit.id}`} />
          {unit.reason ?? unit.code ?? unit.id}
        </li>)}</ul>
        <div className="harness-window-pad" style={{ height: unitFrame.padBottom }} />
      </div>}
    </section>
  </div>;
}
