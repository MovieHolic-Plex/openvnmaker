# 추가 전용 CG와 작업 포즈 제작 기록 — 2026-09-06

제작 방식: Codex 내장 `image_gen`으로 자산마다 별도 생성 또는 참조 편집. 외부 이미지 API, 앱 내부 생성 기능, CLI 생성, 픽셀 후처리를 사용하지 않았다. 생성 원본을 보존하고 채택본을 `packages/app/public/assets/art/`에 새 이름으로 복사했다. 기존 파일을 덮어쓰지 않았다.

원고 담당자와 사건을 협의했으며 최종 적용 앵커는 `narrative-cues.json`을 따른다. 각 출력의 인물, 소품, 손, 문서 가독성, 유리 수량을 직접 검수했다. 포즈 원본은 RGB 녹색 배경이다. 실제 투명 PNG가 아니며 기존 `ArtImage`의 chromaKey 렌더러로 표시한다. 요청색은 #00FF00이고 생성 배경은 근접 녹색이므로 픽셀 수치를 기록했다.

| 파일 | 크기 | 바이트 | SHA-256 |
|---|---:|---:|---|
| empty-sixth-frame-cg.png | 1672×941 | 2424516 | 65f8a502067e4321cbcb06ee15a890d90785226295ac749f9044676a445c5836 |
| seorin-packing-cg.png | 1672×941 | 1843816 | 2d45edfebc585804a3e8f9ec8c21aeea128821adb27ef780530057f7638c6fa2 |
| recorder-ribbon-cg.png | 1672×941 | 2196362 | 6142b185d229f14fc8a8c9c6c424c25402e9d10b8382365304a61c8fa4b3830d |
| records-comparison-cg.png | 1672×941 | 2160917 | 60b11c3a6f79941007a4a4e0cc9ffb36cc05b011d047dc47ffbd75a2865c967f |
| glass-assembly-cg.png | 1672×941 | 2114182 | a349b0ad079de452c82e56f84a8493b11abf192f301df7577389bd3a4f3167ef |
| first-visitor-cg.png | 1672×941 | 2344676 | d6d91c120e7bda5bfb05e1f81ebd66e7ac5c1ae08fc76e23210dde7a9277b0bb |
| seorin-working.png | 1024×1536 | 1883129 | 492603056b74978419bf1a72282e6eaa6077f954f0c0f4a5b424dcbb5d4c72f0 |
| dohyun-working.png | 1024×1536 | 1868512 | 27df838bf0de44c9b35a866bcaab2c6cdf1d359052aa36c2f2e5e8c28175675b |
| mirae-reading.png | 1024×1536 | 1841771 | 4f4c9d6a3418599499b2a2741854202b112793858e8e6a37887e14f599e7a54f |

## empty-sixth-frame-cg.png

s03: 5장의 청색 안료 유리와 사라진 6번째 패널의 빈 금속틀·풀린 고정대. 첫 출력은 뒤편 유리가 4장뿐이라 채택하지 않았고, 내장 편집으로 1장을 추가했다. 최종 5+1을 눈으로 세었다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-64474e10-83a4-4d72-beb8-e94043994d28.png`

참조: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-525f4d3a-63f6-4a08-8bd1-f943d8f7f2a9.png`

```text
Use case: precise-object-edit. Edit target: provided illustration. Preserve the entire magnificent rainy university atrium, blue and amber lighting, viewpoint, wet reflections, and foreground empty metal frame with its two loosened fixing clamps EXACTLY. Correct only the number of installed blue glass panels. Currently FOUR blue-painted narrow upright glass panels are visible behind the empty foreground frame. Add ONE additional matching narrow blue-pigment glass panel on a low rectangular metal base in the far-left background, immediately LEFT of the smallest currently installed panel and to the right of the easel/potted plant; adjust that small background area only as needed. There must be FIVE blue-painted installed glass panels visibly countable plus ONE foreground completely empty metal frame, SIX installation positions total. Keep the foreground frame entirely glassless, with open view through it. Match receding perspective. The large left-side canvas/easel is background studio furniture, not one of the five panels. No people, no words, no numbers or labels. 16:9 wide 1672x941 richly detailed painterly semi-realistic VN CG. Change only the missing additional panel.
```

