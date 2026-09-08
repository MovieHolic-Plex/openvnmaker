import {test, expect, type Page} from "@playwright/test";
import {canonicalHash} from "../../packages/harness/src/canonical.js";
test.setTimeout(30_000);

const legacy = {title:"Legacy manuscript",subtitle:"",start:"start",characters:[],scenes:[{id:"start",background:"title",lines:[{speaker:null,text:"Unnumbered original"}],ending:"End"}]};
const damaged = {id:"damaged-original",updatedAt:7,script:{broken:true}};

async function seedV1(page:Page) {
  await page.route("**/storage-seed", route=>route.fulfill({contentType:"text/html",body:"<!doctype html><title>Storage seed</title>"}));
  await page.goto("/storage-seed");
  await page.evaluate(async ({legacy,damaged})=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open("vnmaker.projects",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("projects",{keyPath:"id"});
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try {await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction("projects","readwrite");
      tx.objectStore("projects").put({id:"legacy",updatedAt:42,script:legacy});
      tx.objectStore("projects").put(damaged);
      tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);
    });} finally {db.close();}
    localStorage.setItem("vnmaker.studio.active-project.v1","legacy");
    localStorage.setItem("vnmaker.studio.project.v1",JSON.stringify(legacy));
  },{legacy,damaged});
}

async function databaseState(page:Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{
      const request=indexedDB.open("vnmaker.projects");
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
    try {return await new Promise<{version:number;stores:string[];records:unknown[];heads:unknown[];production:unknown[]}>((resolve,reject)=>{
      const stores=Array.from(db.objectStoreNames),tx=db.transaction(stores);
      const records=tx.objectStore("projects").getAll();
      const heads=stores.includes("project-heads")?tx.objectStore("project-heads").getAll():null;
      const production=stores.includes("production-documents")?tx.objectStore("production-documents").getAll():null;
      tx.oncomplete=()=>resolve({version:db.version,stores,records:records.result,heads:heads?.result??[],production:production?.result??[]});
      tx.onabort=()=>reject(tx.error);
    });} finally {db.close();}
  });
}

test("characterize-v1-library-manual-undo-recovery",async({page},info)=>{
  // Given a real v1 library, seeded before any studio code runs.
  await seedV1(page);await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  // When an author edits, undoes, then recovers a damaged quick mirror.
  await page.getByLabel("작품 제목").fill("Manual change");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.getByTestId("studio-undo").click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.evaluate(()=>localStorage.setItem("vnmaker.studio.project.v1","{damaged-mirror"));
  await page.reload();await page.getByRole("button",{name:"이 보관함 원고로 복구"}).click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  // Then the original manuscript and unrelated damaged row survive.
  await expect(page.getByLabel("작품 제목")).toHaveValue(legacy.title);
  const state=await databaseState(page);
  expect(state.records).toContainEqual(damaged);
  expect(state.records).toContainEqual(expect.objectContaining({id:"legacy",script:legacy}));
  await info.attach("database",{body:JSON.stringify(state,null,2),contentType:"application/json"});
  await page.screenshot({path:info.outputPath("characterization.png")});
});

test("migrate-v1-and-flush",async({page},info)=>{
  // Given existing manuscripts without narrative IDs and a damaged original.
  await seedV1(page);await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const migrated=await databaseState(page);
  expect(migrated.version).toBe(2);
  expect(migrated.stores).toEqual(["production-documents","project-heads","projects","proposal-decisions"]);
  expect(migrated.records).toContainEqual({id:"legacy",script:legacy,updatedAt:42});
  expect(migrated.records).toContainEqual(damaged);
  expect(migrated.heads).toEqual([expect.objectContaining({projectId:"legacy",revision:0,scriptHash:await canonicalHash(legacy)})]);
  // When the actual editor changes and explicitly flushes the displayed draft.
  await page.getByLabel("작품 제목").fill("Durable edit");
  const receipt=await page.evaluate(async()=>{
    const modulePath="/src/studio/projects.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projects.js")=await import(modulePath);
    return projectRepository.current().flushCurrent();
  });
  // Then the receipt names the displayed revision, not just an older completed save.
  expect(receipt.script.title).toBe("Durable edit");expect(receipt.head.revision).toBe(1);
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  await page.getByTestId("studio-undo").click();
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const undone=await databaseState(page);
  expect(undone.heads).toEqual([expect.objectContaining({revision:2,scriptHash:expect.any(String)})]);
  await info.attach("migrated",{body:JSON.stringify(migrated,null,2),contentType:"application/json"});
  await info.attach("undone",{body:JSON.stringify(undone,null,2),contentType:"application/json"});
  await page.screenshot({path:info.outputPath("durable-editor.png")});
});

