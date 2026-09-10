import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {audioPath,parseScript} from "@vnmaker/content";
import {VN_WAIT_READY_LINE} from "../src/studio/nativeParity.js";
import {renpyText} from "../src/studio/renpyScript.js";
if(!process.argv[2])throw new Error("Pass the native audio QA project exported from the browser fixture.");
const dir=path.resolve(process.argv[2]);
const script=parseScript(JSON.parse(await readFile(path.join(dir,"game/project.json"),"utf8")));
const scene=script.scenes.find(scene=>scene.id===script.start)!;
const [first,second]=scene.lines;
if(!scene.bgm||!first?.voice||!second||second.bgm!==null||second.voice)throw new Error("Use the two-line voice/music-stop audio fixture.");
await writeFile(path.join(dir,"game/vn_qa.rpy"),[
  'testsuite global:','    teardown:','        exit','',
  'testcase imported_audio:','    $ preferences.text_cps = 0','    run Start()',VN_WAIT_READY_LINE,`    assert ${renpyText(first.text)}`,VN_WAIT_READY_LINE,
  `    assert eval vn_project.get("musicFadeSeconds", 1.2) == ${script.musicFadeSeconds??1.2}`,
  `    assert eval renpy.music.get_playing() == ${JSON.stringify(audioPath(scene.bgm,"bgm").slice(1))}`,
  `    assert eval renpy.music.get_playing(channel="voice") == ${JSON.stringify(first.voice.slice(1))}`,
  '    screenshot "imported-audio-first.png"',
  `    advance until ${renpyText(second.text)}`,VN_WAIT_READY_LINE,
  '    assert eval renpy.music.get_playing() is None','    assert eval renpy.music.get_playing(channel="voice") is None',
  '    screenshot "imported-audio-stopped.png"',''
].join("\n"));
