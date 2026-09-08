import {test,expect} from "@playwright/test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {materializeZipBackup} from "./helpers/materialize-zip-backup.js";

test("lost edition marker preserves current manuscript and save data on both entry pages",async({page})=>{
  await page.goto("/studio.html");await page.getByLabel("작품 제목").fill("판본 키가 없어도 남는 원고");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const before=await page.evaluate(()=>{localStorage.setItem("vnmaker.studio.production.test","preserve-history");localStorage.setItem("vnmaker:save","preserve-save");localStorage.removeItem("vnmaker.edition");return localStorage.getItem("vnmaker.studio.project.v1");});
  await page.goto("/");expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(before);
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.production.test"))).toBe("preserve-history");expect(await page.evaluate(()=>localStorage.getItem("vnmaker:save"))).toBe("preserve-save");
  await page.evaluate(()=>localStorage.removeItem("vnmaker.edition"));await page.goto("/studio.html");await expect(page.getByLabel("작품 제목")).toHaveValue("판본 키가 없어도 남는 원고");
});

test("opening the player first cannot conceal missing recovery data with a sample",async({page})=>{
  await page.goto("/studio.html");await page.getByLabel("작품 제목").fill("플레이어를 먼저 열어도 복구할 원고");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(()=>{localStorage.removeItem("vnmaker.studio.project.v1");localStorage.removeItem("vnmaker.edition");});await page.goto("/");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
  await page.goto("/studio.html");await expect(page.getByRole("region",{name:"원고 복구"})).toContainText("플레이어를 먼저 열어도 복구할 원고");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
});

test("missing recovery and edition keys cannot initialize a sample over a durable project",async({page})=>{
  await page.goto("/studio.html");await page.getByTestId("project-library").click();await page.getByLabel("새 작품 이름").fill("복구 키가 사라진 작품");await page.getByTestId("project-create").click();
  // Creation is asynchronous: the old project's saved badge can still be visible.
  await expect(page.getByLabel("작품 제목")).toHaveValue("복구 키가 사라진 작품");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).title)).toBe("복구 키가 사라진 작품");
  await page.evaluate(()=>{localStorage.removeItem("vnmaker.studio.project.v1");localStorage.removeItem("vnmaker.studio.active-project.v1");localStorage.removeItem("vnmaker.edition");});
  await page.reload();await expect(page.getByRole("region",{name:"원고 복구"})).toContainText("복구 키가 사라진 작품");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
  await page.getByRole("button",{name:"이 보관함 원고로 복구"}).click();await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.reload();await expect(page.getByLabel("작품 제목")).toHaveValue("복구 키가 사라진 작품");
});

test("corrupt quick recovery preserves raw data and restores the validated active library manuscript",async({page},info)=>{
  await page.goto("/studio.html");await page.getByLabel("작품 제목").fill("복구할 장편 원고");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(()=>localStorage.setItem("vnmaker.studio.project.v1","{damaged-original"));await page.reload();
  const panel=page.getByRole("region",{name:"원고 복구"});await expect(panel).toContainText("복구할 장편 원고");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe("{damaged-original");
  await page.screenshot({path:info.outputPath("recovery-desktop.png")});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath("recovery-mobile.png")});
  const downloaded=page.waitForEvent("download");await panel.getByRole("button",{name:"손상 데이터 원문 받기"}).click();
  await(await downloaded).saveAs(info.outputPath("damaged.txt"));expect(await readFile(info.outputPath("damaged.txt"),"utf8")).toBe("{damaged-original");
  await page.evaluate(()=>{const original=Storage.prototype.setItem;(window as unknown as {restoreStorage:()=>void}).restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith("vnmaker.recovery-preserved."))throw new DOMException("test quota","QuotaExceededError");return original.call(this,key,value);};});
  await panel.getByRole("button",{name:"이 보관함 원고로 복구"}).click();await expect(panel).toContainText("손상 원문의 보존에 실패");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe("{damaged-original");
  await page.evaluate(()=>(window as unknown as {restoreStorage:()=>void}).restoreStorage());
  await panel.getByRole("button",{name:"이 보관함 원고로 복구"}).click();await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!).title)).toBe("복구할 장편 원고");
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith("vnmaker.recovery-preserved.")).map(key=>localStorage.getItem(key)))).toContain("{damaged-original");
  await page.reload();await expect(page.getByLabel("작품 제목")).toHaveValue("복구할 장편 원고");
});

test("a corrupt library record is never offered as a recovery candidate",async({page})=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put({id:localStorage.getItem("vnmaker.studio.active-project.v1")||"original-project",script:{invalid:true},updatedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();localStorage.setItem("vnmaker.studio.project.v1","{broken");
  });await page.reload();
  const panel=page.getByRole("region",{name:"원고 복구"});await expect(panel).toContainText("작품 보관함도 읽지 못했습니다");
  await expect(panel.getByRole("button",{name:"이 보관함 원고로 복구"})).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe("{broken");
});