test("queued-save-cannot-overwrite",async({page})=>{
  // Given a live editor and an old request held during hashing, before its write transaction.
  await seedV1(page);await page.goto("/studio.html");
  await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const result=await page.evaluate(async()=>{
    const modulePath="/src/studio/projects.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projects.js")=await import(modulePath);
    if(!projectRepository)throw new Error("projectRepository API is not implemented");
    const repository=projectRepository.current();
    const original=crypto.subtle.digest.bind(crypto.subtle);
    const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();
    let held=true;
    crypto.subtle.digest=async function(algorithm,data){
      if(held){held=false;entered.resolve();await release.promise;}
      return original(algorithm,data);
    };
    try {
      const old=repository.stage({...repository.snapshot.script,title:"Old request"});
      const saving=repository.save(old).then(()=>"saved",(error:Error)=>error.name);
      await entered.promise;
      repository.invalidate();
      repository.stage({...repository.snapshot.script,title:"Current request"});
      const current=repository.flushCurrent();
      release.resolve();
      return {old:await saving,current:await current};
    } finally {release.resolve();crypto.subtle.digest=original;}
  });
  // When the obsolete generation is released, then it is rejected and the newer draft wins.
  expect(result.old).toBe("StaleGenerationError");
  expect(result.current.script.title).toBe("Current request");
  const state=await databaseState(page);
  expect(state.records).toContainEqual(expect.objectContaining({id:"legacy",script:expect.objectContaining({title:"Current request"})}));
});

test("flush rejects a head replaced by another repository even without pending edits",async({page})=>{
  // Given two snapshots of the same durable head.
  await seedV1(page);await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const result=await page.evaluate(async()=>{
    const modulePath="/src/studio/projectRepository.ts";
    const {projectRepository,ProjectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(modulePath);
    const current=projectRepository.current(),other=new ProjectRepository(current.snapshot);
    // When another writer commits a production-only revision.
    await other.commit({generation:other.current.generation,expectedHead:other.snapshot.head,script:other.snapshot.script,productionDocument:{...other.snapshot.productionDocument,brief:"Committed canon"}});
    return current.flushCurrent().then(()=>"acknowledged",(error:{code:string})=>error.code);
  });
  // Then a cached head cannot authorize downstream work.
  expect(result).toBe("stale-head");
});

test("a divergent recovery mirror is preserved for explicit recovery",async({page})=>{
  // Given an unsaved but valid recovery mirror newer than the library.
  await seedV1(page);
  const mirror=JSON.stringify({...legacy,title:"Unflushed recovery"});
  await page.evaluate(mirror=>localStorage.setItem("vnmaker.studio.project.v1",mirror),mirror);
  // When the editor reloads from its durable source.
  await page.goto("/studio.html");
  // Then it requests recovery instead of silently destroying either version.
  await expect(page.getByRole("region",{name:"원고 복구"})).toBeVisible();
  await expect(page.getByLabel("작품 제목")).toHaveValue(legacy.title);
  expect(await page.evaluate(()=>localStorage.getItem("vnmaker.studio.project.v1"))).toBe(mirror);
  expect((await databaseState(page)).records).toContainEqual({id:"legacy",updatedAt:42,script:legacy});
});

test("flush declines admission when a newer displayed revision arrives during hashing",async({page})=>{
  // Given a flush held outside its transaction.
  await seedV1(page);await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const result=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current(),digest=crypto.subtle.digest.bind(crypto.subtle);
    const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>();let held=true;
    crypto.subtle.digest=async(algorithm,data)=>{if(held){held=false;entered.resolve();await release.promise;}return digest(algorithm,data);};
    try{
      repository.stage({...repository.snapshot.script,title:"First"});
      const flushing=repository.flushCurrent().then(()=>"acknowledged",(error:Error)=>error.name);
      await entered.promise;
      // When a newer revision is displayed before that flush completes.
      repository.stage({...repository.snapshot.script,title:"Second"});release.resolve();
      return {old:await flushing,current:await repository.flushCurrent()};
    }finally{release.resolve();crypto.subtle.digest=digest;}
  });
  // Then only a new flush can acknowledge the newest input.
  expect(result.old).toBe("CurrentRevisionChangedError");expect(result.current.script.title).toBe("Second");expect(result.current.head.revision).toBe(2);
});

