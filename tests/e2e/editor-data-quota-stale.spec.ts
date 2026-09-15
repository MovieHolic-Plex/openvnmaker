/**
 * 적대적 리뷰 P1: localStorage 한도 초과 → 빠른 복구 사본 쓰기 실패 + 보관함(IndexedDB) 저장 성공 → 새로고침.
 * 이전에는 오래된 사본이 열리고 마운트 직후 자동 저장이 보관함의 최신 원고를 덮어써 편집이 영구히 사라졌다.
 */
import {test,expect,type Page} from "@playwright/test";

const activeId=(page:Page)=>page.evaluate(()=>localStorage.getItem("vnmaker.studio.active-project.v1")||"original-project");
const idbRecord=(page:Page,id:string)=>page.evaluate(async id=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{return await new Promise<{title:string;updatedAt:number}|null>(resolve=>{const r=db.transaction("projects").objectStore("projects").get(id);r.onsuccess=()=>resolve(r.result?{title:r.result.script?.title,updatedAt:r.result.updatedAt}:null);r.onerror=()=>resolve(null);});}finally{db.close();}
},id);
const fillQuota=(page:Page)=>page.evaluate(()=>{let keys=0;for(const size of [1<<20,1<<16,1<<12,1<<8,16,1]){const chunk="x".repeat(size);for(;;){try{localStorage.setItem(`__junk_${keys}`,chunk);keys++;}catch{break;}if(keys>20000)break;}}return keys;});
const freeQuota=(page:Page)=>page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith("__junk_"))localStorage.removeItem(key);});

test("a quick-recovery copy that could not be written never clobbers the newer library manuscript on reload",async({page},info)=>{
  await page.goto("/studio.html");
  const id=await activeId(page);
  await page.getByLabel("작품 제목").fill("첫 판본 V1");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await expect.poll(()=>idbRecord(page,id).then(row=>row?.title)).toBe("첫 판본 V1");
  expect(await fillQuota(page)).toBeGreaterThan(0);
  await page.getByLabel("작품 제목").fill("둘째 판본 V2 (용량 초과 중 편집)");
  await expect(page.getByRole("alert")).toContainText("빠른 복구 저장에 실패");
  await expect.poll(()=>idbRecord(page,id).then(row=>row?.title)).toBe("둘째 판본 V2 (용량 초과 중 편집)");
  // 사본을 쓸 수 없었으니 오래된 사본은 남기지 않는다 — 다음 실행이 보관함을 읽게 한다.
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
  await page.screenshot({path:info.outputPath("quota-exhausted-editing.png")});
  // 사본을 비워 생긴 공간까지 다시 채운다 — 새로고침의 pagehide 기록도 실패하는, 한도가 계속 꽉 찬 상태를 유지한다.
  await fillQuota(page);

  await page.reload();
  const panel=page.getByRole("region",{name:"원고 복구"});
  await expect(panel).toBeVisible();
  await expect(page.getByLabel("작품 제목")).toHaveValue("둘째 판본 V2 (용량 초과 중 편집)");
  // 마운트 직후 자동 저장이 돌았더라도 보관함은 최신 원고 그대로여야 한다.
  await page.waitForTimeout(1500);
  expect((await idbRecord(page,id))?.title).toBe("둘째 판본 V2 (용량 초과 중 편집)");
  await page.screenshot({path:info.outputPath("quota-reload-recovery.png")});

  await freeQuota(page);
  await panel.getByRole("button",{name:"이 보관함 원고로 복구"}).click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue("둘째 판본 V2 (용량 초과 중 편집)");
  expect((await idbRecord(page,id))?.title).toBe("둘째 판본 V2 (용량 초과 중 편집)");
  await expect(page.getByRole("region",{name:"원고 복구"})).toHaveCount(0);
});

test("a library record newer than the quick-recovery copy opens with a notice instead of being overwritten",async({page})=>{
  await page.goto("/studio.html");
  const id=await activeId(page);
  await page.getByLabel("작품 제목").fill("사본 판본");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await expect.poll(()=>idbRecord(page,id).then(row=>row?.title)).toBe("사본 판본");
  // 사본을 우회해 보관함만 더 새로운 원고로 바꾼다(사본 쓰기 실패 뒤 보관함만 갱신된 상황을 직접 만든다).
  await page.evaluate(async id=>{
    const raw=JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!);raw.title="보관함이 더 새로운 판본";
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put({id,script:raw,updatedAt:Date.now()+60_000});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  },id);
  await page.reload();
  await expect(page.getByLabel("작품 제목")).toHaveValue("보관함이 더 새로운 판본");
  await expect(page.getByRole("alert")).toContainText("보관함의 최신 원고를 열었습니다");
  // 확인 전에는 자동 저장이 꺼져 있어 어느 쪽도 덮어쓰지 않는다.
  await page.waitForTimeout(1200);
  expect((await idbRecord(page,id))?.title).toBe("보관함이 더 새로운 판본");
  expect(JSON.parse((await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1")))!).title).toBe("사본 판본");
  await page.getByRole("button",{name:"현재 작품 저장"}).click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(JSON.parse((await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1")))!).title).toBe("보관함이 더 새로운 판본");
});

test("a manuscript that exceeds a validation limit can be salvaged instead of being replaced by the sample",async({page,context})=>{
  await page.goto("/studio.html");
  await page.getByLabel("작품 제목").fill("상한 초과 원고");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  // 편집기 탭을 먼저 떠난다(pagehide 가 정상 원고를 다시 쓰므로). 그다음 다른 탭에서 상한을 넘는 원고를 심는다.
  await page.goto("about:blank");
  const other=await context.newPage();await other.goto("/");
  await other.evaluate(()=>{
    const raw=JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!);
    raw.scenes[0].lines[0].text="가".repeat(20_001);raw.scenes[0].lines.splice(1,0,{speaker:null,text:"살아남아야 하는 둘째 문장"});
    localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(raw));
  });
  await other.close();
  await page.goto("/studio.html");
  const panel=page.getByRole("region",{name:"원고 복구"});
  await expect(panel).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("대사: 올바른 텍스트");
  await expect(page.getByTestId("recovery-salvage-summary")).toContainText("잘리는 항목 1개");
  await page.getByTestId("recovery-salvage").click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByLabel("작품 제목")).toHaveValue("상한 초과 원고");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.getByTestId("workspace-stage").click();
  await page.getByTestId("studio-line-0").click();
  expect((await page.getByTestId("studio-line-text").inputValue()).length).toBe(20_000);
  await page.getByTestId("studio-line-1").click();
  await expect(page.getByTestId("studio-line-text")).toHaveValue("살아남아야 하는 둘째 문장");
  // 손상 원문은 복구 전에 따로 보존한다.
  expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.startsWith("vnmaker.recovery-preserved.")))).toBe(true);
});
