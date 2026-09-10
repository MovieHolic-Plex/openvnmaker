import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {parseScript} from "@vnmaker/content";
import {VN_WAIT_READY_LINE} from "../src/studio/nativeParity.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass a native project with an authored artwork credit.");
const dir=path.resolve(process.argv[2]);
const script=parseScript(JSON.parse(await readFile(path.join(dir,"game/project.json"),"utf8")));
const asset=script.assets?.find(asset=>asset.provenance?.credit);
if(!asset?.provenance?.credit)throw new Error("Use an exported project with an authored artwork credit.");
const first=script.scenes.find(scene=>scene.id===script.start)!;
const out=['testsuite global:','    setup:','        $ _test.screenshot_directory = "tests/screenshots/credits-" + str(__import__("time").time_ns())','    teardown:','        exit','','testcase player_credits:','    $ preferences.text_cps = 0','    click "버전정보"','    assert screen "about"',`    assert ${renpyText(asset.provenance.credit)}`,VN_WAIT_READY_LINE,'    screenshot "native-credits-title.png"','    click "돌아가기"','    assert screen "main_menu"','    run Start()',`    assert ${renpyText(first.lines[0]!.text)}`,VN_WAIT_READY_LINE,'    screenshot "native-credits-toolbar.png"','    click "크레딧"','    assert screen "about"',`    assert ${renpyText(asset.provenance.credit)}`,'    click "돌아가기"',`    assert ${renpyText(first.lines[0]!.text)}`];
let scene=first;
const visited=new Set<string>();
while(!scene.ending){if(visited.has(scene.id))throw new Error("Fixture route loops");visited.add(scene.id);const choice=scene.choices?.[0];if(choice)out.push('    advance until screen "choice"',`    click ${renpyText(choice.text)}`);scene=script.scenes.find(row=>row.id===(choice?.next??scene.next))!;if(!scene)throw new Error("No ending route");}
out.push('    advance until screen "vn_ending"','    click "크레딧"','    assert screen "about"',`    assert ${renpyText(asset.provenance.credit)}`,'    click "돌아가기"','    assert screen "vn_ending"',VN_WAIT_READY_LINE,'    screenshot "native-credits-ending.png"','    click "타이틀로"','    assert screen "main_menu"','');
out.push('testcase literal_credits:','    $ vn_qa_original_media = vn_media_credits','    $ vn_media_credits = [{"name": "Literal credit", "provenance": {"credit": "[missing_variable] {b}literal{/b}", "creator": "Tester"}}]','    click "버전정보"','    assert screen "about"','    assert "[missing_variable] {b}literal{/b}"',VN_WAIT_READY_LINE,'    screenshot "native-credits-literal.png"','    $ vn_media_credits = vn_qa_original_media','');
if(script.credits?.some(credit=>credit.names.trim())){
  out.push('testcase team_credits:','    click "버전정보"','    assert screen "about"');
  script.credits.forEach((credit,index)=>{if(credit.names.trim())out.push(`    assert eval renpy.get_widget("about", "vn_credit_names_${index}").get_all_text() == ${JSON.stringify(credit.names)}`);});
  out.push(VN_WAIT_READY_LINE,'    screenshot "native-team-credits-authored.png"','');
}
await writeFile(path.join(dir,"game/vn_qa.rpy"),out.join("\n"));
