/** Shared native player theme. Uses code-drawn panels and the project's own original art. */
export const RENPY_PLAYER_THEME = `init offset = 10

init python:
    style.default.font = "fonts/SourceHanSansLite.ttf"
    style.default.language = "korean-with-spaces"
    def vn_literal(value):
        return value.replace("[", "[[").replace("{", "{{")
    vn_cover_scene = next(scene for scene in vn_project["scenes"] if scene["id"] == vn_project["start"])
    vn_cover_path = vn_cover_scene.get("backgroundUrl") or "assets/bg/" + vn_cover_scene["background"] + ".png"
    gui.main_menu_background = Transform(vn_file(vn_cover_path), xysize=(1280, 720), fit="cover")
    gui.game_menu_background = gui.main_menu_background
    vn_media_credits = [asset for asset in vn_project.get("assets", []) + vn_project.get("audioAssets", []) if any(asset.get("provenance", {}).get(field, "").strip() for field in ("creator", "license", "credit"))]

screen about():
    tag menu
    use game_menu("크레딧 / 버전정보", scroll="viewport"):
        vbox:
            spacing 24
            text vn_literal(vn_project["title"]) size 34
            if any(credit["names"].strip() for credit in vn_project.get("credits", [])):
                text "제작진" size 24 color "#a5e5d7"
                for index, credit in enumerate(vn_project.get("credits", [])):
                    if credit["names"].strip():
                        vbox:
                            spacing 8
                            text vn_literal(credit["role"].strip() or "참여") size 26 color "#ffffff"
                            text vn_literal(credit["names"]) id ("vn_credit_names_%d" % index) size 22
            text "아트 / 사운드" size 24 color "#a5e5d7"
            if not vn_media_credits:
                text "등록된 소재 크레딧이 없습니다." size 22
            for asset in vn_media_credits:
                vbox:
                    spacing 8
                    text vn_literal(asset["name"]) size 26 color "#ffffff"
                    for field, caption in (("credit", ""), ("creator", "제작자: "), ("license", "이용 조건: ")):
                        if asset.get("provenance", {}).get(field, "").strip():
                            text vn_literal(caption + asset["provenance"][field]) size 22
            null height 16
            text "Made with VN Maker / Ren'Py" size 26 color "#a5e5d7"
            text ("Ren'Py " + renpy.version_only) size 20
            text renpy.license size 18

screen choice(items):
    style_prefix "vn_choice"
    add Solid("#070e1859")
    frame:
        xalign .5
        yalign .45
        xsize 920
        padding (1, 1)
        background Solid("#607d8a")
        frame:
            xfill True
            padding (30, 26)
            background Solid("#111c2af5")
            vbox:
                spacing 20
                text "당신의 선택" size 22 color "#a5e5d7"
                viewport:
                    ysize min(420, len(items) * 88)
                    xfill True
                    mousewheel True
                    arrowkeys False
                    pagekeys True
                    scrollbars "vertical"
                    vbox:
                        spacing 12
                        for index, item in enumerate(items):
                            # vn_locked 는 원고의 disable 선택지. 웹 플레이어와 같이 보이되 고를 수 없는 버튼으로 그린다.
                            textbutton item.caption id ("vn_choice_%d" % index) action item.action sensitive (not item.kwargs.get("vn_locked", False)) xfill True default_focus (index == 0 and not item.kwargs.get("vn_locked", False))
                text "방향키로 이동 / Enter로 선택" size 16 color "#a9bac9"

style vn_choice_vbox is vbox:
    xpos 0
    ypos 0
    xanchor 0
    yanchor 0
style vn_choice_vscrollbar is vscrollbar:
    unscrollable "hide"

style vn_choice_button is button:
    background Solid("#223447")
    hover_background Solid("#365c60")
    insensitive_background Solid("#17222e")
    padding (24, 18)
    yminimum 72
style vn_choice_button_text is button_text:
    color "#f2f7fb"
    hover_color "#ffffff"
    insensitive_color "#8293a3"
    size 26
    xalign 0.0
    text_align 0.0
    outlines []

screen quick_menu():
    zorder 100
    if quick_menu and not renpy.get_screen("vn_ending"):
        frame:
            xalign .5
            yalign 1.0
            yoffset -10
            padding (10, 6)
            background Solid("#101a27f5")
            hbox:
                spacing 4
                style_prefix "vn_quick"
                textbutton "되감기" action Rollback()
                textbutton "대사록" action ShowMenu("history")
                textbutton "넘기기" action Skip() alternate Skip(fast=True, confirm=True)
                textbutton "자동진행" action Preference("auto-forward", "toggle")
                null width 12
                textbutton "저장하기" action ShowMenu("save")
                textbutton "퀵 저장" action QuickSave()
                textbutton "퀵 로드" action QuickLoad()
                textbutton "설정" action ShowMenu("preferences")
                textbutton "크레딧" action ShowMenu("about")

style vn_quick_button is button:
    background None
    hover_background Solid("#2c4b52")
    selected_background Solid("#2c4b52")
    padding (12, 9)
style vn_quick_button_text is button_text:
    size 20
    color "#dfebf4"
    hover_color "#ffffff"
    selected_color "#b7f4e2"
    insensitive_color "#8595a5"

style window:
    ysize 250
    background Solid("#0d1724ed")
style namebox:
    xpos 88
    ypos 18
    background None
style say_label:
    size 28
style say_dialogue:
    xpos 88
    ypos 62
    xsize 1104
    size 24
    color "#f2f5f9"
    line_spacing 4

screen vn_ending(title):
    modal True
    zorder 90
    add Solid("#07111cbb")
    frame:
        xalign .5
        yalign .5
        xsize 860
        padding (1, 1)
        background Solid("#78929c")
        frame:
            xfill True
            padding (50, 42)
            background Solid("#101b2af5")
            vbox:
                xfill True
                spacing 24
                text "이야기의 끝" size 20 color "#a5e5d7" xalign .5
                text title id "ending_title" size 44 color "#ffffff" text_align .5 xalign .5
                null height 1
                add Solid("#607d8a") xsize 60 ysize 2 xalign .5
                text vn_literal(vn_project["title"]) size 22 color "#b4c5d4" xalign .5 text_align .5
                null height 8
                hbox:
                    spacing 16
                    xalign .5
                    style_prefix "vn_choice"
                    textbutton "대사록" action ShowMenu("history")
                    textbutton "크레딧" action ShowMenu("about")
                    textbutton "타이틀로" action Return()
    key "game_menu" action ShowMenu("save")
`;
