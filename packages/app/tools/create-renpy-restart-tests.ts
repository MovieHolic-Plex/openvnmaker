import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {applyChoiceFlags,choiceAllowed,lineAllowed,parseScript,type Scene,type StoryFlags} from "@vnmaker/content";
import {backgroundAt,bgmAt,cgAt,spritesAt,framingAt} from "../src/engine/selectors.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass a disposable extracted native game directory.");
const directory=path.resolve(process.argv[2]);
const script=parseScript(JSON.parse(await readFile(path.join(directory,"game/project.json"),"utf8")));
const byId=new Map(script.scenes.map(scene=>[scene.id,scene]));
const checkpoints:{scene:Scene;flags:StoryFlags;route:string[];affection:number}[]=[];
function walk(id:string,flags:StoryFlags,route:string[],affection:number,visited:Set<string>){
  if(visited.has(id))throw new Error("Restart QA requires bounded acyclic routes.");
  const scene=byId.get(id);if(!scene)throw new Error(`Missing scene ${id}`);
  const nextVisited=new Set([...visited,id]);
  if(scene.choices?.length){
    if(checkpoints.length>=64)throw new Error("More than 64 branch checkpoints; select a bounded QA manuscript.");
    const choices=scene.choices.filter(choice=>choiceAllowed(choice,flags));if(!choices.length)throw new Error(`No available choice in ${id}`);
    checkpoints.push({scene,flags,route,affection});
    for(const choice of choices)walk(choice.next,applyChoiceFlags(flags,choice),[...route,choice.text],affection+(choice.affection??0),nextVisited);
  }else if(!scene.ending&&scene.next)walk(scene.next,flags,route,affection,nextVisited);
}
walk(script.start,script.flags??{},[],0,new Set());
if(!checkpoints.length)throw new Error("The manuscript has no branch checkpoints.");
const json=(value:unknown)=>`json.loads(${JSON.stringify(JSON.stringify(value))})`;
const out=['testsuite global:','    teardown:','        exit',''];
checkpoints.forEach(({scene,flags,route,affection},index)=>{
  const number=index+1,last=scene.lines.length-1;
  const first=scene.choices!.find(choice=>choiceAllowed(choice,flags))!;
  const firstFlags=applyChoiceFlags(flags,first);
  const target=byId.get(first.next)!;
  const nextLine=target.lines.find(line=>lineAllowed(line,firstFlags));
  if(!nextLine)throw new Error(`Checkpoint ${number}: target needs a visible line for the continuation assertion.`);
  const lastLine=[...scene.lines].reverse().find(line=>lineAllowed(line,flags));
  if(!lastLine)throw new Error(`Checkpoint ${number}: source needs a visible line for the history assertion.`);
  const common=[
    '    assert screen "choice"',
    `    assert eval vn_flags == ${json(flags)}`,
    `    assert eval vn_affection == ${affection}`,
    `    assert eval vn_background == ${json(backgroundAt(scene,last,flags)??`assets/bg/${scene.background}.png`)}`,
    `    assert eval vn_cg == ${json(cgAt(scene,last,flags)??null)}`,
    `    assert eval vn_framing == ${json(framingAt(scene,last,flags))}`,
    `    assert eval {key: value for key, value in vn_slots.items() if value.get("character")} == ${json(Object.fromEntries(spritesAt(scene,last,flags).map(actor=>[actor.slot,actor])))}`,
    `    assert eval _history_list[-1].what == ${renpyText(lastLine.text)}`,
    '    pause .5',
    `    assert eval renpy.music.get_playing() == ${json(bgmAt(scene,last,flags)?`assets/audio/bgm/${bgmAt(scene,last,flags)}.mp3`:null)}`,
    `    move ${renpyText(first.text)}`,'    pause .1',
    `    screenshot "checkpoint-${number}.png" max_pixel_difference 0.001 crop (0, 0, 900, 400)`
  ];
  const setup=(name:string)=>[`testcase ${name}_${number}:`,'    $ _test.timeout = 90','    $ _test.transition_timeout = .01','    $ _test.screenshot_directory = "tests/restart-qa"','    $ preferences.text_cps = 0'];
  out.push(...setup('write'),'    run Start()');
  for(const caption of route)out.push('    advance until screen "choice"',`    click ${renpyText(caption)}`);
  // Finish in the story context. Exiting the Ren'Py 8.5.3 test runner inside
  // ShowMenu's nested context can leave its completed EndPhase spinning.
  out.push('    advance until screen "choice"',...common,'    run ShowMenu("save")','    run FileSave(1, confirm=False)','    assert eval renpy.can_load("1-1")','    click "돌아가기"','    assert screen "choice"','');
  out.push(...setup('resume'),'    assert screen "main_menu"','    assert eval renpy.can_load("1-1")','    run FileLoad(1, confirm=False)',...common,
    `    click ${renpyText(first.text)}`,'    pause .6',`    assert ${renpyText(nextLine.text)}`,`    assert eval vn_flags == ${json(firstFlags)}`,
    '    click "되감기"',...common,'');
});
await writeFile(path.join(directory,"game/vn_qa.rpy"),out.join("\n"));
await writeFile(path.join(directory,"restart-checkpoints.json"),JSON.stringify(checkpoints.map(({scene,flags,route},i)=>({checkpoint:i+1,scene:scene.id,priorChoices:route,flags})),null,2));
console.log(`Wrote ${checkpoints.length} checkpoint pairs. Run write_N then resume_N in separate processes sharing an isolated savedir per pair. Use a fresh screenshots directory; do not overwrite screenshot baselines.`);