test("an aborted atomic commit preserves source and head, then an explicit retry succeeds",async({page})=>{
  // Given a production-only commit with a fault after all three real IDB puts.
  await seedV1(page);await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const before=await databaseState(page);
  const failure=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current(),put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){const request=put.call(this,value,key);if(this.name==="production-documents")throw new DOMException("Injected quota failure","QuotaExceededError");return request;};
    try{return await repository.commit({generation:repository.current.generation,expectedHead:repository.snapshot.head,script:repository.snapshot.script,productionDocument:{...repository.snapshot.productionDocument,brief:"Approved source canon"}}).then(()=>"saved",(error:Error)=>error.name);}
    finally{IDBObjectStore.prototype.put=put;}
  });
  // When the transaction aborts, then none of its writes survive.
  expect(failure).toBe("QuotaExceededError");expect(await databaseState(page)).toEqual(before);
  const retried=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current();
    return repository.commit({generation:repository.current.generation,expectedHead:repository.snapshot.head,script:repository.snapshot.script,productionDocument:{...repository.snapshot.productionDocument,brief:"Approved source canon"}});
  });
  const expectedDocument={version:1,brief:"Approved source canon",castCanon:[],worldTimeline:[],branchFacts:[],outline:{title:legacy.title,subtitle:"",bible:"",start:legacy.start,scenes:[]},artDirection:[],referenceBindings:[]};
  expect(retried.head.revision).toBe(1);expect(retried.head.scriptHash).toBe(await canonicalHash(legacy));expect(retried.head.productionHash).toBe(await canonicalHash(expectedDocument));
  expect((await databaseState(page)).production).toContainEqual({projectId:"legacy",document:expectedDocument});
});

