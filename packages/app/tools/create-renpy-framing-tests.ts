import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {parseScript} from "@vnmaker/content";
import {renpyText} from "../src/studio/renpyScript.js";
const directory=resolve(process.argv[2]!);const script=parseScript(JSON.parse(await readFile(join(directory,"game/project.json"),"utf8"))),lines=script.scenes[0]!.lines;
if(lines.length!==7)throw new Error("Use the framing fixture.");
const bars=(present:boolean)=>[`    assert eval bool(renpy.showing("vn_bar_top")) == ${present?"True":"False"}`,`    assert eval bool(renpy.showing("vn_bar_bottom")) == ${present?"True":"False"}`];
const actors=(present:boolean)=>[`    assert eval bool(renpy.showing("vn_left")) == ${present?"True":"False"}`,`    assert eval bool(renpy.showing("vn_right")) == ${present?"True":"False"}`];
const portrait=()=>['    move pos (0, 0)',...bars(true),...actors(false),'    assert eval renpy.get_image_bounds("vn_background")[2] < 1280 and abs(renpy.get_image_bounds("vn_background")[3] - 720) < 1',`    assert eval vn_cg == ${JSON.stringify(lines[4]!.cgUrl)}`,'    pause .3','    screenshot "portrait-state.png" max_pixel_difference 0.001 crop (0, 0, 900, 400)'];
const out=['testsuite global:','    teardown:','        exit','','testcase framing:','    $ preferences.text_cps = 0','    $ _test.timeout = 45','    $ _test.screenshot_directory = "tests/framing-v3"','    $ renpy.set_physical_size((960, 540))','    pause .5','    run Start()','    pause .5'];
for(let index=0;index<7;index++){
  if(index)out.push(`    advance until ${renpyText(lines[index]!.text)}`);out.push(`    assert ${renpyText(lines[index]!.text)}`,...bars(index===1||index===3||index===4),...actors(index!==3&&index!==4),'    pause .3',`    screenshot "framing-${index}.png"`);
  if(index===2||index===5)out.push('    assert eval renpy.get_image_bounds("vn_background")[2] > 1280 and renpy.get_image_bounds("vn_background")[3] > 720');
  if(index===4)out.push(...portrait(),'    run ShowMenu("save")','    run FileSave(1, confirm=False)','    assert eval renpy.can_load("1-1")','    click "돌아가기"');
  if(index===5)out.push('    click "되감기"',...portrait(),`    advance until ${renpyText(lines[5]!.text)}`);
}
out.push('    run ShowMenu("load")','    run FileLoad(1, confirm=False)',...portrait(),'');
await writeFile(join(directory,"game/vn_qa.rpy"),out.join("\n"));
