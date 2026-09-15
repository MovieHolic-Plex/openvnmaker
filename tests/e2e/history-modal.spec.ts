import {test,expect} from "@playwright/test";

test("long dialogue history stays in a keyboard-readable modal and restores play position",async({page},info)=>{
  test.setTimeout(30000);
  await page.addInitScript(()=>{localStorage.setItem("vnmaker:settings",JSON.stringify({skipUnread:true}));});
  await page.addInitScript(()=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"긴 대사록",subtitle:"",start:"s",characters:[{id:"actor",name:"이서하",bio:"",color:"#b5d5ff"}],scenes:[{id:"s",chapter:"첫 번째 장",background:"title",lines:Array.from({length:60},(_,i)=>({speaker:i%2?"actor":null,text:`기록 ${i+1}: 그날의 대화를 기억한다.`})),next:"end"},{id:"end",chapter:"마지막 장",background:"title",lines:[{speaker:null,text:"읽던 자리"}],ending:"끝"}]})));
  await page.goto("/?preview=1");await page.getByTestId("skip-button").click();await expect(page.getByTestId("dialogue-text")).toHaveText("읽던 자리");
  const opener=page.getByTestId("history-button");await opener.focus();await page.keyboard.press("Enter");const panel=page.getByTestId("history-panel");
  await page.screenshot({path:info.outputPath("history-desktop.png")});
  await expect(page.getByRole("dialog",{name:"대사 기록",exact:true})).toBeVisible();await expect(page.getByTestId("backlog-close")).toBeFocused();
  const scroll=panel.getByRole("region",{name:"읽은 대사"});await expect(panel.locator(".backlog-line")).toHaveCount(60);
  await expect(panel.getByText("기록 60: 그날의 대화를 기억한다.",{exact:true})).toBeInViewport();
  await page.keyboard.press("Tab");await expect(scroll).toBeFocused();await page.keyboard.press("Home");
  await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(0);await expect(panel.getByText("기록 1: 그날의 대화를 기억한다.",{exact:true})).toBeInViewport();
  await page.keyboard.press("End");await expect(panel.getByText("기록 60: 그날의 대화를 기억한다.",{exact:true})).toBeInViewport();
  await page.keyboard.press("Tab");await expect(page.getByTestId("backlog-close")).toBeFocused();
  await page.setViewportSize({width:390,height:600});await page.screenshot({path:info.outputPath("history-mobile.png")});
  expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");await expect(panel).not.toBeVisible();await expect(opener).toBeFocused();await expect(page.getByTestId("dialogue-text")).toHaveText("읽던 자리");
  expect(await page.evaluate(()=>window.__vn?.sceneId)).toBe("end");
});

test("history before advancing shows an empty state without exposing future lines",async({page})=>{
  test.setTimeout(30000);
  await page.goto("/");await page.getByTestId("start-button").click();await page.getByTestId("history-button").click();
  const panel=page.getByTestId("history-panel");await expect(panel.getByText("아직 기록이 없다.",{exact:true})).toBeVisible();await expect(panel.locator(".backlog-line")).toHaveCount(0);
  await page.getByTestId("backlog-close").click();await expect(page.getByTestId("history-button")).toBeFocused();expect(await page.evaluate(()=>window.__vn?.lineIndex)).toBe(0);
});

