import {writeFile} from "node:fs/promises";
import path from "node:path";
import {story} from "../test/fixtures/state-story.js";
import {generateRenpyScript,RENPY_DIRECTION_RUNTIME} from "../src/studio/renpyScript.js";
import {RENPY_PLAYER_THEME} from "../src/studio/renpyTheme.js";
import {lineAllowed,type FlagComparison} from "@vnmaker/content";
if(!process.argv[2])throw new Error("Pass a disposable native QA project with standard title artwork.");
const game=path.resolve(process.argv[2],"game");
await writeFile(path.join(game,"project.json"),JSON.stringify(story));
await writeFile(path.join(game,"script.rpy"),generateRenpyScript(story));
await writeFile(path.join(game,"vn_direction.rpy"),RENPY_DIRECTION_RUNTIME);
await writeFile(path.join(game,"vn_style.rpy"),RENPY_PLAYER_THEME);
const out=['testsuite global:','    teardown:','        exit',''];
for(const trusted of [false,true]){
  out.push(`testcase ${trusted?'trusted':'untrusted'}:`, '    $ preferences.text_cps = 0','    $ _test.transition_timeout = .01','    run Start()','    advance until screen "choice"',`    click "${trusted?'신뢰한다':'돌아선다'}"`,'    advance until screen "choice"',`    assert ${trusted?'':'not '}"비밀을 듣는다"`,'    assert "떠난다"',`    screenshot "state-${trusted?'trusted':'untrusted'}.png"`,`    click "${trusted?'비밀을 듣는다':'떠난다'}"`,'    advance until screen "vn_ending"',`    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == "${trusted?'신뢰의 끝':'다른 끝'}"`,'');
}
out.push('testcase condition_types:','    run Start()');
const json=(value:unknown)=>`json.loads(${JSON.stringify(JSON.stringify(value))})`;
for(const actual of [false,true,0,1,3,"3","ally"]){
  for(const op of ["eq","ne","gt","gte","lt","lte"] as const)for(const value of [1,3]){
    const rule:FlagComparison={flag:"x",op,value};const when={compare:[rule]};
    out.push(`    $ vn_flags = ${json({x:actual})}`,`    assert eval vn_condition(${json(when)}) == ${lineAllowed({when},{x:actual})?'True':'False'}`);
  }
}
out.push('    $ vn_flags = {}',`    assert eval not vn_condition(${json({compare:[{flag:"x",op:"ne",value:3}]})})`,'');
await writeFile(path.join(game,"vn_qa.rpy"),out.join("\n"));
console.log("Prepared conditional route and cross-runtime type parity tests.");
