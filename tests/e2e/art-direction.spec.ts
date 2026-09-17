import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";

const novel = JSON.parse(readFileSync("packages/content/data/rain-blank.json", "utf8"));
type Cue = { scene: string; index: number; anchor: string; cgUrl?: string | null; sprites?: { slot: string; character: string; poseUrl?: string | null }[] };
const cues: Cue[] = JSON.parse(readFileSync("docs/qa/studio-completion-2026-09-06/narrative-cues.json", "utf8"));
const cgNames = ["empty-sixth-frame-cg", "seorin-packing-cg", "recorder-ribbon-cg", "records-comparison-cg", "glass-assembly-cg", "first-visitor-cg"];
const poseNames = ["seorin-working", "dohyun-working", "mirae-reading"];
const cases = [...cgNames.map(name => ({ name, kind: "cg", cue: cues.find(c => c.cgUrl === `/assets/art/${name}.png`)! })), ...poseNames.map(name => ({ name, kind: "pose", cue: cues.find(c => c.sprites?.some(s => s.poseUrl === `/assets/art/${name}.png`))! }))];
const projectKey = "vnmaker.studio.project.v1";
const positionKey = "vnmaker.studio.position.v1";
const evidence = "evidence/completion-art";

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px Studio CG 6개와 작업 포즈 3개 실제 화면 검수`, async ({ page }) => {
    test.setTimeout(180_000);
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize(viewport);
    page.setDefaultTimeout(15_000);
    const errors: string[] = [];
    const apiCalls: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      if (!new URL(route.request().url()).pathname.startsWith("/api/")) { await route.continue(); return; }
      apiCalls.push(route.request().url()); await route.abort();
    });
    await page.addInitScript(({ novel, projectKey, positionKey, cue }) => {
      localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1");
      if (!localStorage.getItem(projectKey)) {
        localStorage.setItem(projectKey, JSON.stringify(novel));
        localStorage.setItem(positionKey, JSON.stringify({ sceneId: cue.scene, lineIndex: cue.index, view: "stage", flags: novel.flags }));
      }
    }, { novel, projectKey, positionKey, cue: cases[0]!.cue });
    await page.goto("/studio.html");
    const observations: unknown[] = [];
    for (const item of cases) {
      const cue = item.cue;
      expect(cue, item.name).toBeTruthy();
      const scene = novel.scenes.find((s: { id: string }) => s.id === cue.scene);
      expect(scene.lines[cue.index].text).toContain(cue.anchor);
      await page.evaluate(({ positionKey, cue, flags }) => localStorage.setItem(positionKey, JSON.stringify({ sceneId: cue.scene, lineIndex: cue.index, view: "stage", flags })), { positionKey, cue, flags: novel.flags });
      await page.reload();
      // 스위트 부하에서 스튜디오 부팅이 15초 기본 대기를 넘기는 경우가 있어 이 클릭만 넉넉히 기다린다.
      await page.getByTestId(`studio-line-${cue.index}`).click({ timeout: 60_000 });
      await expect(page.getByTestId("dialogue-text")).toHaveText(scene.lines[cue.index].text);
      const stage = page.getByTestId("studio-stage");
      const expectedUrl = `/assets/art/${item.name}.png`;
      if (item.kind === "cg") {
        await expect(stage.getByTestId("bg-image")).toHaveAttribute("src", expectedUrl);
        await expect(stage.getByTestId("bg-image")).toHaveCSS("transform", "none");
        await expect(stage.locator(".sprite")).toHaveCount(0);
        await expect.poll(() => stage.getByTestId("bg-image").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      } else {
        const sprite = stage.locator(`canvas[data-src="${expectedUrl}"]`);
        await expect(sprite).toHaveAttribute("data-loaded", "true");
        await expect(sprite).not.toHaveAttribute("data-art-error", "true");
        const pixels = await sprite.evaluate((canvas: HTMLCanvasElement) => {
          const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
          let green = 0, opaque = 0;
          let minX = canvas.width, minY = canvas.height, maxX = 0, maxY = 0;
          for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 180) {
            opaque++;
            if (data[i + 1]! > 150 && data[i + 1]! > data[i]! * 1.5 && data[i + 1]! > data[i + 2]! * 1.5) green++;
            const pixel = i / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          }
          return { width: canvas.width, height: canvas.height, cornerAlpha: data[3], green, opaque, bounds: { minX, minY, maxX, maxY }, rect: canvas.getBoundingClientRect().toJSON() };
        });
        expect(pixels.cornerAlpha).toBe(0);
        expect(pixels.opaque).toBeGreaterThan(100);
        expect(pixels.green / pixels.opaque, "녹색 배경이 화면 픽셀에 남지 않는다").toBeLessThan(0.001);
        observations.push({ asset: item.name, spritePixels: pixels });
      }
      await stage.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/${viewport.width}-${item.name}-studio.png`, animations: "disabled" });
      await stage.screenshot({ path: `${evidence}/${viewport.width}-${item.name}-stage.png`, animations: "disabled" });
      const geometry = await page.evaluate(() => ({ viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth, stage: document.querySelector('[data-testid="studio-stage"]')!.getBoundingClientRect().toJSON(), dialogue: document.querySelector('[data-testid="dialogue-text"]')!.getBoundingClientRect().toJSON() }));
      expect(geometry.pageWidth).toBeLessThanOrEqual(viewport.width + 1);
      for (const id of ["studio-versions", "studio-export", "studio-export-bundle", "studio-play"]) {
        const action = page.getByTestId(id);
        await expect(action).toBeVisible();
        const bounds = await action.boundingBox();
        expect(bounds!.x, `${id} 왼쪽 접근`).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width, `${id} 오른쪽 접근`).toBeLessThanOrEqual(viewport.width);
      }
      observations.push({ asset: item.name, scene: cue.scene, index: cue.index, anchor: cue.anchor, text: scene.lines[cue.index].text, geometry });
      if (item.kind === "cg") {
        const exit = cues.find(c => c.scene === cue.scene && c.index > cue.index && c.cgUrl === null);
        expect(exit, `${item.name} 해제 큐`).toBeTruthy();
        await page.getByTestId(`studio-line-${exit!.index}`).click();
        await expect(stage.getByTestId("bg-image")).not.toHaveAttribute("src", expectedUrl);
        await expect(stage.locator(".has-event-cg")).toHaveCount(0);
      } else {
        const actor = cue.sprites!.find(s => s.poseUrl === expectedUrl)!.character;
        const exit = cues.find(c => c.scene === cue.scene && c.index > cue.index && c.sprites?.some(s => s.character === actor && s.poseUrl === null));
        expect(exit, `${item.name} 기본 포즈 복귀`).toBeTruthy();
        await page.getByTestId(`studio-line-${exit!.index}`).click();
        await expect(stage.locator(`canvas[data-src="${expectedUrl}"]`)).toHaveCount(0);
      }
    }
    await writeFile(`${evidence}/${viewport.width}-observations.json`, JSON.stringify(observations, null, 2));
    expect(errors).toEqual([]);
    expect(apiCalls).toEqual([]);
  });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}px 원화 감상은 CG를 대사 없이 보여주고 복귀한다`, async ({ page }) => {
    test.setTimeout(120_000);
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize(viewport);
    await page.addInitScript(({ novel, projectKey }) => {
      localStorage.setItem("vnmaker.edition", "rain-blank-2026-09-05-r1");
      localStorage.setItem(projectKey, JSON.stringify(novel));
    }, { novel, projectKey });
    await page.goto("/studio.html");
    // 첫 마운트가 기본 위치를 쓰기 전에 기다린다 — 그렇지 않으면 앱의 position 저장이
    // 아래 evaluate 덮어쓰기를 되돌려 overview 로 복원된다.
    await expect(page.getByLabel("작품 제목")).toHaveValue(novel.title);
    for (const item of cases.filter(c => c.kind === "cg")) {
      await page.evaluate(({ positionKey, cue, flags }) => localStorage.setItem(positionKey, JSON.stringify({ sceneId: cue.scene, lineIndex: cue.index, view: "stage", flags })), { positionKey, cue: item.cue, flags: novel.flags });
      await page.reload();
      const stage = page.getByTestId("studio-stage");
      await expect(stage.getByTestId("bg-image")).toHaveAttribute("src", `/assets/art/${item.name}.png`);
      await expect.poll(() => stage.getByTestId("bg-image").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.getByTestId("studio-art-view").click();
      await expect(stage.getByTestId("dialogue-text")).toHaveCount(0);
      await expect(page.getByTestId("studio-art-view")).toHaveAttribute("aria-pressed", "true");
      await stage.screenshot({ path: `${evidence}/${viewport.width}-${item.name}-art-only.png`, animations: "disabled" });
      await page.getByTestId("studio-art-view").click();
      const scene = novel.scenes.find((s: { id: string }) => s.id === item.cue.scene);
      await expect(stage.getByTestId("dialogue-text")).toHaveText(scene.lines[item.cue.index].text);
    }
  });
}
