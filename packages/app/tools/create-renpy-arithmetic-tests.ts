import {readFile,writeFile} from "node:fs/promises";
import {resolve,join} from "node:path";
import {parseScript,choiceEffectError,applyChoiceFlags,type StoryFlags} from "@vnmaker/content";
const directory=resolve(process.argv[2]!),script=parseScript(JSON.parse(await readFile(join(directory,"game/project.json"),"utf8")));
if(script.title!=="누적 신뢰 검증")throw new Error("Use the arithmetic browser-export fixture.");
const out=['testsuite global:','    teardown:','        exit','','testcase accumulated:','    $ preferences.text_cps = 0','    run Start()','    advance until screen "choice"','    click "함께 돕는다"','    advance until screen "choice"','    assert eval vn_flags["trust"] == 5','    run ShowMenu("save")','    run FileSave(1, confirm=False)','    assert eval renpy.can_load("1-1")','    click "돌아가기"','    click "위험을 감수한다"','    advance until screen "choice"','    assert eval vn_flags["trust"] == 3','    assert "비밀을 듣는다"','    click "되감기"','    assert "누적된 선택으로 길이 열립니다."','    assert eval vn_flags["trust"] == 3','    click "되감기"','    assert screen "choice"','    assert "위험을 감수한다"','    assert eval vn_flags["trust"] == 5','    click "위험을 감수한다"','    advance until screen "choice"','    run ShowMenu("load")','    run FileLoad(1, confirm=False)','    assert eval vn_flags["trust"] == 5','    assert "위험을 감수한다"','    click "위험을 감수한다"','    advance until screen "choice"','    assert eval vn_flags["trust"] == 3','    assert "비밀을 듣는다"','    screenshot "accumulated.png"','    click "비밀을 듣는다"','    advance until screen "vn_ending"','    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == "신뢰의 끝"','',
'testcase decreased:','    $ preferences.text_cps = 0','    run Start()','    advance until screen "choice"','    click "외면한다"','    advance until screen "choice"','    assert eval vn_flags["trust"] == 1','    click "위험을 감수한다"','    advance until screen "choice"','    assert eval vn_flags["trust"] == -1','    assert not "비밀을 듣는다"','    assert "떠난다"','    screenshot "decreased.png"','',
'testcase numeric_parity:','    run Start()'];
const json=(value:unknown)=>`json.loads(${JSON.stringify(JSON.stringify(value))})`;
for(const value of [true,"3",0,2,.1,9007199254740992,Number.MAX_VALUE])for(const delta of [3,-2,.2,Number.MAX_VALUE]){
  const flags:StoryFlags={trust:value},effect={add:{trust:delta}},valid=!choiceEffectError(effect,flags);
  out.push(`    $ vn_flags = ${json(flags)}`,`    assert eval vn_effect_valid(${json(effect)}) == ${valid?"True":"False"}`);
  if(valid)out.push('    $ vn_before = vn_flags',`    $ vn_flags = vn_apply_flags(${json(effect)})`,`    assert eval vn_flags == ${json(applyChoiceFlags(flags,effect))}`,`    assert eval vn_before == ${json(flags)}`);
}
out.push('    $ vn_flags = {}',`    assert eval not vn_effect_valid(${json({add:{trust:1}})})`,'');
await writeFile(join(directory,"game/vn_qa.rpy"),out.join("\n"));