test("chapter labels and selected choices survive a manual save and reload",async({page},info)=>{
  test.setTimeout(30000);
  await page.addInitScript(()=>{localStorage.setItem("vnmaker:settings",JSON.stringify({skipUnread:true}));});
  await page.addInitScript(()=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify({title:"장별 기록",subtitle:"",start:"a",characters:[],scenes:[{id:"a",chapter:"첫 번째 장",background:"title",lines:[{speaker:null,text:"처음 남긴 말"},{speaker:null,text:"두 번째 말"}],choices:[{text:"기억을 따라간다",next:"b"}]},{id:"b",chapter:"두 번째 장",background:"title",lines:[{speaker:null,text:"다음 장의 말"}],next:"c"},{id:"c",chapter:"아직 읽지 않은 장",background:"title",lines:[{speaker:null,text:"멈춘 자리"}],ending:"끝"}]})));
  await page.goto("/?preview=1");await page.getByTestId("skip-button").click();await page.getByTestId("choice-0").click();await page.getByTestId("skip-button").click();
  await page.getByTestId("save-button").click();await page.getByTestId("slot-save-0").click();await page.reload();
  await page.getByTestId("load-button").click();await page.getByTestId("slot-load-0").click();await expect(page.getByTestId("dialogue-text")).toHaveText("멈춘 자리");
  await page.getByTestId("history-button").click();const panel=page.getByTestId("history-panel");
  await expect(panel.getByTestId("backlog-chapter")).toHaveText(["첫 번째 장","두 번째 장"]);await expect(panel).toContainText("▷ 기억을 따라간다");await expect(panel).not.toContainText("아직 읽지 않은 장");
  await page.setViewportSize({width:390,height:700});await page.screenshot({path:info.outputPath("history-chapters-restored.png")});
  await page.keyboard.press("Escape");expect(await page.evaluate(()=>window.__vn?.sceneId)).toBe("c");
});

test("loading after a manuscript update identifies the snapshot and retains its original choice and history",async({page},info)=>{
  const original={title:"출시본",subtitle:"",start:"a",flags:{trust:0},characters:[],scenes:[{id:"a",chapter:"기억",background:"title",lines:[{speaker:null,text:"저장에 남길 첫 문장"},{speaker:null,text:"이전 판본의 선택 직전"}],choices:[{text:"출시 당시의 선택",next:"b",set:{trust:1}}]},{id:"b",background:"title",lines:[{speaker:null,text:"출시 당시의 결말"}],ending:"원래 결말"}]};
  await page.goto("/");await page.evaluate(source=>{sessionStorage.setItem("vnmaker.previewScript",JSON.stringify(source));localStorage.setItem("vnmaker:settings",JSON.stringify({skipUnread:true}));},original);await page.goto("/?preview=1");
  await page.getByTestId("skip-button").click();await page.getByTestId("save-button").click();await page.getByTestId("slot-save-0").click();
  const revised=structuredClone(original);revised.scenes[0]!.lines.unshift({speaker:null,text:"업데이트에서 삽입한 문장"});revised.scenes[0]!.choices![0]!.text="업데이트된 선택";
  await page.evaluate(source=>sessionStorage.setItem("vnmaker.previewScript",JSON.stringify(source)),revised);await page.reload();
  await expect(page.getByTestId("dialogue-text")).toHaveText("업데이트에서 삽입한 문장");
  await page.getByTestId("load-button").click();await expect(page.getByTestId("slot-row-0")).toContainText("현재 재생 원고와 다른 저장본");
  await page.setViewportSize({width:390,height:844});await expect(page.getByTestId("slot-row-0").locator(".slot-version-note")).toBeInViewport();await page.screenshot({path:info.outputPath("snapshot-version-mobile.png")});
  await page.getByTestId("slot-load-0").click();await expect(page.getByTestId("choice-0")).toContainText("출시 당시의 선택");
  await expect(page.getByRole("status")).toContainText("저장 당시의 원고로 이어갑니다");expect(await page.evaluate(()=>window.__vn!.lineIndex)).toBe(1);
  await page.getByTestId("history-button").click();await expect(page.getByTestId("history-panel").locator(".backlog-line")).toHaveCount(2);await expect(page.getByTestId("history-panel")).not.toContainText("업데이트에서 삽입한 문장");await page.keyboard.press("Escape");
  await page.getByTestId("choice-0").click();await expect(page.getByTestId("dialogue-text")).toHaveText("출시 당시의 결말");expect(await page.evaluate(()=>window.__vn!.flags)).toEqual({trust:1});
});