## seorin-packing-cg.png

s06a: 유리가 아직 없는 시점. 서린이 바닥에 종이를 펴고 우진 두 손이 끝을 누른다. 총 3손. 문자가 보이지 않는 종이 뒷면. 탁자나 장갑을 새로 만들지 않았다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-e32194dd-4e70-4c38-b6ee-89a7f6a4fee7.png`

참조: `atelier-midnight.png`, `seorin-neutral.png`

```text
Use case: illustration-story. Premium intimate visual novel event CG, 16:9 wide approximately1672×941.
Reference 1 is the atelier location, lighting and painterly-style reference. Reference 2 identifies Seorin's ivory rolled linen sleeve, indigo apron and adult hand proportions; do not show her face in this close-up and do not include the green backdrop.
The exact story action: Seorin, adult23, is spreading and folding packing paper on the wooden atelier FLOOR while a male adult24 friend gently presses down the two opposite edges so a draft cannot lift them. They are preparing packing materials before deciding what to do with a missing glass panel; the missing panel is NOT present.
Composition: intimate angled overhead medium close-up of broad gently creased off-white packing/newsprint sheets on rich wood floor. The blank reverse sides face the camera; show tactile paper fibers and folds but absolutely no invented print, text or symbols. At left one slender adult woman's hand with a cobalt-blue stain on the thumb, ivory rolled sleeve, adjusts a fold. From the lower-right foreground exactly two adult male hands in dark navy sleeves gently press two paper corners. Exactly three natural hands total, relaxed and anatomically correct, no fingers intertwined. A subtle corner of indigo apron at left; small unmarked roll of packing cord to the side.
Lighting: amber task-lamp glow across paper and skin, blue rainy-window reflections in darker floor, softly blurred easel legs far back. Quiet tentative reconciliation expressed through cooperative hands, not romance poses.
Style: richly detailed painterly semi-realistic anime VN illustration matching refs, tactile cloth/paper/skin, delicate light, cinematic focal hierarchy.
No faces, no additional bodies or hands, no glass panel, no broken material, no letters, numbers, newspaper glyphs, logos, UI, border or watermark. One finished cinematic illustration.
```

## recorder-ribbon-cg.png

s06b: 살구색 끈으로 묶인 낡은 휴대 녹음기 케이스를 도현의 손이 덮는다. 닫힌 케이스이며 재생 화면·음파가 없다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-78f320cd-7856-46da-a0df-dea4d876d98b.png`

참조: `archive-room.png`, `dohyun-neutral.png`

```text
Use case: illustration-story. Premium story-specific visual novel CG, 16:9 approximately1672×941.
Reference1 is the night archive room's wood, lamps and blue/amber lighting. Reference2 defines adult24 Dohyun's warm beige rolled overshirt sleeve and skin tone, not a face shot. Do not include either reference as a picture inside the output.
Exact scene: an old compact black portable field recorder and its protective case lie on the archive workbench, wrapped loosely with a distinctive soft APRICOT-colored fabric cable tie. Dohyun gently places one adult male hand over the closed protective lid to stop an impulsive attempt to switch on the recorder. The equipment is silent and not playing.
Composition: exquisite three-quarter tabletop close-up, recorder's worn black corners and tiny physical buttons glimpsed at the edge of the case; no visible legible LCD or text. One warm-beige-sleeved hand resting protectively across lid, natural fingers slightly spread; the apricot tie crosses near his wrist and curls on the wood. Blank cardboard boxes and paper envelopes softly out of focus behind, one tiny metal knob catches amber light. Do not use a large reel-to-reel studio machine; this is a small practical hand-carried digital recorder in its case.
Emotion: a quiet boundary, practical care and hurt held back. Luminous amber worklamp against blue rain window bokeh, rich tactile wood, black leather/plastic, fabric webbing and skin.
Style: cinematic painterly semi-realistic anime visual novel illustration matching existing references.
Exactly one adult hand, no faces, no extra limbs, no logos, text, labels, numerals, UI, borders or watermark. No headphones on ears, no running waveforms, no sound graphics. One complete intimate CG.
```