test("damaged library rows do not hide healthy manuscripts or mutate their originals",async({page},info)=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const damaged={id:"damaged-test",script:{title:{broken:true}},updatedAt:Date.now()+100000};
  await page.evaluate(async damaged=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    const script=JSON.parse(localStorage.getItem("vnmaker.studio.project.v1")!);script.title="정상 보관함 작품";
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction("projects","readwrite");tx.objectStore("projects").put(damaged);tx.objectStore("projects").put({id:"healthy-test",script,updatedAt:Date.now()});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
  },damaged);
  await page.getByTestId("project-library").click();const dialog=page.getByRole("dialog",{name:"내 작품 보관함"});
  await expect(dialog.getByRole("alert")).toContainText("읽을 수 없는 작품 1개");
  const downloaded=page.waitForEvent("download");await dialog.getByRole("button",{name:"보관함 원본 JSON 받기"}).click();
  const archivePath=info.outputPath("library-originals.json");await (await downloaded).saveAs(archivePath);
  const archive=JSON.parse(await readFile(archivePath,"utf8"));expect(archive.format).toBe("vnmaker-library-archive");expect(archive.records.find((row:{id:string})=>row.id==="damaged-test")).toEqual(damaged);expect(archive.records.some((row:{script?:{title?:string}})=>row.script?.title==="정상 보관함 작품")).toBe(true);

  const row=dialog.locator("article").filter({hasText:"정상 보관함 작품"});await expect(row).toBeVisible();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath("library-damaged-mobile.png")});
  await row.getByRole("button",{name:"열기",exact:true}).click();await expect(page.getByLabel("작품 제목")).toHaveValue("정상 보관함 작품");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  expect(await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    return new Promise(resolve=>{const tx=db.transaction("projects","readonly"),r=tx.objectStore("projects").get("damaged-test");r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>db.close();});
  })).toEqual(damaged);
  await page.evaluate(()=>{localStorage.removeItem("vnmaker.studio.project.v1");localStorage.removeItem("vnmaker.studio.active-project.v1");});await page.reload();
  await expect(page.getByRole("region",{name:"원고 복구"})).toContainText("정상 보관함 작품");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
});

test("an entirely damaged library cannot trigger first-run sample initialization",async({page})=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction("projects","readwrite"),store=tx.objectStore("projects");store.clear();store.put({id:"only-damaged",script:null,updatedAt:1});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();
    localStorage.removeItem("vnmaker.studio.project.v1");localStorage.removeItem("vnmaker.edition");
  });await page.reload();
  await expect(page.getByText("보관함의 작품 1개를 읽지 못했습니다.",{exact:false})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
  expect(await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    return new Promise(resolve=>{const tx=db.transaction("projects","readonly"),r=tx.objectStore("projects").getAll();r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>db.close();});
  })).toEqual([{id:"only-damaged",script:null,updatedAt:1}]);
});

for(const format of ["json","zip"] as const)test(`all-damaged startup restores ${format} backup as a new project while retaining the writer lock`,async({page,context},info)=>{
  await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const restoreFile=format==="zip"?await(async()=>{
    const zip=await materializeZipBackup(page,info.outputPath("backup.zip"));
    const fileBytes=await readFile(zip.path);
    expect(fileBytes.byteLength).toBe(zip.byteLength);
    expect(createHash("sha256").update(fileBytes).digest("hex")).toBe(zip.sha256);
    expect(zip.byteLength).toBeGreaterThan(8_000_000);
    return zip.path;
  })():{name:"backup.json",mimeType:"application/json",buffer:Buffer.from(await page.evaluate(async()=>{
    const projectModule="/src/studio/projects.ts";const {newProject}=await import(projectModule);
    return Array.from(new TextEncoder().encode(JSON.stringify(newProject("외부 json 복구 작품"))));
  }))};
  await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    await new Promise<void>((resolve,reject)=>{const tx=db.transaction("projects","readwrite"),store=tx.objectStore("projects");store.clear();store.put({id:"damaged-original",script:null,updatedAt:1});tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);});db.close();localStorage.removeItem("vnmaker.studio.project.v1");
  });await page.reload();
  const input=page.getByLabel("복구할 백업 파일");await expect(input).toBeVisible();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"보관함 원본 JSON 받기"}).click();const archivePath=info.outputPath("all-damaged-originals.json");await(await download).saveAs(archivePath);expect(JSON.parse(await readFile(archivePath,"utf8")).records).toEqual([{id:"damaged-original",script:null,updatedAt:1}]);

  const other=await context.newPage();await other.goto("/studio.html");await expect(other.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  await input.setInputFiles({name:"broken.json",mimeType:"application/json",buffer:Buffer.from('{"invalid":true}')});await expect(page.getByRole("alert")).toContainText("백업을 가져오지 못했습니다");
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBeNull();
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath(`backup-recovery-${format}.png`)});
  await input.setInputFiles(restoreFile);
  await expect(page.getByLabel("작품 제목")).toHaveValue(`외부 ${format} 복구 작품`);await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await expect(other.getByRole("heading",{name:"다른 탭에서 편집 중입니다"})).toBeVisible();
  const rows=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
    return new Promise<any[]>(resolve=>{const tx=db.transaction("projects","readonly"),r=tx.objectStore("projects").getAll();r.onsuccess=()=>resolve(r.result);tx.oncomplete=()=>db.close();});
  });expect(rows).toHaveLength(2);expect(rows.find(row=>row.id==="damaged-original")).toEqual({id:"damaged-original",script:null,updatedAt:1});expect(rows.find(row=>row.id!=="damaged-original").script.title).toBe(`외부 ${format} 복구 작품`);
  await other.close();await page.reload();await expect(page.getByLabel("작품 제목")).toHaveValue(`외부 ${format} 복구 작품`);
});
