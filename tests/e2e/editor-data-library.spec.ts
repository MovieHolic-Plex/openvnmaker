/**
 * 보관함 위생: 작품 삭제, 같은 원화 중복 등록 방지, 카드 제거 시 보관함 파일 정리, 보관함 원본 JSON 들여오기, 저장 공간 표시.
 */
import {test,expect,type Page} from "@playwright/test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

const idbIds=(page:Page)=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.projects",1);r.onsuccess=()=>resolve(r.result);});
  try{return await new Promise<string[]>(resolve=>{const r=db.transaction("projects").objectStore("projects").getAllKeys();r.onsuccess=()=>resolve(r.result.map(String));});}finally{db.close();}
});
const assetPaths=(page:Page)=>page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.project-assets",1);r.onupgradeneeded=()=>r.result.createObjectStore("files",{keyPath:"path"});r.onsuccess=()=>resolve(r.result);});
  try{return await new Promise<string[]>(resolve=>{const r=db.transaction("files").objectStore("files").getAllKeys();r.onsuccess=()=>resolve(r.result.map(String));});}finally{db.close();}
});
async function createProject(page:Page,title:string){
  await page.getByTestId("project-library").click();
  await page.getByLabel("새 작품 이름").fill(title);await page.getByTestId("project-create").click();
  await expect(page.getByLabel("작품 제목")).toHaveValue(title);await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
}

test("a project can be deleted after confirmation, except the active one; its record and versions go away",async({page},info)=>{
  await page.goto("/studio.html");
  await createProject(page,"삭제될 작품");
  const doomed=(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.active-project.v1")))!;
  await page.getByTestId("studio-versions").click();await page.getByLabel("버전 이름").fill("삭제 전 버전");await page.getByTestId("version-save").click();await expect(page.getByTestId("version-row")).toHaveCount(1);await page.getByRole("button",{name:"버전 기록 닫기"}).click();
  await createProject(page,"남는 작품");
  await page.getByTestId("project-library").click();
  const dialog=page.getByRole("dialog",{name:"내 작품 보관함"});
  await expect(dialog.getByTestId("storage-usage")).toContainText("브라우저 저장 공간");
  await expect(dialog.getByRole("button",{name:"남는 작품 삭제",exact:true})).toBeDisabled();
  await dialog.getByRole("button",{name:"삭제될 작품 삭제",exact:true}).click();
  await page.screenshot({path:info.outputPath("delete-confirm.png")});
  await dialog.getByRole("button",{name:"취소",exact:true}).click();
  expect(await idbIds(page)).toContain(doomed);
  await dialog.getByRole("button",{name:"삭제될 작품 삭제",exact:true}).click();
  await dialog.getByRole("button",{name:"삭제될 작품 삭제 확정",exact:true}).click();
  await expect(dialog.getByTestId("project-library-notice")).toContainText("‘삭제될 작품’을(를) 삭제했습니다");
  await expect(dialog.getByTestId("project-library-notice")).toContainText("버전 기록 1개");
  await expect(dialog.getByTestId(`project-row-${doomed}`)).toHaveCount(0);
  expect(await idbIds(page)).not.toContain(doomed);
  expect(await page.evaluate(async id=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("vnmaker.project-history",1);r.onupgradeneeded=()=>r.result.createObjectStore("versions",{keyPath:"id"});r.onsuccess=()=>resolve(r.result);});
    try{return await new Promise<number>(resolve=>{const r=db.transaction("versions").objectStore("versions").getAll();r.onsuccess=()=>resolve((r.result as {projectId:string}[]).filter(row=>row.projectId===id).length);});}finally{db.close();}
  },doomed)).toBe(0);
  await expect(page.getByLabel("작품 제목")).toHaveValue("남는 작품");
});

test("importing the same image twice keeps one card, and removing the card deletes the now-unreferenced file",async({page})=>{
  await page.goto("/studio.html");
  await createProject(page,"원화 위생 작품");
  await page.getByTestId("workspace-assets").click();
  await expect(page.getByTestId("art-library").getByTestId("storage-usage")).toContainText("브라우저 저장 공간");
  const source=resolve("packages/app/public/assets/art/rain-library.png");
  const media=`/assets/user/${createHash("sha256").update(await readFile(source)).digest("hex")}.png`;
  await page.getByTestId("art-import-files").setInputFiles(source);
  await expect(page.locator(".art-message")).toContainText("1개 원화를 가져왔습니다");
  await page.getByTestId("art-import-files").setInputFiles(source);
  await expect(page.getByTestId("art-import-notice")).toContainText("이미 라이브러리에 있는 원화 1개");
  const cards=page.locator(".art-card").filter({hasText:"rain-library"});
  await expect(cards).toHaveCount(1);
  expect(await assetPaths(page)).toContain(media);
  await cards.first().click();
  await page.getByTestId("art-remove").click();
  await expect(page.locator(".art-message").filter({hasText:"카드와 보관함 파일을 삭제했습니다"})).toBeVisible();
  await expect(page.locator(".art-card").filter({hasText:"rain-library"})).toHaveCount(0);
  await expect.poll(()=>assetPaths(page)).not.toContain(media);
});

test("a card whose file another project still uses is removed without deleting the file",async({page})=>{
  await page.goto("/studio.html");
  await createProject(page,"파일 공유 작품 A");
  await page.getByTestId("workspace-assets").click();
  const source=resolve("packages/app/public/assets/art/rain-library.png");
  const media=`/assets/user/${createHash("sha256").update(await readFile(source)).digest("hex")}.png`;
  await page.getByTestId("art-import-files").setInputFiles(source);
  await expect(page.locator(".art-message")).toContainText("1개 원화를 가져왔습니다");
  await page.getByTestId("art-apply").click();
  await expect(page.locator(".art-message")).toContainText("적용했습니다");
  await expect(page.getByTestId("art-remove")).toBeDisabled();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await createProject(page,"파일 공유 작품 B");
  await page.getByTestId("workspace-assets").click();
  await page.getByTestId("art-import-files").setInputFiles(source);
  await expect(page.locator(".art-message")).toContainText("1개 원화를 가져왔습니다");
  await page.locator(".art-card").filter({hasText:"rain-library"}).first().click();
  await page.getByTestId("art-remove").click();
  await expect(page.locator(".art-message").filter({hasText:"파일은 보관함에 남겼습니다"})).toBeVisible();
  expect(await assetPaths(page)).toContain(media);
});

test("a library originals archive can be imported back, skipping unreadable records",async({page})=>{
  await page.goto("/studio.html");
  const archive=await page.evaluate(async()=>{
    const {newProject}=await import("/src/studio/projects.ts");const {serializeLibraryArchive}=await import("/src/studio/libraryArchive.ts");
    return serializeLibraryArchive([{id:"archived-1",script:newProject("아카이브에서 돌아온 작품"),updatedAt:1_700_000_000_000},{id:"archived-broken",script:null,updatedAt:1}]);
  });
  await page.getByTestId("project-library").click();
  await page.getByTestId("project-restore-file").setInputFiles({name:"vnmaker-library-originals.json",mimeType:"application/json",buffer:Buffer.from(archive)});
  await expect(page.getByLabel("작품 제목")).toHaveValue("아카이브에서 돌아온 작품");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const ids=await idbIds(page);expect(ids).toContain("archived-1");expect(ids).not.toContain("archived-broken");
  await page.getByTestId("project-library").click();
  await expect(page.getByTestId("project-library-notice")).toContainText("작품 1개를 들여왔습니다");
  await expect(page.getByTestId("project-library-notice")).toContainText("1개는 건너뛰었습니다");
});
