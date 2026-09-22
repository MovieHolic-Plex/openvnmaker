import {auditScript, characterExpressions, characterImage, parseScript, type VnScript} from "@vnmaker/content";

/**
 * Ren'Py 문자열 리터럴. say/menu 문장은 Python 이 아니라 Ren'Py 렉서(lexer.py `dequote`)가 읽으며,
 * 그 렉서는 `\n` `\"` `\\` `\[` `\{` `\%` `\uXXXX` 만 이스케이프로 안다 — JSON 의 `\t` `\r` 는 글자 t, r 로 찍힌다.
 * 그래서 탭은 공백으로, CR 은 LF 로 접고 나머지 제어 문자는 뺀다. 렉서는 연속 공백을 한 칸으로 합치고
 * 리터럴 안의 줄바꿈도 공백으로 본다(줄바꿈은 `\n` 이스케이프만 살아남는다).
 * `[` `{` 는 텍스트 보간·태그라 `[[` `{{` 로 이스케이프한다. define/call 인자처럼 Python 이 읽는 자리도 같은 규칙으로 해석된다.
 */
export const renpyText = (value:string) => `"${value.replace(/\r\n?/g,"\n").replace(/\t/g," ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\[/g,"[[").replace(/\{/g,"{{")}"`;
const pythonJson = (value:unknown) => `json.loads(${JSON.stringify(JSON.stringify(value))})`;
const label = (id:string) => `vn_scene_${Array.from(new TextEncoder().encode(id)).map(byte=>byte.toString(16).padStart(2,"0")).join("")}`;

const RENPY_INLINE_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RENPY_FLAG_TOKEN = /^[a-z][a-z0-9_-]{0,63}$/i;