## records-comparison-cg.png

s08: 최초 동의 기록의 청색 책갈피와 나중 요청의 노란 책갈피. 미래의 산호색 소매 1손. 문서는 흐린 선 질감으로 가짜 날짜나 개인 문장을 읽을 수 없다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-a44ea439-6215-4813-874d-21931c3ede74.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/archive-room.png`, `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/mirae-neutral.png`

```text
Use case: illustration-story. Asset type: premium cinematic Korean visual novel event CG, landscape 16:9 about 1672x941. Reference 1 establishes this story's richly textured warm wood archive at rainy midnight, amber desk lamp and deep blue rain window; reference 2 supplies Mirae's muted coral cardigan and adult skin/hand styling only, DO NOT depict her face. Create an intimate overhead three-quarter close-up of TWO paper consent records spread SIDE BY SIDE on the worn archive desk, one with a small BLUE rectangular bookmark tab at its upper edge and the other with a small YELLOW bookmark tab. An adult woman's single hand with muted coral cardigan cuff gently points between their corresponding record fields, comparing the old consent with a later withdrawal request. The legal text must NOT be readable or invented: keep document printing out of focus and partly concealed under folded cover slips, rendering only subtle gray line textures; absolutely no legible alphabet, numbers, Korean letters, symbols or signatures. Keep the two colored bookmark tabs clearly distinct and the two sheets separated. A quiet closed dark notebook, a simple metal paper clip, soft desk-lamp pool, many layers of archive folders in background, soft blue wet-window reflections create rich mood and material detail. No recorder playing, no screens, no faces, no floating UI, no melodramatic evidence-board cliches. The story moment is patient human comparison and respect for changed consent. Painterly cinematic semi-realistic anime narrative illustration, natural anatomy and believable hand, tactile paper fibers, calm mysterious amber-cobalt palette.
```

## glass-assembly-cg.png

s14: 서린의 측정, 도현의 나사 조임. 청색 안쪽선의 빈 금속틀과 뒤의 완성 유리 5장. 얼굴 없이 소매로 인물을 연결했다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-e9046389-7c3e-4ba0-bb35-2b514bde64c8.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/glass-exhibition-dawn.png`, `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/seorin-neutral.png`, `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/dohyun-neutral.png`

```text
Use case: illustration-story. Asset type: cinematic Korean visual novel event CG, wide 16:9 1672x941. Reference 1 gives the exact modern university glass atrium, narrow metal glass display frames and delicate cobalt-blue paint marks; reference 2 gives Seorin's rolled ivory sleeves and blue paint-stained apron; reference 3 gives Dohyun's rolled beige overshirt sleeve. Create a richly textured low three-quarter CLOSE-UP during careful assembly before dawn, cool blue window light with warm portable work light. Foreground focus is ONE EMPTY metal frame's bottom support and inner edge, absolutely NO glass filling this foreground sixth frame. A very thin cobalt blue line has been freshly painted along its inner metal edge. At lower right Dohyun's adult hand in beige rolled sleeve tightens one small base screw with an ordinary short screwdriver. At lower left Seorin's adult hand in ivory rolled sleeve holds a plain unmarked measuring tape taut across the gap between two bases; her other hand can stay outside frame. Behind them in soft focus stand FIVE complete narrow glass panels with blue pigment in an airy line. Perspective must make them FIVE countable panels; foreground empty frame is sixth. Show delicate cobalt pigment translucency, metal bolts, old brush laid on a folded rag near bottom edge, a safely coiled unplugged black audio cable off the walkway, morning approaching behind wet large atrium windows. Crop all bodies and faces out, only TWO natural anatomically correct hands enter at lower edges; do not invent protagonist face. No words, labels, digits, measurements, screen UI, candles, shards, blood, broken glass, or fireworks. Emphasis: cooperative careful labor, the visible meaningful empty sixth frame, premium semirealistic hand-painted VN story art.
```

## first-visitor-cg.png

