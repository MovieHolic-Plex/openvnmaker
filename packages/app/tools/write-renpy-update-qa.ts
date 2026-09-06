import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

export async function writeUpdateQa(root:string){
  for(const name of ["original","revised"]){
    const script=JSON.parse(await readFile(path.join(root,name,"game/project.json"),"utf8"));
    if(script.nativeSaveId!=="38f9c09deee5431fb99e9cb9073781be"||!script.title.startsWith("누적 신뢰 검증"))throw new Error("Use the generated update fixture.");
  }
  const header='testsuite global:\n    teardown:\n        exit\n\n';
  await writeFile(path.join(root,"original/game/vn_qa.rpy"),header+`testcase write_update:
    $ _test.timeout = 20
    $ preferences.text_cps = 0
    run Start()
    assert "처음 신뢰는 둘입니다."
    run ShowMenu("save")
    run FileSave(2, confirm=False)
    assert eval renpy.can_load("1-2")
    click "돌아가기"
    move pos (0, 0)
    advance until screen "choice"
    click "함께 돕는다"
    advance until screen "choice"
    assert "위험을 감수한다"
    assert eval vn_flags == {"trust": 5}
    run ShowMenu("save")
    run FileSave(1, confirm=False)
    assert eval renpy.can_load("1-1")
    click "돌아가기"
    assert screen "choice"
`);
  await writeFile(path.join(root,"revised/game/vn_qa.rpy"),header+`testcase read_update:
    $ _test.timeout = 20
    $ preferences.text_cps = 0
    assert eval renpy.can_load("1-1")
    run FileLoad(1, confirm=False)
    assert screen "choice"
    assert "위험을 감수한다"
    assert eval vn_flags == {"trust": 5, "chapterBonus": 7}
    click "위험을 감수한다"
    advance until screen "choice"
    assert "비밀을 듣는다"
    assert eval vn_flags == {"trust": 3, "chapterBonus": 7}
    run ShowMenu("save")
    run FileSave(3, confirm=False)
    assert eval renpy.can_load("1-3")
    click "돌아가기"
    click "되감기"
    assert "누적된 선택으로 길이 열립니다. 업데이트."
    assert eval vn_flags == {"trust": 3, "chapterBonus": 7}
    click "되감기"
    assert "위험을 감수한다"
    assert eval vn_flags == {"trust": 5, "chapterBonus": 7}
    run FileLoad(3, confirm=False)
    assert "비밀을 듣는다"
    assert eval vn_flags == {"trust": 3, "chapterBonus": 7}
    screenshot "update-restored-choice.png"
    click "비밀을 듣는다"
    advance until screen "vn_ending"
    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == "신뢰의 끝"

testcase read_dialogue_update:
    $ _test.timeout = 20
    $ preferences.text_cps = 0
    assert eval renpy.can_load("1-2")
    run FileLoad(2, confirm=False)
    assert "처음 신뢰는 둘입니다. 업데이트."
    assert eval vn_flags == {"trust": 2, "chapterBonus": 7}
    move pos (0, 0)
    advance until screen "choice"
    click "함께 돕는다"
    advance until screen "choice"
    assert "위험을 감수한다"
    assert eval vn_flags == {"trust": 5, "chapterBonus": 7}

testcase read_resaved_update:
    $ _test.timeout = 20
    assert eval renpy.can_load("1-3")
    run FileLoad(3, confirm=False)
    assert "비밀을 듣는다"
    assert eval vn_flags == {"trust": 3, "chapterBonus": 7}
`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw new Error("Pass the generated update fixture directory.");
  await writeUpdateQa(path.resolve(process.argv[2]));
}