test("blocked upgrades preserve v1 originals and recover after the blocking connection closes",async({page,context})=>{
  // Given a legacy connection kept open in a separate same-origin document.
  await seedV1(page);
  await page.evaluate(async()=>{
    const request=indexedDB.open("vnmaker.projects",1);
    await new Promise<void>((resolve,reject)=>{request.onsuccess=()=>{
      addEventListener("close-legacy",()=>request.result.close(),{once:true});
      addEventListener("inspect-legacy",()=>{const read=request.result.transaction("projects").objectStore("projects").getAll();read.onsuccess=()=>dispatchEvent(new CustomEvent("legacy-records",{detail:read.result}));},{once:true});resolve();
    };request.onerror=()=>reject(request.error);});
  });
  const editor=await context.newPage();
  try{
    // When studio requests v2, then no source is changed while the upgrade is blocked.
    await editor.goto("/studio.html");await expect(editor.getByRole("region",{name:"원고 복구"})).toBeVisible();
    const records=await page.evaluate(()=>new Promise<unknown>(resolve=>{addEventListener("legacy-records",event=>{if(event instanceof CustomEvent)resolve(event.detail);},{once:true});dispatchEvent(new Event("inspect-legacy"));}));
    expect(records).toContainEqual({id:"legacy",updatedAt:42,script:legacy});
    await page.evaluate(()=>dispatchEvent(new Event("close-legacy")));
    await editor.reload();await expect(editor.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
    expect((await databaseState(editor)).version).toBe(2);
  }finally{await page.evaluate(()=>dispatchEvent(new Event("close-legacy")));await editor.close();}
});

test("an edit during the commit transaction aborts replacement without discarding the input",async({page})=>{
  // Given an input event queued after the CAS checks but before transaction completion.
  await seedV1(page);await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const result=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const repository=projectRepository.current(),put=IDBObjectStore.prototype.put;let queued=false;
    IDBObjectStore.prototype.put=function(value,key){
      const request=put.call(this,value,key);
      if(this.name==="project-heads"&&!queued){queued=true;queueMicrotask(()=>repository.stage({...repository.snapshot.script,title:"Input wins"}));}
      return request;
    };
    try {
      // When a source replacement races that input.
      return await repository.commit({generation:repository.current.generation,expectedHead:repository.snapshot.head,script:{...repository.snapshot.script,title:"Replacement"},productionDocument:repository.snapshot.productionDocument}).then(()=>"committed",(error:Error)=>error.name);
    }finally{IDBObjectStore.prototype.put=put;}
  });
  // Then the replacement is aborted, not used to invalidate the new edit.
  expect(result).toBe("CurrentRevisionChangedError");
  expect((await databaseState(page)).records).toContainEqual({id:"legacy",updatedAt:42,script:legacy});
});

test("concurrent opens share one project sequencer",async({page})=>{
  // Given an unmigrated project and two consumers starting together.
  await seedV1(page);
  // When both request its repository.
  const shared=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const [first,second]=await Promise.all([projectRepository.open("legacy"),projectRepository.open("legacy")]);
    return first===second;
  });
  // Then metadata migration and future writes have one in-document owner.
  expect(shared).toBe(true);
});

test("operational connections close on versionchange",async({page})=>{
  // Given a repository connection left open when a future version is requested.
  await seedV1(page);
  const version=await page.evaluate(async()=>{
    const path="/src/studio/projects.ts";
    const {database}:typeof import("../../packages/app/src/studio/projects.js")=await import(path);
    const connection=await database();
    try{return await new Promise<number>((resolve,reject)=>{
      // When IndexedDB dispatches versionchange.
      const upgrade=indexedDB.open("vnmaker.projects",3);
      upgrade.onsuccess=()=>{const db=upgrade.result;resolve(db.version);db.close();};
      upgrade.onerror=()=>reject(upgrade.error);upgrade.onblocked=()=>reject(new Error("Operational connection blocked upgrade"));
    });}finally{connection.close();}
  });
  // Then it does not hold a future upgrader hostage.
  expect(version).toBe(3);
});

test("a stale repository cannot overwrite a newer durable head",async({page})=>{
  // Given a second repository that has already advanced the durable source.
  await seedV1(page);await page.goto("/studio.html");await expect(page.getByTestId("studio-save-state")).toHaveText("로컬 저장됨");
  const outcome=await page.evaluate(async()=>{
    const path="/src/studio/projectRepository.ts";
    const {projectRepository,ProjectRepository}:typeof import("../../packages/app/src/studio/projectRepository.js")=await import(path);
    const stale=projectRepository.current(),writer=new ProjectRepository(stale.snapshot);
    await writer.commit({generation:writer.current.generation,expectedHead:writer.snapshot.head,script:{...writer.snapshot.script,title:"Committed newer"},productionDocument:writer.snapshot.productionDocument});
    // When the stale owner attempts an ordinary save.
    stale.stage({...stale.snapshot.script,title:"Rejected stale"});
    return stale.save().then(()=>"saved",(error:unknown)=>error instanceof Error&&"code" in error?error.code:"unexpected");
  });
  // Then CAS rejects at the real transaction and retains the committed manuscript.
  expect(outcome).toBe("stale-head");expect((await databaseState(page)).records).toContainEqual(expect.objectContaining({id:"legacy",script:expect.objectContaining({title:"Committed newer"})}));
});