s17a: 아침 청소 직원 1명과 옆에 둔 카트. 5장 유리와 유리가 없는 여섯째 틀. 기존 전시의 구조·햇빛을 참조 편집했다.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-9ca2a502-bed3-4f9f-817a-e39e6d944201.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/glass-exhibition-dawn.png`

```text
Use case: precise-object-edit / illustration-story. Asset type: new cinematic visual novel event CG, landscape 16:9 1672x941. Use the provided glass-gallery picture as the exact location reference and edit target. Preserve its beautiful architecture, low morning sunbeams, floor leaf-shadow reflections, materials, FIVE existing blue-pigment glass panels, and serene golden-cool morning palette. Make the RIGHTMOST sixth frame truly EMPTY: remove the glass completely, show open uninterrupted room through its center, keep its slender rectangular metal outline and low weighted base, add a fine cobalt blue stroke along its inner metal edge. Add ONE adult Korean university cleaning employee, a modest middle-aged woman in a plain muted gray-blue work uniform and comfortable shoes, viewed from behind in three-quarter silhouette in the middle-right walking space, quietly looking toward the morning leaf shadows through the empty sixth frame. Her face is turned away, unfeatured, not a new romantic character. She is small in the composition, human and unposed. Park her unobtrusive cleaning trolley with folded cloths, plain bucket, and mop at the far right room entrance, well aside from the artwork. Keep the five painted glass panels all separately visible and countable, plus this sixth EMPTY metal frame. The event is the exhibition's FIRST visitor in the quiet after rain around 7 am. No crowd, no other people, no signs, no readable text, no labels, no watermark, no floating UI. Rich polished painterly semi-realistic VN story art with breathable depth and meaningful emptiness.
```

## seorin-working.png

기존 중립 얼굴·긴 남색 머리·아이보리 셔츠·청색 앞치마를 고정한 붓+천 포즈.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-6ded9f9a-7050-48ac-9858-13118d0f956a.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/seorin-neutral.png`

```text
Use case: identity-preserve. Asset type: alternate work pose sprite for Korean VN. Edit the reference Seorin sprite into a new working pose. She is the SAME 23-year-old adult woman, long dark navy-black hair, blue-gray eyes, ivory rolled-sleeve linen shirt, deep indigo apron stained cobalt and cream, dark trousers. Change only her pose and subtle expression: both hands are out of pockets, right hand holds a slender small wooden paintbrush with a tiny cobalt-pigment tip delicately around chest-to-waist height, left hand holds a small folded off-white wiping cloth around waist height. Her gaze tilts gently down toward the brush, quiet concentrated expression, slight three-quarter lean of shoulders as she pauses during careful painting. Keep her face clearly visible with the same bone structure and same loose long hair, no new hairstyle or accessories, no big canvas or table. Hands need natural five-finger anatomy and a believable delicate brush grip. Preserve the exact reference person's face, apparent age, facial proportions, hair silhouette and color, body proportions, clothing fabric colors and accessories. Same richly detailed painterly semi-realistic anime rendering, refined natural anatomy and quiet emotion. One isolated adult character only, portrait 1024x1536, entire head and hair fully in frame with generous breathing room, crop at mid-thigh or just above knees matching reference scale. Perfectly uniform flat vivid GREEN #00FF00 background for runtime chroma key; no gradients, no shadows on background, no floor, no scenery, no green in clothing/props/hair/reflections, no painted checkerboard, no white halo or outline, no letters or logos. Keep crisp clean edges; do not cut off elbows, hands, or props.
```

## dohyun-working.png