const renpyEscape = (value:string) => value.replace(/\r\n?/g,"\n").replace(/\t/g," ").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n").replace(/\[/g,"[[").replace(/\{/g,"{{");

/**
 * 인라인 표기(engine/inlineText.ts 문법)를 Ren'Py 텍스트 태그로 옮긴다.
 * `**굵게**`→`{b}`, `*기울임*`→`{i}`, `{c:#색}`→`{color=#색}`, `{flag:x}`·`{player}`→`[vn_flags.get(…)]`
 * 보간으로 미뤄 두어 세이브·롤백이 값을 따라간다. 엔진과 같은 규칙으로 닫는 마커가 없는
 * `**`·`*`·`{c:…}` 는 문자 그대로 두고, 색을 연 적 없는 `{/c}` 도 문자 그대로 둔다 —
 * Ren'Py 는 짝 없는 닫힘 태그를 오류로 친다. 줄 끝에서 열린 태그는 닫아 준다.
 */
const renpyInline = (text:string):string => {
  let out = "", i = 0;
  let bold = false, italic = false, color = false;
  const lit = (value:string) => { out += renpyEscape(value); };
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length && "*{}".includes(text[i + 1]!)) { lit(text[i + 1]!); i += 2; continue; }
    if (text.startsWith("**", i)) {
      if (!bold && text.indexOf("**", i + 2) !== -1) { out += "{b}"; bold = true; }
      else if (bold) { out += "{/b}"; bold = false; }
      else lit("**");
      i += 2; continue;
    }
    if (ch === "*") {
      if (!italic && text.indexOf("*", i + 1) !== -1) { out += "{i}"; italic = true; }
      else if (italic) { out += "{/i}"; italic = false; }
      else lit("*");
      i += 1; continue;
    }
    if (ch === "{") {
      const close = text.indexOf("}", i + 1);
      if (close !== -1) {
        const inner = text.slice(i + 1, close);
        if (inner === "/c") {
          if (color) { out += "{/color}"; color = false; } else lit(text.slice(i, close + 1));
          i = close + 1; continue;
        }
        if (inner.startsWith("c:") && RENPY_INLINE_COLOR.test(inner.slice(2))) { out += `{color=${inner.slice(2)}}`; color = true; i = close + 1; continue; }
        if (inner === "player") { out += `[vn_flags.get("player","")]`; i = close + 1; continue; }
        if (inner.startsWith("flag:") && RENPY_FLAG_TOKEN.test(inner.slice(5))) { out += `[vn_flags.get(${JSON.stringify(inner.slice(5))},"")]`; i = close + 1; continue; }
      }
      lit(ch); i += 1; continue;
    }
    lit(ch); i += 1;
  }
  if (italic) out += "{/i}";
  if (bold) out += "{/b}";
  if (color) out += "{/color}";
  return `"${out}"`;
};

/** Native statements preserve Ren'Py's save/rollback boundaries for every dialogue and choice. */
export function generateRenpyScript(source:VnScript):string {
  const script=parseScript(structuredClone(source));
  const errors=auditScript(script).filter(issue=>issue.severity==="error");
  if(errors.length)throw new Error(errors.map(issue=>issue.message).join("\n"));
  if(script.scenes.some(scene=>scene.choices?.some(choice=>choice.cond)))throw new Error("Ren'Py 내보내기: 선택지 cond 표현식은 아직 지원하지 않습니다.");
  if(script.scenes.some(scene=>scene.choices?.length&&scene.choices.every(choice=>choice.disable)))throw new Error("모든 선택지가 잠긴 장면은 내보낼 수 없습니다.");
  const data={...script,characters:script.characters.map(actor=>({...actor,expressionImages:Object.fromEntries(characterExpressions(actor).flatMap(expression=>{const url=characterImage(actor,expression);return url?[[expression,url]]:[];}))}))};
  // 브라우저 연출 중 Ren'Py 미리보기에 대응물이 없는 것(effect/tint/화자 이름의 {flag} 치환)은
  // 조용히 버리지 않고 파일 상단에 경고로 남긴다.
  const warned=new Set<string>();
  const cuesDropped=script.scenes.filter(scene=>scene.effect||scene.tint||scene.lines.some(line=>line.effect!==undefined||line.tint!==undefined)).map(scene=>scene.id);
  if(cuesDropped.length)warned.add(`effect/tint cues are not supported by the native preview and were dropped (scenes: ${cuesDropped.join(", ")})`);
  if(script.characters.some(actor=>/\{/.test(actor.name)))warned.add("flag markup in character names is static text in Ren'Py — {flag:…} there is printed literally");
  const out=[`# Generated by VN Maker. Native exporter preview; verify the game before release.${[...warned].map(w=>`\n# WARNING: ${w}`).join("")}\ninit python:\n    import json\n    vn_project = ${pythonJson(data)}\n\ndefault vn_flags = ${pythonJson(script.flags??{})}\ndefault vn_affection = 0\ndefault vn_slots = {}\ndefault vn_background = None\ndefault vn_cg = None\ndefault vn_framing = "wide"\ndefault vn_hide_actors = False\n`];
  script.characters.forEach((actor,index)=>out.push(`define vn_actor_${index} = Character(${renpyText(actor.name)}, color=${JSON.stringify(actor.color)})`));
  if(!script.characters.some(actor=>actor.id==="me"))out.push(`define vn_legacy_me = Character("나", color="#b7c6d4")`);
  out.push(`\nlabel start:\n    jump ${label(script.start)}\n`);
  [...script.scenes].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).forEach(scene=>{
    const sceneIndex=JSON.stringify(scene.id);
    out.push(`label ${label(scene.id)}:\n    $ vn_enter(${sceneIndex})`);
    if(scene.transition&&scene.transition!=="none")out.push(`    with ${scene.transition==="dissolve"?"dissolve":scene.transition==="flash"?"Fade(0.1, 0.0, 0.3, color='#ffffff')":"fade"}`);
    scene.lines.forEach((line,lineIndex)=>{
      const conditional=!!line.when;
      if(conditional)out.push(`    if vn_allowed(${sceneIndex}, ${lineIndex}):`);
      const indent=conditional?"        ":"    ";
      out.push(`${indent}$ vn_cue(${sceneIndex}, ${lineIndex})`);
      if(line.voice)out.push(`${indent}voice ${JSON.stringify(line.voice.replace(/^\//,""))}`);
      if(line.shake)out.push(`${indent}with vpunch`);
      if(line.input){
        // 브라우저와 같은 규칙: 공백만 있는 입력은 다시 묻고, 정규 숫자 표기는 숫자로 저장한다.
        const prompt=line.input.prompt||"입력하세요";
        const flag=JSON.stringify(line.input.flag);
        const max=line.input.max??16;
        out.push(`${indent}python:`,
          `${indent}    vn_in = ""`,
          `${indent}    while not vn_in:`,
          `${indent}        vn_in = renpy.input(${JSON.stringify(prompt)}, length=${max}).strip()`,
          `${indent}    vn_flags = dict(vn_flags, **{${flag}: vn_store_input(${flag}, vn_in, ${max})})`);
        return;
      }
      const actor=script.characters.findIndex(actor=>actor.id===line.speaker);
      const who=line.speaker===null?"":actor>=0?`vn_actor_${actor} `:"vn_legacy_me ";
      out.push(`${indent}${who}${renpyInline(line.text)}`);
    });
    if(scene.choices?.length){
      out.push("    menu:");
      scene.choices.forEach((choice,choiceIndex)=>{
        const row=`vn_scene(${sceneIndex})["choices"][${choiceIndex}]`;
        if(choice.disable){
          // 브라우저는 잠긴 선택지를 비활성 버튼(회색·클릭 불가)으로 보인다. 메뉴 항목 인자 vn_locked 를 choice
          // 스크린(renpyTheme)이 읽어 sensitive False 로 그린다 — 이전엔 클릭 가능한 항목으로 나와 안내 후 메뉴로 되돌아갔다.
          // when 이 충족될 때만 보인다(브라우저와 동일). 효과는 절대 적용되지 않는다.
          const cond=choice.when?` if vn_condition(${row}.get("when", {}))`:"";
          out.push(`        ${renpyInline(choice.text)} (vn_locked=True)${cond}:`);
          out.push("            pass");
          return;
        }
        out.push(`        ${renpyInline(choice.text)}${choice.add?` if vn_choice_allowed(${row})`:choice.when?` if vn_condition(${row}.get("when", {}))`:""}:`);
        // json.loads returns a regular dict. Rebinding preserves the old snapshot for rollback.
        if(choice.add)out.push(`            $ vn_flags = vn_apply_flags(${row})`);
        else if(choice.set)out.push(`            $ vn_flags = dict(vn_flags, **${pythonJson(choice.set)})`);
        if(choice.affection)out.push(`            $ vn_affection += ${choice.affection}`);
        out.push(`            jump ${label(choice.next)}`);
      });
    }else{
      // 조건 경로는 엔진과 같이 앞에서부터 첫 매치만 따른다. 무조건 경로는 else — 뒤 경로는 도달 불가라 끊는다.
      const routes=scene.routes??[];
      const firstOpen=routes.findIndex(route=>route.when===undefined);
      const chain=firstOpen<0?routes:routes.slice(0,firstOpen+1);
      chain.forEach((route,index)=>{
        if(route.when===undefined)out.push(index===0?`    jump ${label(route.next)}`:`    else:\n        jump ${label(route.next)}`);
        else out.push(`    ${index===0?"if":"elif"} vn_condition(${pythonJson(route.when)}):\n        jump ${label(route.next)}`);
      });
      if(firstOpen<0){
        if(scene.ending)out.push("    window hide",`    call screen vn_ending(${renpyText(scene.ending)})`,"    return");
        else if(scene.next)out.push(`    jump ${label(scene.next)}`);
        else out.push("    return");
      }
    }
    out.push("");
  });
  return out.join("\n");
}

export const RENPY_DIRECTION_RUNTIME = `# VN Maker native scene directions. Original bitmap files remain unchanged.
init python:
    import math
    def vn_scene(key):
        # Integer support is retained for older SDK QA helpers.
        if isinstance(key, int):
            return vn_project["scenes"][key]
        return next(scene for scene in vn_project["scenes"] if scene["id"] == key)

    def vn_default_flags():
        global vn_flags
        # The SDK calls this after defaults on start, load and rollback.
        # Only absent keys receive defaults; earned values and old keys survive.
        if "vn_flags" not in globals():
            return
        missing = {key: value for key, value in vn_project.get("flags", {}).items() if key not in vn_flags}
        if missing:
            vn_flags = dict(vn_flags, **missing)

    config.after_default_callbacks.append(vn_default_flags)
    renpy.register_shader("vnmaker.green_key", fragment_400="""
        vec4 c = gl_FragColor;
        float dominance = c.g - max(c.r, c.b);
        float saturation = (c.g - min(c.r, c.b)) / max(c.g, .001);
        float matte = 1.0 - smoothstep(.08, .45, dominance) * smoothstep(.25, .65, saturation);
        c.g -= max(0.0, c.g - max(c.r, c.b)) * (1.0 - matte);
        gl_FragColor = vec4(c.rgb * matte, c.a * matte);
    """)

    def vn_file(url):
        return url.lstrip("/")

    def vn_allowed(scene_index, line_index):
        condition = vn_scene(scene_index)["lines"][line_index].get("when", {})
        return vn_condition(condition)

    def vn_condition(condition):
        if not all(bool(vn_flags.get(key)) for key in condition.get("all", [])) or not all(not vn_flags.get(key) for key in condition.get("none", [])):
            return False
        for rule in condition.get("compare", []):
            if rule["flag"] not in vn_flags:
                return False
            actual, value, op = vn_flags[rule["flag"]], rule["value"], rule["op"]
            numeric = type(actual) in (int, float) and type(value) in (int, float)
            equal = (numeric or type(actual) is type(value)) and actual == value
            if op == "eq" and not equal or op == "ne" and equal:
                return False
            if op not in ("eq", "ne"):
                if not numeric:
                    return False
                if not {"gt": actual > value, "gte": actual >= value, "lt": actual < value, "lte": actual <= value}[op]:
                    return False
        return True

    def vn_patch(directions):
        # 같은 dict 를 제자리에서 고치면 롤백이 되돌릴 옛 스냅샷이 없다 — 새 dict 를 묶어준다.
        global vn_slots
        updated = dict(vn_slots)
        for direction in directions:
            slot = direction["slot"]
            previous = updated.get(slot, {})
            updated[slot] = dict(previous, **direction) if previous.get("character") == direction.get("character") else dict(direction)
        vn_slots = updated

    def vn_effect_valid(choice):
        for key, delta in choice.get("add", {}).items():
            current = vn_flags.get(key)
            if key in choice.get("set", {}) or type(current) not in (int, float) or type(delta) not in (int, float):
                return False
            try:
                if not math.isfinite(float(current)) or not math.isfinite(float(delta)) or not math.isfinite(float(current) + float(delta)):
                    return False
            except (OverflowError, ValueError):
                return False
        return True

    def vn_choice_allowed(choice):
        return not choice.get("disable") and not choice.get("cond") and vn_condition(choice.get("when", {})) and vn_effect_valid(choice)

    def vn_apply_flags(choice):
        if not vn_effect_valid(choice):
            raise ValueError("Invalid numeric choice effect")
        result = dict(vn_flags, **choice.get("set", {}))
        for key, delta in choice.get("add", {}).items():
            result[key] = float(vn_flags[key]) + float(delta)
        return result

    def vn_store_input(flag, text, limit):
        # 브라우저 reducer 와 같은 규칙: trim+비어있지 않음+정규 숫자 표기는 숫자로 저장.
        value = (text or "").strip()[:limit]
        if not value:
            return ""
        try:
            number = float(value)
            canonical = str(int(number)) if number == int(number) else str(number)
            if math.isfinite(number) and canonical == value:
                return int(number) if number == int(number) else number
        except (ValueError, OverflowError):
            pass
        return value

    def vn_music(name):
        duration = vn_project.get("musicFadeSeconds", 1.2)
        if name:
            renpy.music.play(vn_audio(name, "bgm"), fadeout=duration, fadein=duration, if_changed=True)
        else:
            renpy.music.stop(fadeout=duration)

    def vn_audio(name, kind):
        return name.lstrip("/") if name.startswith("/assets/user/") else "assets/audio/" + kind + "/" + name + ".mp3"

    def vn_draw(speaker=None, cg_suppress=False):
        shown_cg = None if cg_suppress else vn_cg
        art = shown_cg or vn_background
        renpy.show("vn_backdrop", what=Solid("#080a11"), zorder=-1)
        renpy.show("vn_background", what=Transform(vn_file(art), xysize=(1280, 720), fit="contain" if shown_cg else "cover", zoom=1.13 if vn_framing == "close" and not shown_cg else 1.0, xalign=.5, yalign=.5), zorder=0)
        for tag, top in (("vn_bar_top", 0), ("vn_bar_bottom", 698)):
            renpy.hide(tag)
            if vn_framing == "cinematic" or shown_cg:
                renpy.show(tag, what=Transform(Solid("#080a11"), xysize=(1280, 22), xpos=0, ypos=top), zorder=10)
        for slot, position in (("left", .08), ("center", .5), ("right", .92)):
            tag = "vn_" + slot
            renpy.hide(tag)
            direction = vn_slots.get(slot, {})
            if vn_hide_actors or shown_cg or not direction.get("character"):
                continue
            actor = next((actor for actor in vn_project["characters"] if actor["id"] == direction["character"]), None)
            if not actor:
                continue
            worn = actor.get("outfitImages", {}).get(direction.get("outfit") or "", {})
            images = actor.get("expressionImages", {})
            art = direction.get("poseUrl") or worn.get(direction.get("expression", "neutral")) or worn.get("neutral") or images.get(direction.get("expression", "neutral")) or images.get("neutral")
            if not art:
                continue
            portrait = Transform(vn_file(art), shader="vnmaker.green_key") if actor.get("chromaKey") else vn_file(art)
            bounds = (650, 821) if slot == "center" else (500, 706)
            top = 58 if slot == "center" else 137
            renpy.show(tag, what=Transform(portrait, xysize=bounds, fit="contain", xalign=position, yalign=0.0, ypos=top, alpha=.8 if speaker and speaker != actor["id"] else 1.0), zorder=5)

    def vn_enter(index):
        global vn_slots, vn_background, vn_cg, vn_framing, vn_hide_actors, vn_flags
        scene = vn_scene(index)
        if scene.get("set"):
            # 진입 시점 플래그 — 첫 대사의 when 과 조건 경로가 이 값을 본다. 새 dict 로 묶어 롤백을 살린다.
            vn_flags = dict(vn_flags, **scene["set"])
        vn_slots = {}
        vn_background = scene.get("backgroundUrl") or "assets/bg/" + scene["background"] + ".png"
        vn_cg = scene.get("cgUrl")
        if vn_cg is None and scene.get("cg"):
            vn_cg = next((asset["url"] for asset in vn_project.get("assets", []) if asset.get("id") == scene["cg"]), None)
        vn_framing = scene.get("framing", "wide")
        vn_hide_actors = scene.get("hideSprites", False)
        vn_patch(scene.get("sprites", []))
        vn_music(scene.get("bgm"))
        vn_draw()

    def vn_cue(scene_index, line_index):
        global vn_background, vn_cg, vn_framing, vn_slots
        line = vn_scene(scene_index)["lines"][line_index]
        if "backgroundUrl" in line:
            vn_background = line["backgroundUrl"]
        if "cgUrl" in line:
            vn_cg = line["cgUrl"]
        if "framing" in line:
            vn_framing = line["framing"]
        vn_patch(line.get("sprites", []))
        if line.get("expression"):
            # vn_patch 와 같은 이유 — 제자리 변경 대신 새 dict 로 묶어 롤백을 살린다.
            replaced = dict(vn_slots)
            for slot, actor in replaced.items():
                if actor.get("character") == line.get("speaker"):
                    replaced[slot] = dict(actor, expression=line["expression"])
            vn_slots = replaced
        if "bgm" in line:
            vn_music(line["bgm"])
        if line.get("sfx"):
            renpy.sound.play(vn_audio(line["sfx"], "sfx"))
        vn_draw(line.get("speaker"), line.get("cgHide", False))
`;
