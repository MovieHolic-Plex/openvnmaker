import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {applyChoiceFlags,parseScript} from "@vnmaker/content";
import {VN_WAIT_READY_LINE} from "../src/studio/nativeParity.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass a native project directory.");
const directory=path.resolve(process.argv[2]);
const script=parseScript(JSON.parse(await readFile(path.join(directory,"game/project.json"),"utf8")));
let scene=script.scenes.find(scene=>scene.id===script.start)!;
const seen=new Set<string>(),route:string[]=[];
let secondFlags:Record<string,string|number|boolean>|undefined;
while(!scene.ending||scene.choices?.length){
  if(seen.has(scene.id))throw new Error("Theme QA requires an acyclic first route.");seen.add(scene.id);
  const choices=scene.choices?.filter(choice=>!choice.disable)??[];
  if(choices.length){if(secondFlags===undefined&&choices[1])secondFlags=applyChoiceFlags(script.flags??{},choices[1]);route.push(choices[0]!.text);scene=script.scenes.find(scene=>scene.id===choices[0]!.next)!;}
  else if(scene.next)scene=script.scenes.find(candidate=>candidate.id===scene.next)!;
  else throw new Error("No ending on the first route.");
}
if(!secondFlags)throw new Error("A first branch with two choices is required.");
const lines=["testsuite global:","    teardown:","        exit","",
"testcase keyboard_choice:","    $ _test.timeout = 30","    $ _test.transition_timeout = .01","    $ preferences.text_cps = 0","    run Start()",'    advance until screen "choice"',VN_WAIT_READY_LINE,'    screenshot "choice-panel.png"',
// Explicit coordinates keep the harness from picking a random pointer position before a key.
'    keysym "K_DOWN" pos (0, 0)','    keysym "K_DOWN" pos (0, 0)',VN_WAIT_READY_LINE,'    screenshot "keyboard-choice.png"','    keysym "K_RETURN" pos (0, 0)','    assert not screen "choice"',`    assert eval vn_flags == json.loads(${JSON.stringify(JSON.stringify(secondFlags))})`,VN_WAIT_READY_LINE,'    screenshot "keyboard-continued.png"',"",
"testcase ending_panel:","    $ _test.timeout = 90","    $ _test.transition_timeout = .01","    $ preferences.text_cps = 0","    run Start()"];
for(const caption of route)lines.push('    advance until screen "choice"',`    click ${renpyText(caption)}`);
lines.push('    advance until screen "vn_ending"',VN_WAIT_READY_LINE,`    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == ${JSON.stringify(scene.ending)}`,'    screenshot "ending-panel.png"','    click "대사록"','    assert screen "history"','    click "돌아가기"','    assert screen "vn_ending"','    click "타이틀로"','    assert screen "main_menu"',VN_WAIT_READY_LINE,'    screenshot "returned-title.png"',"",
'default vn_theme_result = -1',
'label vn_theme_fixture:',`    $ vn_enter(0)`,
'    $ vn_theme_items = [type("ThemeChoice", (), {"caption": "선택지 %d: 충분히 긴 문장이 여러 줄로 이어져도 끝까지 읽고 원하는 결정을 내릴 수 있어야 합니다." % (index + 1), "action": Return(index)})() for index in range(8)]',
'    call screen choice(vn_theme_items)',
'    $ vn_theme_result = _return',
'    "선택 완료"',"    return","",
'testcase long_choices:',"    $ _test.timeout = 30",'    run Start("vn_theme_fixture")', '    assert screen "choice"',VN_WAIT_READY_LINE,'    screenshot "long-choices-top.png"','    keysym "K_PAGEDOWN" pos (0, 0)','    keysym "K_PAGEDOWN" pos (0, 0)',VN_WAIT_READY_LINE,'    screenshot "long-choices-bottom.png"','    click "선택지 8:"','    assert "선택 완료"','    assert eval vn_theme_result == 7',"");
await writeFile(path.join(directory,"game/vn_qa.rpy"),lines.join("\n"));
console.log("Wrote keyboard, ending and long-choice native theme tests.");
