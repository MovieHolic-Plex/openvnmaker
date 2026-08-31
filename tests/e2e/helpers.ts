import type { Page } from "@playwright/test";

export interface VnHook {
  readonly sceneId: string;
  readonly lineIndex: number;
  readonly affection: number;
  readonly typing: boolean;
  readonly phase: string;
  readonly error: string | null;
}

/** window.__vn 을 읽는다. 플레이어가 매 상태 변화마다 갱신한다. */
export async function vnState(page: Page): Promise<VnHook> {
  return page.evaluate(() => {
    const hook = window.__vn;
    if (!hook) throw new Error("window.__vn 이 없다");
    return hook;
  });
}

/** 지정한 testid 이미지가 실제로 로드됐는지(naturalWidth>0) 본다. */
export async function imageLoaded(page: Page, testId: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!(el instanceof HTMLImageElement)) return -1;
    return el.naturalWidth;
  }, testId);
}

/**
 * 요소가 실제로 눈에 보일 때까지 기다린다.
 * toBeVisible() 은 바운딩 박스만 본다. opacity:0 에서 페이드인하는 요소는
 * 애니메이션이 시작되기도 전에 "보인다"고 판정되고, 그 순간 찍은 스크린샷은 빈 화면이 된다.
 * 그래서 자손까지 실제 계산된 opacity 를 확인한다.
 */
export async function waitForOpaque(page: Page, testId: string, minOpacity = 0.99): Promise<void> {
  await page.waitForFunction(
    ({ id, min }) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      if (!(root instanceof HTMLElement)) return false;
      const nodes = [root, ...root.querySelectorAll("*")];
      return nodes.every((node) => {
        if (!(node instanceof HTMLElement)) return true;
        return Number.parseFloat(getComputedStyle(node).opacity) >= min;
      });
    },
    { id: testId, min: minOpacity },
    { timeout: 10_000 },
  );
}

export async function bgmTime(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="bgm-audio"]');
    return el instanceof HTMLAudioElement ? el.currentTime : -1;
  });
}

/** 엔딩에 도달할 때까지 클릭으로 진행한다. 선택지에서는 pick 인덱스를 고른다. */
export async function playToEnding(
  page: Page,
  pick: (sceneId: string) => number,
  onScene?: (sceneId: string) => Promise<void>,
): Promise<{ visited: string[]; ending: string }> {
  const visited: string[] = [];
  for (let step = 0; step < 4000; step += 1) {
    const state = await vnState(page);
    if (state.error) throw new Error(`엔진 오류: ${state.error}`);
    if (state.phase === "ending") {
      const ending = (await page.getByTestId("ending-title").textContent()) ?? "";
      return { visited, ending };
    }
    if (!visited.includes(state.sceneId)) {
      visited.push(state.sceneId);
      if (onScene) await onScene(state.sceneId);
    }
    if (state.phase === "choice") {
      await page.getByTestId(`choice-${pick(state.sceneId)}`).click();
      continue;
    }
    await page.getByTestId("advance-button").click();
  }
  throw new Error("4000번 진행해도 엔딩에 도달하지 못했다");
}
