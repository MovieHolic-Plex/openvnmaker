import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {applyChoiceFlags,parseScript,lineAllowed} from "@vnmaker/content";
import {backgroundAt,bgmAt,cgAt,spritesAt,framingAt} from "../src/engine/selectors.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass a native project directory.");
const directory=path.resolve(process.argv[2]);
const script=parseScript(JSON.parse(await readFile(path.join(directory,"game/project.json"),"utf8")));
let scene=script.scenes.find(scene=>scene.id===script.start)!;
const seen=new Set<string>();
while(!scene.choices?.length){if(seen.has(scene.id)||!scene.next)throw new Error("A reachable branch is required.");seen.add(scene.id);scene=script.scenes.find(candidate=>candidate.id===scene.next)!;}
const [first,second]=scene.choices.filter(choice=>!choice.disable);
if(!first||!second||first.cond||second.cond)throw new Error("Two unconditional choices are required.");
const before=script.flags??{};
const firstFlags=applyChoiceFlags(before,first),secondFlags=applyChoiceFlags(before,second);
const firstScene=script.scenes.find(scene=>scene.id===first.next)!;
const secondScene=script.scenes.find(scene=>scene.id===second.next)!;
const firstLine=firstScene.lines.find(line=>lineAllowed(line,firstFlags))!;
const secondLine=secondScene.lines.find(line=>lineAllowed(line,secondFlags))!;
const json=(value:unknown)=>`json.loads(${JSON.stringify(JSON.stringify(value))})`;
const last=scene.lines.length-1;
const background=backgroundAt(scene,last,before)??`assets/bg/${scene.background}.png`;
const actors=Object.fromEntries(spritesAt(scene,last,before).map(actor=>[actor.slot,actor]));
const music=bgmAt(scene,last,before);
const restoredChecks=[
  '    assert screen "choice"',
  `    assert eval vn_flags == ${json(before)}`,
  `    assert eval vn_background == ${JSON.stringify(background)}`,
  `    assert eval vn_cg == ${json(cgAt(scene,last,before)??null)}`,
  `    assert eval vn_framing == ${JSON.stringify(framingAt(scene,last,before))}`,
  `    assert eval {key: value for key, value in vn_slots.items() if value.get("character")} == ${json(actors)}`,
  '    pause .5',
  '    $ renpy.log("QA music=" + repr(renpy.music.get_playing()))',
  `    assert eval renpy.music.get_playing() == ${json(music?`assets/audio/bgm/${music}.mp3`:null)}`,
  `    move ${renpyText(first.text)}`,
  '    pause .1',
  '    screenshot "choice-state.png" max_pixel_difference 0.001 crop (0, 0, 900, 400)',
];
await writeFile(path.join(directory,"game/vn_qa.rpy"),[
  "testsuite global:","    teardown:","        exit","",
  "testcase save_roundtrip:","    $ _test.timeout = 30","    $ _test.transition_timeout = .01",'    $ _test.screenshot_directory = "tests/save-qa"',"    $ preferences.text_cps = 0","    run Start()",'    advance until screen "choice"',
  ...restoredChecks,'    run ShowMenu("save")',"    pause .3","    run FileSave(1, confirm=False)",'    assert eval renpy.can_load("1-1")','    screenshot "saved-before-choice.png"','    click "돌아가기"',
  `    click ${renpyText(first.text)}`,`    assert ${renpyText(firstLine.text)}`,`    assert eval vn_flags == ${json(firstFlags)}`,
  '    click "되감기"',...restoredChecks,'    screenshot "rolled-back-choice.png"',
  `    click ${renpyText(second.text)}`,`    assert ${renpyText(secondLine.text)}`,`    assert eval vn_flags == ${json(secondFlags)}`,
  '    run ShowMenu("load")',"    pause .3","    run FileLoad(1, confirm=False)",...restoredChecks,'    screenshot "loaded-original-choice.png"',
  `    click ${renpyText(first.text)}`,`    assert ${renpyText(firstLine.text)}`,`    assert eval vn_flags == ${json(firstFlags)}`,
  '    screenshot "continued-after-load.png"',""
].join("\n"));
console.log(`Wrote native save/rollback test at ${scene.id}.`);
