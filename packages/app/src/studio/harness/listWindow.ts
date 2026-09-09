export const CONTEXT_SEARCH_LIMIT = 40;
export const SCENE_ROW_HEIGHT = 40;
export const SCENE_VIEWPORT = 360;
export const DIFF_ROW_HEIGHT = 72;
export const DIFF_VIEWPORT = 360;
export const LIST_OVERSCAN = 4;

export type ListWindow = {
  readonly start: number;
  readonly end: number;
  readonly padTop: number;
  readonly padBottom: number;
  readonly visible: number;
  readonly total: number;
};

export type ListNav = {
  readonly selected: number;
  readonly activate: boolean;
  readonly handled: boolean;
};

export type ContextHit = {
  readonly sceneId: string;
  readonly lineId: string | null;
  readonly lineIndex: number;
  readonly kind: "scene" | "line";
  readonly excerpt: string;
};

export type SearchWork = {
  readonly hits: readonly ContextHit[];
  readonly scannedScenes: number;
  readonly matchedLines: number;
  readonly copiedExcerpts: number;
  readonly truncated: boolean;
};

export function listWindow(input: {
  readonly total: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly rowHeight: number;
  readonly overscan?: number;
}): ListWindow {
  const rowHeight = Math.max(1, input.rowHeight);
  const total = Math.max(0, input.total);
  const overscan = input.overscan ?? LIST_OVERSCAN;
  const start = Math.max(0, Math.floor(Math.max(0, input.scrollTop) / rowHeight) - overscan);
  const visibleCount = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight) + 1;
  const end = Math.min(total, start + visibleCount + overscan);
  return {
    start, end, padTop: start * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight),
    visible: Math.max(0, end - start), total,
  };
}

export function windowSlice<T>(items: readonly T[], frame: ListWindow): readonly T[] {
  return items.slice(frame.start, frame.end);
}

export function scrollToIndex(input: {
  readonly index: number;
  readonly rowHeight: number;
  readonly viewportHeight: number;
  readonly scrollTop: number;
}): number {
  const top = Math.max(0, input.index) * Math.max(1, input.rowHeight);
  const bottom = top + Math.max(1, input.rowHeight);
  if (top < input.scrollTop) return top;
  if (bottom > input.scrollTop + input.viewportHeight) {
    return Math.max(0, bottom - input.viewportHeight);
  }
  return input.scrollTop;
}

export function listKeyAction(input: {
  readonly key: string;
  readonly composing: boolean;
  readonly selected: number;
  readonly total: number;
}): ListNav {
  if (input.composing || input.total <= 0) {
    return { selected: input.selected, activate: false, handled: false };
  }
  const last = input.total - 1;
  switch (input.key) {
    case "ArrowDown":
      return { selected: Math.min(last, input.selected + 1), activate: false, handled: true };
    case "ArrowUp":
      return { selected: Math.max(0, input.selected - 1), activate: false, handled: true };
    case "Home":
      return { selected: 0, activate: false, handled: true };
    case "End":
      return { selected: last, activate: false, handled: true };
    case "Enter":
      return { selected: input.selected, activate: true, handled: true };
    default:
      return { selected: input.selected, activate: false, handled: false };
  }
}

export function createPairMemo<A, B, T>(compute: (left: A, right: B) => T): {
  readonly run: (left: A, right: B) => T;
  readonly recomputes: () => number;
} {
  let left: A | undefined;
  let right: B | undefined;
  let cached: { readonly present: false } | { readonly present: true; readonly result: T } = { present: false };
  let recomputes = 0;
  return {
    run(nextLeft, nextRight) {
      if (cached.present && Object.is(left, nextLeft) && Object.is(right, nextRight)) return cached.result;
      left = nextLeft;
      right = nextRight;
      recomputes += 1;
      const result = compute(nextLeft, nextRight);
      cached = { present: true, result };
      return result;
    },
    recomputes: () => recomputes,
  };
}

export function searchManuscriptWindow(
  script: { readonly scenes: readonly { readonly id: string; readonly chapter?: string; readonly lines: readonly { readonly id?: string; readonly text: string }[] }[] },
  query: string,
  limit = CONTEXT_SEARCH_LIMIT,
): SearchWork {
  const normalized = query.trim().normalize("NFC").toLowerCase();
  if (normalized.length === 0) {
    return { hits: [], scannedScenes: 0, matchedLines: 0, copiedExcerpts: 0, truncated: false };
  }
  const hits: ContextHit[] = [];
  let scannedScenes = 0;
  let matchedLines = 0;
  let copiedExcerpts = 0;
  let truncated = false;
  outer: for (const scene of script.scenes) {
    scannedScenes += 1;
    const sceneHay = `${scene.id} ${scene.chapter ?? ""}`.normalize("NFC").toLowerCase();
    if (sceneHay.includes(normalized)) {
      if (hits.length >= limit) { truncated = true; break; }
      hits.push({ sceneId: scene.id, lineId: null, lineIndex: 0, kind: "scene", excerpt: scene.id });
      copiedExcerpts += 1;
    }
    for (let index = 0; index < scene.lines.length; index++) {
      const line = scene.lines[index];
      if (line === undefined || !line.text.normalize("NFC").toLowerCase().includes(normalized)) continue;
      matchedLines += 1;
      if (hits.length >= limit) { truncated = true; break outer; }
      hits.push({
        sceneId: scene.id, lineId: line.id ?? null, lineIndex: index, kind: "line", excerpt: line.text,
      });
      copiedExcerpts += 1;
    }
  }
  return { hits, scannedScenes, matchedLines, copiedExcerpts, truncated };
}
