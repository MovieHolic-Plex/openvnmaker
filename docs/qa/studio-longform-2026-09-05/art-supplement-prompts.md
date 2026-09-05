# 보강 배경 제작

Built-in imagegen 사용. 앱 내부 AI API와 외부 CLI API는 호출하지 않았습니다.

## 납품 및 시각 확인

- `packages/app/public/assets/art/campus-after-rain.png`: 신규 생성. 젖은 외부 광장, 식재, 유리 별관 입구와 늦은 오후 하늘을 확인했습니다. 인물·문자·UI는 없습니다.
- `packages/app/public/assets/art/atelier-midnight.png`: 원본 아틀리에의 카메라·창문 격자·이젤·캔버스·식물·수납장·작업대 위치를 유지한 밤 조명 편집. 직접 햇빛과 바닥의 창문 빛무늬가 사라지고 청색 밤 창문과 따뜻한 작업등으로 바뀐 것을 확인했습니다. 원본 파일은 변경하지 않았습니다.
- 두 결과 모두 이미지 생성 출력 자체를 검토하고 프로젝트 폴더에 복사했습니다. 후처리로 이미지 내용을 변형하지 않았습니다.
- `packages/app/public/assets/art/rain-umbrella-cg.png`: 추가 서사 일치 편집. 캔버스가 사라지고 두 성인의 손이 하나의 검은 우산 손잡이를 함께 잡습니다. 불투명 검은 천의 우산·빗방울·야간 배경을 확인했습니다. 기존 `rain-confession-cg.png`는 유지했습니다.

## campus-after-rain.png

Use case: illustration-story.
Asset type: finished 16:9 cinematic background illustration for a Korean visual novel, opening scene at a fictional art university.
Primary request: The pedestrian entrance and approach plaza to a modest but beautiful university glass annex in late afternoon, viewed at eye level from just inside the campus gate. The setting must clearly be OUTDOORS: damp stone paving in the foreground, a few shallow puddles, low stone planters and lush campus greenery, and the art building's glass entrance in the midground. A graceful older academic wing joins a contemporary glass walkway. The environment feels inhabited by art students without showing any people.
Style/medium: exquisite painterly semi-realistic visual novel environment, precise architectural perspective, subtle brush texture, soft atmospheric depth, highly detailed glass reflections, wet stone grain, leaves, window mullions and warm interior glimpses. Elegant cinematic storytelling, quiet contemporary Korean university atmosphere.
Lighting/mood: a shower has just passed; late afternoon golden and faint pink light breaks under blue-gray gathering clouds, while another storm is rolling back in. Still clearly late afternoon, not night. Damp paving reflects soft warm windows and a few patches of sky. Rich cool/warm contrast without excessive bloom.
Composition: panoramic 16:9, horizontal ground plane and level horizon, clear foreground space for standing character sprites, entrance draws the eye naturally at center-right, legible layers of plaza, plants, glass facade and sky. Avoid an enormous landmark or a fantasy castle.
Constraints: no people, no characters, no cars close to camera, no readable signs, no logos, no watermark, no typography. Finished high-resolution game art, no UI.

## atelier-midnight.png

Source edit target: `packages/app/public/assets/art/atelier-golden-hour.png`. Inspected with view_image before editing. Original remains intact.

Use case: lighting-weather.
Asset type: 16:9 finished cinematic background illustration for a Korean visual novel.
Input image 1 is the EDIT TARGET: the existing golden-hour art atelier. Preserve this exact room, perspective, framing, geometry, window-mullion grid, cabinetry, floorboards, every easel and canvas, paintings, bookcases, hanging plants, curtains, jars, brushes, stool and work tables in their exact positions. This is the SAME room several hours later, not a redesigned room.
Primary request: Change ONLY the time of day, weather and lighting to a late evening after dark during steady rain. The large windows now show deep rain-blue night and dark leafy silhouettes, with subtle rain streaks on the outside glass. Replace ALL direct golden sunlight and hard sunbeam window patterns on the floor with soft cool blue window ambient light. Existing desktop/task-lamp positions provide restrained warm amber pools of work light, illuminating canvas edges, jars, brushes, wooden tables and part of the floor. The existing plants and curtain arrangement remain unchanged.
Style: match the target's exquisite painterly semi-realistic illustration, detailed paint texture, realistic materials, rich but controlled warm/cool lighting. Keep the room richly readable for story dialogue; atmospheric but not underexposed. No colored stage spotlights.
Composition invariants: original 16:9 camera position and field of view; maintain central open floor space for character sprites. Keep all the original objects and artwork, with consistent count and exact placement; no new easels, no new furniture, no people. Do not alter wall/window geometry.
Avoid: remaining daylight or sun patches, sunset skies, an outdoor scene, extra characters, readable writing, logos, watermark, UI. Produce only the finished night variation.

## rain-umbrella-cg.png — 원고와 손의 행동 일치

Source edit target: `packages/app/public/assets/art/rain-confession-cg.png`. Inspected with view_image before editing. Original remains intact.

Use case: precise-object-edit.
Asset type: narrative event CG for a Korean visual novel, finished 16:9 illustration.
Input image 1 is the EDIT TARGET. Preserve the same two adult hands and their identities, skin tones, delicate traces of blue paint on fingers, the light linen sleeve entering from the left, the navy raincoat sleeve entering from the right, painterly semi-realistic texture, rain-wet skin and cloth, intimate cinematic close-up, shallow depth of field, and the warm violet/amber city-light bokeh behind them.
Required story correction: REMOVE THE CANVAS COMPLETELY. There must be no canvas, painting, frame, board or flat object in the foreground. Instead the two adult hands gently share ONE BLACK UMBRELLA HANDLE: one hand naturally wraps the handle and the other lightly overlaps it in a shared grip, anatomically convincing fingers and wrists. The handle is a single dark black curved grip with one slender straight shaft visibly connecting upward to the umbrella.
Replace the transparent plastic canopy with an OPAQUE BLACK FABRIC UMBRELLA. A curved upper canopy edge spans the top of the image, with fine rain droplets catching ambient light at the edge. It is black woven fabric, not clear plastic; do not show the sky through it. Keep the hands as the emotional focal point in the middle foreground.
The lower foreground now reveals softly out-of-focus rain-wet pavement and warm reflected lights behind the shared handle, with no painting remaining. Keep the original city location, bokeh palette and rainy nighttime mood, same framing and no faces. A quiet moment of mutual trust under one umbrella.
Constraints: exactly two adult hands, one umbrella and one handle; correct anatomy, no extra fingers/arms, no duplicated handles, no text, no watermark, no UI. Preserve high detail and the original illustration style.