기존 중립 얼굴·짧은 웨이브 머리·베이지 겉옷·먹색 티를 고정한 드라이버+살구색 끈의 케이블 포즈.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-ca99a9c6-8e3c-45ec-b228-c2388a0f7e77.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/dohyun-neutral.png`

```text
Use case: identity-preserve. Asset type: alternate working pose sprite for Korean VN. Edit the reference Dohyun sprite into a new practical work pose. He is the SAME adult 24-year-old Korean man with wavy short dark brown hair, brown eyes, warm beige overshirt rolled to forearms, charcoal T-shirt, dark trousers. Change only pose and subtle expression: both hands out of pockets, one hand loosely holds a compact ordinary screwdriver pointed safely downward at waist height, the other hand supports a small neatly coiled black audio cable held against his lower torso with a short apricot-colored cloth cable tie around the coil. Head tilted slightly in thought with calm focused eyes aimed toward the viewer's lower-left, lips relaxed, shoulders comfortable three-quarter orientation. Keep tool and coil inside silhouette width, no dramatic wielding. Natural hands, no extra fingers, no machinery or table or receiver. The same softly lit face and familiar wavy hair must remain immediately recognizable. Preserve the exact reference person's face, apparent age, facial proportions, hair silhouette and color, body proportions, clothing fabric colors and accessories. Same richly detailed painterly semi-realistic anime rendering, refined natural anatomy and quiet emotion. One isolated adult character only, portrait 1024x1536, entire head and hair fully in frame with generous breathing room, crop at mid-thigh or just above knees matching reference scale. Perfectly uniform flat vivid GREEN #00FF00 background for runtime chroma key; no gradients, no shadows on background, no floor, no scenery, no green in clothing/props/hair/reflections, no painted checkerboard, no white halo or outline, no letters or logos. Keep crisp clean edges; do not cut off elbows, hands, or props.
```

## mirae-reading.png

기존 중립 얼굴·밤색 단발·산호색 카디건·크림 티를 고정한 기록 폴더 읽기. 청색/노란 책갈피와 인쇄 없는 폴더 뒷면.

생성 원본: `C:\Users\ubbio\.codex\generated_images\01a07105-0be8-7602-971c-afd78bce39cb\exec-c2ff0ad2-4fe1-4b40-bb45-6251802fc5da.png`

참조: `C:/Users/ubbio/Documents/vnmaker/packages/app/public/assets/art/mirae-neutral.png`

```text
Use case: identity-preserve. Asset type: alternate reading pose sprite for Korean VN. Edit reference Mirae into a careful reading pose. She is the SAME 22-year-old adult Korean woman, neat chestnut chin-length bob, brown eyes, muted dusty-coral cardigan over cream T-shirt, high-waist charcoal trousers. Change only pose and subtle expression: both hands out of pockets, holding a slim kraft document folder open at lower chest-to-waist height, looking downward with focused calm eyes and gently closed lips. Show the plain OUTSIDE/BACK of the folder facing the viewer, no text or print anywhere. Two small bookmark tabs, one blue and one pale yellow, emerge subtly at the upper folder edge. Her right hand supports its lower corner, left hand carefully separates one cream sheet at top; natural hands and plausible paper grip. Face remains fully visible and the exact same reference identity; keep same bob silhouette, no spectacles or invented accessories. No desk or furniture. Preserve the exact reference person's face, apparent age, facial proportions, hair silhouette and color, body proportions, clothing fabric colors and accessories. Same richly detailed painterly semi-realistic anime rendering, refined natural anatomy and quiet emotion. One isolated adult character only, portrait 1024x1536, entire head and hair fully in frame with generous breathing room, crop at mid-thigh or just above knees matching reference scale. Perfectly uniform flat vivid GREEN #00FF00 background for runtime chroma key; no gradients, no shadows on background, no floor, no scenery, no green in clothing/props/hair/reflections, no painted checkerboard, no white halo or outline, no letters or logos. Keep crisp clean edges; do not cut off elbows, hands, or props.
```

## 파일 형식 확인

Node PNG 디코더를 읽기 전용으로 import하여 픽셀을 확인했다. 쓰기·알파 변환 함수는 호출하지 않았다. 9개 모두 PNG color type 2(RGB), 알파 픽셀 0이다.

| 포즈 | 좌상단 RGBA | 녹색 후보 픽셀 비율 |
|---|---|---:|
| seorin-working.png | 35, 229, 37, 255 | 57.82% |
| dohyun-working.png | 24, 230, 25, 255 | 53.79% |
| mirae-reading.png | 17, 230, 28, 255 | 57.03% |

녹색 후보 기준은 G > 150, G > 1.5R, G > 1.5B. 배경 존재 확인용이며 실제 경계 품질은 Studio 화면 QA로 별도 확인한다.
