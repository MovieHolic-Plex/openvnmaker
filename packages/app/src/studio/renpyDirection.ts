/** Native scene directions. Original bitmap files remain unchanged. */
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

    def vn_art_compositing(url):
        for asset in vn_project.get("assets") or []:
            if asset.get("url") == url:
                return asset.get("compositing")
        return None

    def vn_portrait(actor, art):
        compositing = vn_art_compositing(art)
        if compositing in ("alpha", "opaque") or not actor.get("chromaKey"):
            return vn_file(art)
        return Transform(vn_file(art), shader="vnmaker.green_key")

    def vn_scene_cg(scene):
        if scene.get("cgUrl"):
            return scene.get("cgUrl")
        key = scene.get("cg")
        if not key:
            return None
        asset = next((asset for asset in vn_project.get("assets") or [] if asset.get("id") == key), None)
        if asset is None:
            raise ValueError("Unresolved native CG asset: " + str(key))
        return asset.get("url")

    def vn_interaction_ready():
        interface = renpy.game.interface
        if interface is None:
            return False
        return getattr(interface, "ongoing_transition", None) is None

    def vn_wait_ready():
        while not vn_interaction_ready():
            renpy.pause(0)

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
        for direction in directions:
            slot = direction["slot"]
            previous = vn_slots.get(slot, {})
            vn_slots[slot] = dict(previous, **direction) if previous.get("character") == direction.get("character") else dict(direction)

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

    def vn_music(name):
        duration = vn_project.get("musicFadeSeconds", 1.2)
        if name:
            renpy.music.play(vn_audio(name, "bgm"), fadeout=duration, fadein=duration, if_changed=True)
        else:
            renpy.music.stop(fadeout=duration)

    def vn_audio(name, kind):
        return name.lstrip("/") if name.startswith("/assets/user/") else "assets/audio/" + kind + "/" + name + ".mp3"

    def vn_draw(speaker=None):
        art = vn_cg or vn_background
        renpy.show("vn_backdrop", what=Solid("#080a11"), zorder=-1)
        renpy.show("vn_background", what=Transform(vn_file(art), xysize=(1280, 720), fit="contain" if vn_cg else "cover", zoom=1.13 if vn_framing == "close" and not vn_cg else 1.0, xalign=.5, yalign=.5), zorder=0)
        for tag, top in (("vn_bar_top", 0), ("vn_bar_bottom", 698)):
            renpy.hide(tag)
            if vn_framing == "cinematic" or vn_cg:
                renpy.show(tag, what=Transform(Solid("#080a11"), xysize=(1280, 22), xpos=0, ypos=top), zorder=10)
        for slot, position in (("left", .08), ("center", .5), ("right", .92)):
            tag = "vn_" + slot
            renpy.hide(tag)
            direction = vn_slots.get(slot, {})
            if vn_hide_actors or vn_cg or not direction.get("character"):
                continue
            actor = next((actor for actor in vn_project["characters"] if actor["id"] == direction["character"]), None)
            if not actor:
                continue
            images = actor.get("expressionImages", {})
            art = direction.get("poseUrl") or images.get(direction.get("expression", "neutral")) or images.get("neutral")
            if not art:
                continue
            portrait = vn_portrait(actor, art)
            bounds = (650, 821) if slot == "center" else (500, 706)
            top = 58 if slot == "center" else 137
            renpy.show(tag, what=Transform(portrait, xysize=bounds, fit="contain", xalign=position, yalign=0.0, ypos=top, alpha=.8 if speaker and speaker != actor["id"] else 1.0), zorder=5)

    def vn_enter(index):
        global vn_slots, vn_background, vn_cg, vn_framing, vn_hide_actors
        scene = vn_scene(index)
        vn_slots = {}
        vn_background = scene.get("backgroundUrl") or "assets/bg/" + scene["background"] + ".png"
        vn_cg = vn_scene_cg(scene)
        vn_framing = scene.get("framing", "wide")
        vn_hide_actors = scene.get("hideSprites", False)
        vn_patch(scene.get("sprites", []))
        vn_music(scene.get("bgm"))
        vn_draw()

    def vn_cue(scene_index, line_index):
        global vn_background, vn_cg, vn_framing
        line = vn_scene(scene_index)["lines"][line_index]
        if "backgroundUrl" in line:
            vn_background = line["backgroundUrl"]
        if line.get("cgHide"):
            vn_cg = None
        if "cgUrl" in line:
            vn_cg = line["cgUrl"]
        if "framing" in line:
            vn_framing = line["framing"]
        vn_patch(line.get("sprites", []))
        if line.get("expression"):
            for slot, actor in list(vn_slots.items()):
                if actor.get("character") == line.get("speaker"):
                    vn_slots[slot] = dict(actor, expression=line["expression"])
        if "bgm" in line:
            vn_music(line["bgm"])
        if line.get("sfx"):
            renpy.sound.play(vn_audio(line["sfx"], "sfx"))
        vn_draw(line.get("speaker"))
`;
