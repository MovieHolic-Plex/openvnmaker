import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {applyChoiceFlags,choiceAllowed,parseScript,type StoryFlags} from "@vnmaker/content";
import {renpyText} from "../src/studio/renpyScript.js";
const directory=path.resolve(process.argv[2]??"");
const script=parseScript(JSON.parse(await readFile(path.join(directory,"game/project.json"),"utf8")));
const routes:{choices:string[];ending:string;flags:StoryFlags}[]=[];
function walk(id:string,choices:string[],flags:StoryFlags,seen:Set<string>){
  if(seen.has(id))throw new Error("Route QA requires an acyclic manuscript.");
  if(routes.length>128)throw new Error("More than 128 routes; select a bounded test plan.");
  const scene=script.scenes.find(scene=>scene.id===id);if(!scene)throw new Error(`Missing scene ${id}`);
  const visited=new Set([...seen,id]);
  if(scene.choices?.length){for(const choice of scene.choices.filter(choice=>choiceAllowed(choice,flags)))walk(choice.next,[...choices,choice.text],applyChoiceFlags(flags,choice),visited);}
  else if(scene.ending)routes.push({choices,ending:scene.ending,flags});
  else if(scene.next)walk(scene.next,choices,flags,visited);
  else throw new Error(`No ending from ${id}`);
}
walk(script.start,[],script.flags??{},new Set());
const lines=["testsuite global:","    teardown:","        exit",""];
routes.forEach((route,index)=>{
  lines.push(`testcase route_${index+1}:`,"    $ _test.timeout = 90","    $ _test.transition_timeout = .01","    $ preferences.text_cps = 0","    run Start()");
  for(const choice of route.choices)lines.push('    advance until screen "choice"',`    click ${renpyText(choice)}`);
  lines.push('    advance until screen "vn_ending"',"    pause .3",`    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == ${JSON.stringify(route.ending)}`,`    assert eval vn_flags == json.loads(${JSON.stringify(JSON.stringify(route.flags))})`,`    screenshot "route-${index+1}-ending.png"`,"");
});
await writeFile(path.join(directory,"game/vn_qa.rpy"),lines.join("\n"));
console.log(`Wrote ${routes.length} native route tests.`);
