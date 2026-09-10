import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {parseScript} from "@vnmaker/content";
import {VN_WAIT_READY_LINE} from "../src/studio/nativeParity.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass a disposable extracted native editor test package.");
const directory=path.resolve(process.argv[2]),script=parseScript(JSON.parse(await readFile(path.join(directory,"game/project.json"),"utf8")));
const scene=script.scenes.find(scene=>scene.id===script.start)!;
if(scene.lines.length!==2||!scene.ending||scene.choices?.length)throw new Error("Use the two-line editor build fixture.");
await writeFile(path.join(directory,"game/vn_qa.rpy"),[
  "testsuite global:","    teardown:","        exit","","testcase editor_package:","    $ preferences.text_cps = 0","    run Start()",VN_WAIT_READY_LINE,
  `    assert ${renpyText(scene.lines[0]!.text)}`,'    screenshot "editor-first.png"',
  `    advance until ${renpyText(scene.lines[1]!.text)}`,`    assert ${renpyText(scene.lines[1]!.text)}`,
  '    advance until screen "vn_ending"',`    assert eval renpy.get_widget("vn_ending", "ending_title").get_all_text() == ${renpyText(scene.ending)}`,
  '    screenshot "editor-ending.png"',""
].join("\n"));
