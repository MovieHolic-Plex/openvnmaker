# Rich VN artwork — 2026-09-05

Three new original production assets were generated with the **built-in image_gen tool**, using the imagegen skill. No fallback CLI, API key, remote source artwork, or existing user artwork was used. Images were copied into the project; original generated outputs remain in the default Codex generated-images folder.

| Asset | Role | Dimensions | Visual QA |
|---|---|---|---|
| `packages/app/public/assets/art/nocturne-atrium.png` | Night environment / production dashboard hero | 1672 × 941 | Clear central staging area, detailed glass and wet reflections, no people or text. |
| `packages/app/public/assets/art/atelier-golden-hour.png` | Day environment | 1672 × 941 | Open central floor, layered art materials and warm natural light, no people or text. |
| `packages/app/public/assets/art/rain-confession-cg.png` | Event CG | 1672 × 941 | Two adult hands, no faces, detailed rain and paint texture, usable lower dialogue region. |

All three outputs were visually inspected directly after generation. Their images use approximately 16:9 composition; the VN stage may apply a negligible cover crop because the produced dimensions are 1672 × 941. No upscaling or artificial detail claims were added.

The event CG deliberately avoids character faces so that it does not introduce an inconsistent face into the existing character cast. It is a story-specific illustration, not a sprite. The two environments share violet-blue / amber and painterly material treatment across night and daylight.

## Exact final prompts

### nocturne-atrium.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, widescreen 16:9, as high resolution as possible.
Primary request: a richly detailed, emotionally luminous university arts building glass atrium after rain at blue hour. No people.
Scene: a contemporary Korean arts university; lofty glass roof and bronze metal framing, warm glowing painting studios along the sides, rain droplets on huge windows, distant city lights and lush foliage through the glass. A few curated student canvases face away from the camera, tasteful potted ferns, sculptural bench, subtle imperfect traces of creative life.
Style: exquisite painted anime film background art, precise elegant architecture, atmospheric depth, sophisticated painterly materials, rich handcrafted detail, luminous yet natural colors, premium story-game key environment.
Composition: immersive wide angle at standing eye level, strong perspective into the center, balanced architecture; central lower-middle floor kept open so characters can stand there. Foreground dark glossy wet tiles and luminous rain reflections provide depth. Visually compelling focal glow near center-right, not a flat decorative wallpaper.
Lighting: blue-violet dusk outside against warm honey-amber interior pools, delicate reflected highlights and soft mist, memorable quiet anticipation before a confession.
Constraints: environment only, no people, no silhouettes, no lettering, no logos, no UI, no frames, no watermark. Keep the bottom fifth readable behind a dialogue box. Deliver exactly one finished landscape image.
```

### atelier-golden-hour.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, wide 16:9 landscape, high resolution.
Primary request: an exquisitely detailed university painting atelier in late golden afternoon; empty of people.
Scene: a beautiful lived-in Korean arts university painting studio, tall mullioned windows looking toward trees, antique wood worktables and weathered easels, stacked canvases with subtle abstract paint studies, glass jars of brushes, pigments, crumpled soft linen, ceramic water vessels, books and trailing plants. Carefully observed creative clutter around the edges, not messy everywhere.
Style: rich hand-painted anime feature-film background, fine material detail and convincing spatial depth, elegant sophisticated visual storytelling, subtle brushwork combined with precise drawing.
Composition: inviting expansive wide view at normal eye height, diagonal sunbeams and cast window shadows crossing honey-colored wood floor; layered easels at left and shelves at right frame a clear central stage area for VN character sprites; tactile foreground paint jars in one corner, no giant objects obscuring the view.
Lighting: extraordinary warm golden hour light, luminous floating dust, sunlit linen and paint texture, cool teal and sage shadows, delicate glints on glass, tender nostalgic creative atmosphere. This is the bright companion to a nocturnal violet-blue and amber arts atrium.
Constraints: no people, no faces on paintings, no readable lettering, no signs, no logos, no UI, no border, no watermark. Bottom fifth must stay visually calm enough behind game dialogue. Deliver one beautifully finished landscape illustration.
```

### rain-confession-cg.png

```text
Use case: illustration-story.
Asset type: emotional event CG illustration for a premium visual novel, cinematic 16:9 landscape.
Primary request: a deeply intimate visual-novel story moment, two adult art students' hands softly touching at the edge of a rain-damp paint-stained canvas under a transparent umbrella after dusk, no faces.
Subject and composition: an exquisite close-up, one slender adult hand entering from the left with an ivory linen sleeve, another slightly broader adult hand entering from the right with a dark navy sleeve. Exactly two visible hands, natural correct anatomy and five fingers each, their fingertips gently resting together rather than complicated intertwined fingers. Small genuine traces of blue and ochre paint on the fingertips. The focal hands sit in the center and upper-middle; below them the edge of a small canvas shows beautiful textured abstract washes of paint, never words. Transparent umbrella arcs and rain beads frame the upper edge. Only arms and hands, no heads or faces, no additional fingers or hands.
Backdrop: softly out-of-focus rainy campus and distant violet-blue city bokeh, warm amber lights reflected on wet stone. Very shallow narrative depth of field, tactile skin, luminous droplets on umbrella, delicate fabric and canvas weave.
Style and mood: exquisite cinematic painted anime film illustration with refined adult proportions, expressive restrained gesture, extraordinary rich blue-violet and amber light, sophisticated painterly texture, tenderness and hesitant confession, romantic but quiet and sincere, premium Japanese/Korean visual novel art direction. One clear intimate focal moment with compelling visual hierarchy.
Constraints: adults only; fully clothed visible wrists and forearms; no faces, no bodies, no crowds, no written text, no logos, no UI, no border, no watermark. Keep the bottom fifth softly detailed to allow an overlaid dialogue box. Deliver exactly one complete landscape image.
```


## Story production expansion — 비가 남긴 빈칸

The following six additional original images were generated with the built-in image_gen tool, with one generation request per asset. Each was inspected visually and copied into `packages/app/public/assets/art/`. They share the blue-violet night / amber interior palette with the initial collection. All six are 1672 × 941. No in-app image AI endpoint or fallback CLI was used.

Specific checks: the rooftop has intact safety railings and a side storage chest; the archive includes a vintage recorder and apricot-colored cable tie; the ending gallery has exactly six freestanding frames with the rightmost one clear; the pigment CG depicts one adult hand and intact smooth-edged glass.

### rain-library.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, wide 16:9 landscape, high resolution.
Primary request: an empty Korean arts university library reading room at night during heavy rain, a richly detailed quiet place where two students can compare old exhibition records.
Scene: tall floor-to-ceiling rain-streaked windows, dark blue trees and campus lights outside; warm oak bookshelves receding deeply, a long side reading desk with two small warm amber lamps, a few unmarked folders and loose papers turned away from the viewer, old art books with no legible titles, ceramic mug, subtly damp folded umbrella near a doorway. Focus on thoughtful, tactile environmental storytelling.
Style: exquisite cinematic painted anime film background, sophisticated painterly realism and delicate hand-crafted textures, refined architecture and layered atmospheric depth, cohesive with a blue-violet and amber rain-soaked university arts atrium.
Composition: immersive wide view at adult eye level, slight diagonal perspective, side tables and book stacks frame an open central lower-middle floor area for VN character sprites; rain windows in the upper center-right and warm lamps at the left. No desk spanning the entire foreground.
Lighting: deep midnight cobalt and violet rain against pools of honey-amber desk light, subtle window reflections, wood grain and paper texture, quiet investigative tension.
Constraints: absolutely no people or silhouettes, no readable lettering or numerals anywhere, no signage, no logos, no UI, no border, no watermark. Bottom fifth calm enough for a dialogue box. Exactly one finished environment illustration.
```

### midnight-cafe.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, wide 16:9 landscape, high resolution.
Primary request: an empty intimate university campus cafe at midnight during rain, a beautiful haven where old friends confront a difficult shared history.
Scene: small contemporary Korean arts-campus cafe, warm walnut and honey-colored wood, amber pendant lamps above a side counter, a beautiful espresso machine, ceramic cups and glasses, textured plaster, leafy plants, a few wood chairs and round tables at the sides. Broad rain-streaked windows reveal a wet blue-violet campus courtyard and softly blurred city lights. Closed cafe, but welcoming interior lights remain on. An unbranded pitcher and two half-finished tea cups on a side table suggest a recent conversation.
Style: exquisite cinematic painted anime film background, precise architectural drawing, sophisticated painterly realism, extraordinary observed material detail and atmospheric depth, cohesive with a blue-violet and amber university art-atelier visual novel.
Composition: expansive eye-level view across the room toward rain windows; compelling diagonal depth, tables to the sides and an uncluttered central walking area so character sprites can stand naturally. Keep objects modestly scaled, no large foreground furniture covering the whole image.
Lighting: warm amber interior islands against sapphire rain outside, subtle glass reflections, tactile wood grain, small copper highlights, intimate melancholy and gentle warmth, richer than a generic stock cafe.
Constraints: no people, no silhouettes, no faces, no readable menus or labels, no letters or numerals, no signage, no logos, no UI, no borders or watermark. The bottom fifth must remain calm for a dialogue overlay. Exactly one finished landscape environment image.
```

### rooftop-before-dawn.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, high-resolution 16:9 landscape.
Primary request: a richly detailed safe university arts-building rooftop just before dawn after rain, with luminous blue city lights and a distant lavender horizon.
Scene: contemporary Korean university rooftop terrace, rain-slick stone pavers reflecting soft blue and amber light, sturdy waist-high safety railings all along the edges, a small practical wooden weatherproof storage chest tucked at the left side beneath an overhang, simple ventilation housings far to one side, discreet potted grasses. The storage chest is intact and closed; it can plausibly hold one wrapped rectangular artwork panel. Distant city hills and small lit windows, no famous landmarks.
Style: exquisite painted anime feature-film background, sophisticated painterly material realism, precise perspective, refined atmospheric depth and finely observed wet surfaces. Same premium university mystery visual-novel world with blue-violet rain and warm amber accents.
Composition: wide eye-level view, flat accessible safe terrace floor in the center and foreground for character sprites, horizon in upper third; railings are clearly visible and secure. The storage chest must be a side object, not the huge central focus. A softly glowing rooftop doorway at right offers warm visual balance.
Lighting: blue hour immediately before sunrise, deep cobalt city receding into violet mist, a thin pale peach light line near horizon, gentle puddle reflections, quiet resolution and anticipation.
Constraints: no people or silhouettes, no danger or damaged structures, no readable writing or signs, no lettering/numerals, no logos, no UI, no borders, no watermark. Lower fifth calm for dialogue overlay. Exactly one finished scene.
```

### archive-room.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel environment background, wide 16:9 landscape, high resolution.
Primary request: an intimate richly detailed university art archive and equipment storage room at night; this is a calm investigation scene about an old collaborative installation, not a horror setting.
Scene: warm aged wooden shelves with carefully stored canvas frames, rolled drawings, plain document boxes, folded protective fabric and small tools. On a sturdy side workbench at lower left sits a modest vintage portable audio recorder with two visible compact reels and an unlit display, its dark cable neatly bundled by a distinctive soft apricot-colored fabric cable tie. The recorder is a small believable clue within the room, not a huge close-up. Nearby unmarked folders and a wool cloth; a metal desk lamp casts warm light. A narrow rear window shows deep blue night and rain.
Style: exquisite painted anime film background with sophisticated painterly material realism, tactile wood grain, old metal, cloth and paper, precise spatial drawing, atmospheric depth, cohesive with a violet-blue and amber Korean arts-campus visual novel.
Composition: immersive wide view at standing eye height; shelving and objects frame the sides, central floor open enough for one or two character sprites; recorder clearly recognizable on side bench, rich yet orderly creative history. No equipment that seems running or playing.
Lighting: soft amber desk lamp and muted warm ceiling practical light, cool nocturnal window contrast, glints on recorder knobs, deep detailed shadows, quiet truth emerging.
Constraints: no people, no silhouettes, no legible writing or timestamps, no labels or numbers, no logos, no UI, no border, no watermark. No supernatural or threatening details. Keep lower fifth calm for dialogue. Deliver one completed environment illustration.
```

### glass-exhibition-dawn.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel ending environment background, high resolution 16:9 landscape.
Primary request: a breathtaking university glass exhibition gallery at dawn after an all-night rain, containing exactly SIX freestanding upright rectangular glass artwork frames; FIVE hold sparse subtle blue painted marks on transparent glass, and the SIXTH is intentionally completely empty and clear. The sixth empty rectangle is the emotional focal point of a story about respecting absence.
Scene: beautiful contemporary arts-university glass annex with tall windows, warm stone and polished wood, bronze metal structure, morning trees and a luminous calm campus outside, intricate small construction details and delicate reflected light. Six simple elegant display frames arranged in a loose shallow arc or gently staggered line across the midground so each is separately countable. Five panels have tasteful minimal blue pigment traces, airy and transparent, not opaque paintings. The far right sixth frame is entirely empty with no blue pigment, unobstructed light passing through.
Style: exquisite painted anime film background, refined architectural draftsmanship, sophisticated painterly materials and luminous atmospheric depth. Same rich blue-violet and amber university visual-novel world, now transformed by pale golden dawn.
Composition: wide eye-level view from gallery entrance; precisely six freestanding gallery frames distinct from the building windows. Clear foreground floor and generous breathing room, layered delicate shadows, highly detailed environment around deliberately minimalist artworks.
Lighting: first warm sunbeams cross cool dawn air and fine dust, wet outdoor reflections, translucent glass edges sparkle, hopeful quiet ending with emotional restraint.
Constraints: no people or silhouettes, no readable exhibit labels, no lettering, no numbers, no logos, no UI, no border, no watermark. Exactly six gallery art frames, not seven or five. Do not put pictures or text inside the sixth empty frame. Exactly one finished image.
```

### blue-pigment-cg.png

```text
Use case: illustration-story.
Asset type: emotional premium visual novel event CG, wide 16:9 landscape, high resolution.
Primary request: a cinematic macro close-up of a 23-year-old adult woman's hand carefully wiping a cobalt-blue paint trace from the edge of an intact glass art panel using a soft ivory cloth, on a rain-wet university rooftop at night.
Subject: exactly one adult feminine hand with natural five-finger anatomy, slender but realistically proportioned, entering from the left with an ivory rolled linen sleeve. Her hand safely grips a folded soft cloth against the smooth finished edge of a broad intact rectangular glass pane. Blue pigment smears gently into the cloth and a small transparent region is revealed. Subtle blue paint stains near the fingernails. No broken glass, no sharp fragments, no injury. The action conveys a difficult truth becoming clear, care, and release.
Composition: intimate close-up with the hand, fabric folds, smooth glass edge and blue pigment in the upper-middle; one glass plane angled across frame, blue marks remain sparse. Much of the image is softly focused violet-blue rooftop city bokeh and faint wet railings. No faces or whole bodies; just one forearm and one hand. Canvas wrapping can sit blurred at the bottom edge, not a second subject.
Style: exquisite cinematic painted anime illustration with refined realistic adult anatomy and sophisticated painterly texture, tactile woven cloth, delicate skin translucency, luminous glass edges and rain droplets, cohesive with a blue-violet and warm amber arts-campus story.
Lighting: rich night cobalt and plum against restrained warm reflected amber highlights, tender restrained emotional intensity, shallow depth of field and beautiful bokeh.
Constraints: exactly one visible hand, no extra fingers, no faces, no text or symbols, no writing or numerals, no logos, no UI, no border, no watermark. Keep bottom fifth soft for dialogue. Deliver exactly one finished landscape CG.
```


## Cast sprite production — RGB chroma-key source artwork

Twelve new character illustrations were generated/edited exclusively with the built-in image_gen tool, one image request per final file. Each PNG is **1024 × 1536, RGB (PNG color type 2)**. The files do **not** contain an alpha channel. They have a green source background intended for the game's runtime chroma-key renderer. No bitmap pixels were postprocessed or modified by a script.

| Actor | Final files in `packages/app/public/assets/art/` | Design |
|---|---|---|
| Han Seorin, adult 23 | `seorin-neutral.png`, `seorin-smile.png`, `seorin-sad.png`, `seorin-surprised.png` | Long navy-black hair, ivory rolled linen shirt, blue-stained indigo apron. |
| Bae Dohyun, adult 24 | `dohyun-neutral.png`, `dohyun-smile.png`, `dohyun-sad.png`, `dohyun-surprised.png` | Short wavy dark hair, warm beige overshirt, charcoal T-shirt. |
| Oh Mirae, adult 22 | `mirae-neutral.png`, `mirae-smile.png`, `mirae-sad.png`, `mirae-surprised.png` | Chestnut bob, dusty-coral cardigan, cream T-shirt. |

Visual checks: all twelve images inspected; one adult per image, coherent painted style, approximately matching mid-thigh framing and body scale, full hair silhouettes and elbows, consistent costume/pose across each actor's expressions. Expression differences remain readable without comic symbols. No source-file transparency was claimed.

Read-only PNG decoding verified every file's dimensions and color type. Green-dominant background covers 53.2–57.8% of pixels across the twelve sprites. The model output is not mathematically flat #00FF00: sampled green corners are approximately R15–42 / G228–244 / B12–42. Runtime rendering must use a tolerance or green dominance key, not exact RGB equality. The original bitmap files remain unchanged.

The first Seorin generation and a subsequent background-extraction request produced painted checkerboards in RGB, despite explicit transparent-PNG instructions. Those rejected variants remain only in the default Codex generated-images directory; they are not used as production sprites. A further built-in image edit replaced the checkerboard with green. The neutral Seorin artwork served as a style reference for the two other adults, while each actor's own neutral image served as the edit target for that actor's three expression variants.

### Original Seorin design prompt (identity reference; transparency result rejected)

```text
Use case: illustration-story.
Asset type: production-ready visual novel character sprite, portrait 2:3 canvas, high resolution, PNG with a genuinely transparent RGBA background.
Primary request: one beautiful refined adult Korean woman, Han Seorin, age 23, a university painting student. This is a standalone character layer for a game, not a portrait with scenery.
Character design: long straight deep navy-black hair falling to the waist with a natural soft fringe and a few fine loose strands, attentive dark blue-gray eyes, mature elegant face and realistic adult proportions. Ivory linen shirt with sleeves rolled to the forearms, a practical muted indigo painter's apron with subtle cobalt-blue and off-white paint stains, dark trousers. No jewelry or hair ornaments. Quiet, observant, guarded but approachable.
Expression: NEUTRAL, attentive, small relaxed closed mouth, level brows, looking toward the viewer.
Pose and framing: one character only, upright standing, slight three-quarter turn toward viewer's left while the face meets the viewer, relaxed shoulders. Both forearms naturally down, one hand gently resting against the apron pocket, fingers simple and anatomically correct. Crop from the top of the complete head to mid-thigh, no feet. Character occupies about 91% of image height; full hair silhouette and both elbows entirely inside the canvas, tiny clear margin above head and at sides. Consistent game sprite scale.
Style: premium hand-painted anime visual novel character art, clean delicate linework, sophisticated soft cel shading with painterly cloth and hair texture, luminous but restrained eyes, natural anatomy, expressive adult face, refined understated Korean/Japanese story-game aesthetic. Soft neutral frontal light with subtle cool highlights, no dramatic colored cast or hard environmental shadow.
Transparency requirement: all pixels outside the character must have genuine alpha transparency. NO white background, NO gray background, NO checkerboard graphic, NO floor, NO scenery, NO decorative glow, NO drop shadow or halo. Preserve clean antialiased hair edges.
Constraints: exactly one adult character, no text, labels, numbers, logos, UI, borders, watermark, props in hand, extra limbs or characters. Deliver one finished transparent character sprite.
```

### Final Seorin neutral background replacement

```text
Edit target: the attached adult woman character sprite.
Change ONLY the background. Replace the entire white/gray checkerboard with one perfectly flat SOLID chroma green #00FF00 RGB background, all non-character pixels green. The game renderer will key this color at runtime. No transparency checkerboard, no white or gray, no gradient, no scenery, no floor, no drop shadow, no outline halo. Avoid green tint or reflection on the character.
Preserve the adult woman's face and neutral expression, long navy-black hair, exact pose and camera framing, ivory rolled-sleeve linen shirt, blue-paint-stained indigo apron, dark trousers, hand in apron pocket and other hand down. Keep exact proportions, identity, clothing texture, colors, linework and lighting. One mid-thigh character image on a flat #00FF00 backdrop, same portrait 2:3 canvas as source. No other edits, no text, no new objects.
```

### dohyun-neutral.png

```text
Use case: illustration-story. Create a NEW character using the attached image only as a STYLE and SPRITE-SCALE reference; do not recreate that woman.
Asset type: premium visual novel character artwork, portrait 2:3, cropped complete head to mid-thigh, one adult.
Character: Bae Dohyun, 24-year-old Korean male industrial-design university student. Mature handsome but approachable face, softly wavy short dark brown hair, warm dark brown eyes, attentive NEUTRAL expression with a small relaxed closed mouth. Practical warm beige unbuttoned overshirt with sleeves rolled to forearms over a charcoal crew-neck T-shirt, dark slate trousers. No necklace, no logos, no tools in hand.
Pose: standing upright with relaxed shoulders, body slightly three-quarter toward viewer's left, face toward viewer. One hand casually inside trouser pocket, the other naturally down at his side. Complete hair and elbows inside canvas, cropped at mid-thigh, about 91% of canvas height, same visible body scale as the reference woman. Exactly one adult male.
Style: match the reference's refined mature anime/painterly realism, delicate clean linework, sophisticated soft cel shading, detailed fabric and hair, natural adult anatomy and quiet expressive eyes. Soft neutral frontal lighting, no strong environmental color cast.
Background: perfectly flat SOLID pure chroma green #00FF00 across all non-character pixels, for later transparent compositing. Absolutely no checkerboard, white, gray, texture, gradient, floor, glow, outline halo, cast shadow, scenery or environmental elements. Avoid any green clothing or green highlights on the subject.
Constraints: no letters, symbols, numbers, logos, UI, watermark, extra characters or limbs. One finished character artwork, not a contact sheet.
```

### mirae-neutral.png

```text
Use case: illustration-story. Create a NEW character using the attached image only as a STYLE and SPRITE-SCALE reference; do not recreate that woman.
Asset type: premium visual novel character artwork, portrait 2:3 canvas, cropped complete head to mid-thigh, one adult.
Character: Oh Mirae, 22-year-old Korean female university student and exhibition records coordinator. Mature but youthful adult face, short chestnut-brown bob ending at the jaw with tidy side-swept fringe, perceptive warm brown eyes. Attentive NEUTRAL expression, level brows and small relaxed closed mouth, intelligent and candid. Muted dusty-coral cardigan unbuttoned over a cream crew-neck T-shirt, charcoal high-waisted trousers. No jewelry or hair ornaments, no camera or clipboard in hand.
Pose: upright standing, relaxed shoulders, body very slightly three-quarter toward viewer's left, face looking toward viewer. One hand casually inside trouser pocket, other naturally down at side. Full head and elbows within canvas; cropped mid-thigh. Occupy about 91% of canvas height, same visible body scale as reference. Exactly one adult woman.
Style: match reference's refined mature anime/painterly realism, delicate clean linework, sophisticated soft cel shading, detailed hair and fabric, natural adult anatomy, quiet expressive eyes. Soft neutral frontal light, no strong environmental cast.
Background: perfectly flat SOLID pure chroma green #00FF00 across all pixels outside character, for game runtime chroma-key compositing. Absolutely no checkerboard, white, gray, texture, gradient, floor, glow, outline halo, shadow, scenery or environmental elements. Avoid green clothing and green reflected light.
Constraints: no lettering, labels, symbols, numbers, logos, UI, watermark, extra limbs, extra characters. One finished character artwork, not a contact sheet.
```

### seorin-smile.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to a gentle restrained smile of relief and trust: softly raised mouth corners, very small closed-lip smile, eyes warm and slightly softened. Preserve her quiet observant personality.
Keep Han Seorin's identity exactly: same face proportions and eye color, long navy-black hair and strand silhouette, head position and angle, complete standing pose, both arms/hands, ivory linen shirt, indigo paint-stained apron, trousers, all garment folds, colors, lighting, linework, framing and 1024×1536 portrait scale. Do not alter hair, body, pose, framing, outfit or skin tone. Only eyebrows, eyelids, gaze and mouth may change subtly to show the expression.
Keep the entire background perfectly flat SOLID chroma green #00FF00, exactly like the reference. No green reflected light on character, no checkerboard, no scenery, no gradient, no floor/shadow, no halo, no new props. No text, logos, icons, tears, extra limbs or other people. Deliver one finished character sprite image for this expression, not a sheet.
```

### seorin-sad.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to quiet sadness and regret: subtly raised inner eyebrows, softly lowered gaze still facing the viewer, mouth gently pressed with corners slightly lowered. No crying streams, no tears or decorative symbols.
Keep Han Seorin's identity exactly: same face proportions and eye color, long navy-black hair and strand silhouette, head position and angle, complete standing pose, both arms/hands, ivory linen shirt, indigo paint-stained apron, trousers, all garment folds, colors, lighting, linework, framing and 1024×1536 portrait scale. Do not alter hair, body, pose, framing, outfit or skin tone. Only eyebrows, eyelids, gaze and mouth may change subtly to show the expression.
Keep the entire background perfectly flat SOLID chroma green #00FF00, exactly like the reference. No green reflected light on character, no checkerboard, no scenery, no gradient, no floor/shadow, no halo, no new props. No text, logos, icons, tears, extra limbs or other people. Deliver one finished character sprite image for this expression, not a sheet.
```

### seorin-surprised.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to natural adult surprise at a difficult revelation: eyes slightly widened, eyebrows gently raised, lips parted a little. Restrained believable expression, not cartoon shock.
Keep Han Seorin's identity exactly: same face proportions and eye color, long navy-black hair and strand silhouette, head position and angle, complete standing pose, both arms/hands, ivory linen shirt, indigo paint-stained apron, trousers, all garment folds, colors, lighting, linework, framing and 1024×1536 portrait scale. Do not alter hair, body, pose, framing, outfit or skin tone. Only eyebrows, eyelids, gaze and mouth may change subtly to show the expression.
Keep the entire background perfectly flat SOLID chroma green #00FF00, exactly like the reference. No green reflected light on character, no checkerboard, no scenery, no gradient, no floor/shadow, no halo, no new props. No text, logos, icons, tears, extra limbs or other people. Deliver one finished character sprite image for this expression, not a sheet.
```

### dohyun-smile.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult man's FACIAL EXPRESSION to a warm sincere small smile, mouth corners gently lifted and a little friendly amusement in his eyes. A restrained reassuring designer friend, not a huge grin.
Keep Bae Dohyun's identity exactly: same face proportions and brown eyes, wavy dark-brown hair and strand silhouette, head position and angle, complete standing pose, both arms and hands, warm beige rolled-sleeve overshirt, charcoal T-shirt and dark trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and sprite scale. Only eyebrows, eyelids, gaze and mouth may change subtly. Do not alter his body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep all background pixels perfectly flat SOLID chroma green #00FF00, just as reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo, new objects. No text, logos, icons, tears, extra limbs or people. Deliver one finished character sprite for this single expression, not a contact sheet.
```

### dohyun-sad.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult man's FACIAL EXPRESSION to quiet hurt and regret: inner eyebrows slightly raised, eyes softly lowered but still toward viewer, mouth closed and gently downturned. Restrained adult vulnerability, no tears or crying graphics.
Keep Bae Dohyun's identity exactly: same face proportions and brown eyes, wavy dark-brown hair and strand silhouette, head position and angle, complete standing pose, both arms and hands, warm beige rolled-sleeve overshirt, charcoal T-shirt and dark trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and sprite scale. Only eyebrows, eyelids, gaze and mouth may change subtly. Do not alter his body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep all background pixels perfectly flat SOLID chroma green #00FF00, just as reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo, new objects. No text, logos, icons, tears, extra limbs or people. Deliver one finished character sprite for this single expression, not a contact sheet.
```

### dohyun-surprised.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult man's FACIAL EXPRESSION to natural contained surprise: eyebrows raised, eyes a little wider, mouth slightly parted as he has just learned a difficult fact. Believable adult expression, not comic exaggeration.
Keep Bae Dohyun's identity exactly: same face proportions and brown eyes, wavy dark-brown hair and strand silhouette, head position and angle, complete standing pose, both arms and hands, warm beige rolled-sleeve overshirt, charcoal T-shirt and dark trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and sprite scale. Only eyebrows, eyelids, gaze and mouth may change subtly. Do not alter his body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep all background pixels perfectly flat SOLID chroma green #00FF00, just as reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo, new objects. No text, logos, icons, tears, extra limbs or people. Deliver one finished character sprite for this single expression, not a contact sheet.
```

### mirae-smile.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to a bright but natural sincere smile: eyes warm and slightly softened, mouth corners clearly lifted, a gentle friendly adult smile with lips closed. Candid warmth without a huge cartoon grin.
Keep Oh Mirae's identity exactly: same mature face proportions and brown eyes, short chestnut bob with identical hair silhouette, head position and angle, complete standing pose and both arms/hands, dusty-coral cardigan, cream T-shirt and charcoal trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and scale. Only eyebrows, eyelids, gaze and mouth may change to show the expression. Do not alter body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep the entire background perfectly flat SOLID chroma green #00FF00 as in the reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo or props. No text, logos, icons, tears, extra limbs or other people. Deliver exactly one finished sprite for the single expression, not a sheet.
```

### mirae-sad.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to thoughtful sadness and concern: subtly raised inner eyebrows, softer lowered eyes still toward the viewer, a small closed downturned mouth. Quiet regret at misjudging someone, no tears or crying graphics.
Keep Oh Mirae's identity exactly: same mature face proportions and brown eyes, short chestnut bob with identical hair silhouette, head position and angle, complete standing pose and both arms/hands, dusty-coral cardigan, cream T-shirt and charcoal trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and scale. Only eyebrows, eyelids, gaze and mouth may change to show the expression. Do not alter body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep the entire background perfectly flat SOLID chroma green #00FF00 as in the reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo or props. No text, logos, icons, tears, extra limbs or other people. Deliver exactly one finished sprite for the single expression, not a sheet.
```

### mirae-surprised.png

```text
Edit type: identity-preserve character-expression variant. The attached image is the EDIT TARGET.
Change ONLY this adult woman's FACIAL EXPRESSION to clear but restrained adult surprise: eyebrows gently raised, eyes slightly wider, lips parted a little as she reconsiders a revealing detail. No comic shock or exaggerated facial distortion.
Keep Oh Mirae's identity exactly: same mature face proportions and brown eyes, short chestnut bob with identical hair silhouette, head position and angle, complete standing pose and both arms/hands, dusty-coral cardigan, cream T-shirt and charcoal trousers, all garment folds, colors, lighting and linework, same 1024×1536 portrait framing and scale. Only eyebrows, eyelids, gaze and mouth may change to show the expression. Do not alter body, pose, hair, outfit, skin tone, camera, crop or scale.
Keep the entire background perfectly flat SOLID chroma green #00FF00 as in the reference. No green reflection on character, no checkerboard, scenery, gradient, floor, shadow, halo or props. No text, logos, icons, tears, extra limbs or other people. Deliver exactly one finished sprite for the single expression, not a sheet.
```


## Ending continuity artwork — morning variants

Three final environment assets correct the ending's morning-time continuity. Each was produced with the built-in image_gen tool and saved as a new filename without changing its source image. All are **1672 × 941**.

- `packages/app/public/assets/art/morning-cafe.png`: the same cafe furniture, counter, camera and windows as `midnight-cafe.png`, now at 8 a.m. after rain. A second precise image edit replaced the first draft's toast/fruit breakfast with soup bowls, rice, water and Korean metal spoons/chopsticks to fit the manuscript's warm breakfast.
- `packages/app/public/assets/art/riverside-morning.png`: new sunlit post-rain riverside promenade, benches, willows, slow river and distant university city; the existing cafe was used only as a painterly style reference.
- `packages/app/public/assets/art/campus-morning.png`: an 8 a.m. lighting/weather edit of `campus-after-rain.png`, preserving the stone entrance pillars, gate, traditional building, glass annex and elevated glass bridge.

Visual inspection confirmed bright morning rather than midnight/sunset lighting, no people, and preserved architecture in both edited locations. The cafe table has soup and utensils; the riverside has an open central walking path. The unused toast/fruit draft remains only in the default generated-images directory.

### morning-cafe.png — time-of-day edit

```text
Edit type: lighting-weather, with a few small breakfast objects.
Asset type: richly detailed cinematic visual novel environment, wide 16:9, preserve the source's 1672×941 composition.
The attached cafe is the EDIT TARGET. Transform this exact midnight cafe into the same cafe at 8 a.m. on a bright morning immediately after rain.
Preserve the room's exact architecture, camera position and framing, window panes and central glass door, left wood counter, espresso machine and shelves, copper pendant lights, side tables and chairs, sofa, tall central plant, flooring and courtyard layout. It must be obviously the same familiar location, not a redesigned cafe.
Change the lighting and weather: outside is now clear cool-blue morning daylight with soft bright clouds and fresh sunlit wet green trees; rain has stopped and only lingering droplets remain on windows. The distant campus and city are lit by daytime sky, not glowing night windows. Soft blue-white morning sunlight washes into the cafe and catches the warm wood floor; gentle pale-golden highlights and airy reflected light, brighter shadows and hopeful restful mood. Interior pendant lights may remain very faintly warm but daylight dominates.
Add a modest light breakfast on the existing lower-right round table: two small plain ceramic plates with toast and a little fruit, two simple cups, one small water pitcher. Natural modest scale, never a lavish food ad. Do not rearrange furniture or add new tables.
Maintain exquisite painterly semi-realistic anime VN background art, precise architectural depth, rich tactile wood, glass and fabric, same mature understated visual-novel atmosphere.
No people, no silhouettes, no letters or menus, no readable text or numbers, no logos, no UI, no borders, no watermark. Clear central floor for sprites, lower dialogue area calm. Deliver one complete morning environment illustration.
```

### morning-cafe.png — final meal correction

```text
Precise-object-edit. The attached morning cafe image is the EDIT TARGET. Change ONLY the breakfast food on the existing lower-right foreground round table so that it is a modest Korean warm breakfast.
Replace the plate of toast and plate of fruit with two small simple ceramic bowls of warm clear soup with a few vegetables and egg, two modest small rice bowls, metal Korean spoons and chopsticks laid neatly beside them, and a tiny shared side-dish plate. No large feast, no oversized bowls. Keep the clear water pitcher. Remove the coffee cups from this table and replace with simple small water glasses. The meal should look like a light breakfast served at a small Korean riverside cafe-restaurant.
Preserve absolutely everything else: same room, exact furniture, espresso counter, plant, windows, morning lighting, bright wet campus outside, camera, composition and painterly style. No people, hands, written menus, letters, numbers, logos, borders, UI or watermark. Same wide 1672×941 framing. Only modify the small tabletop food area.
```

### riverside-morning.png

```text
Use case: illustration-story.
Asset type: premium cinematic visual novel ending environment background, high resolution wide 16:9, approximately 1672×941.
The supplied image is a STYLE REFERENCE ONLY: match its exquisite painterly semi-realistic anime film background style, rich natural materials, nuanced light and mature atmospheric depth. Make a new outdoor scene, not a cafe.
Primary request: a beautiful contemporary Korean university city's riverside walking path on a bright late-summer morning after the rain has stopped. A gentle hopeful place where adults can talk about the future.
Scene: wet stone-paved promenade following a slow calm river; simple elegant wooden benches to the left, lush willow trees with drooping leaves and grasses, secure low riverside railing, a few puddles reflecting bright clouds. Across the river, a softly distant modern university city skyline and low green hills. No recognizable famous landmark. Layered branches at upper corners and near foreground leaves create depth without blocking the view.
Composition: inviting immersive wide eye-level view, path gently curves into the distance, broad open lower-middle walkway for character sprites, river occupies the middle-right, a bench at left remains clearly visible. Fine stone joints, wet wood and delicate leaf shapes, intricate but breathable environment. No giant foreground object.
Lighting: luminous clean morning around 8 a.m., cool blue sky with bright white clouds and pale golden sunlight through fresh willow leaves; wet surfaces shine subtly, no sunset or nighttime palette, calm post-rain air and quiet emotional release.
Constraints: environment only, no people or silhouettes, no animals as focal subjects, no readable signs, letters, numbers, logos, UI, borders or watermark. Keep the bottom fifth visually calm for game dialogue. Deliver exactly one finished landscape illustration.
```

### campus-morning.png

```text
Edit type: lighting-weather.
The attached campus entrance is the EDIT TARGET. Transform ONLY its time of day and lighting from late afternoon to a clear bright 8 a.m. morning after rain.
Keep the exact university architecture and campus layout: matching modern glass arts annex at center-right, traditional stone building with arched windows on the right, elevated glass bridge across the back, same gates and stone entrance pillars, same trees and planting, wet stone courtyard, distant doors, camera angle and wide composition. The same place must remain instantly recognizable.
Morning light: cool clean blue sky and bright pearly white clouds, pale cool-gold early sunlight shining across the wet stone, crisp but gentle blue-white reflected light on the glass, fresh late-summer foliage. Rain has stopped. Remove the dusk's orange glowing sky and heavy sunset cast. Indoor lights should be less prominent in daylight. Air feels freshly washed and quietly hopeful, a grounded departure scene after a long night.
Style: preserve the original's exquisite painterly semi-realistic anime VN background, rich tactile masonry, wet reflections, finely observed glass and foliage, mature cinematic detail. No changes to the buildings or furniture.
Constraints: no people or silhouettes, no text, signs, labels, numerals, logos, UI, borders or watermark. Preserve open lower-center character staging space. Exactly one 16:9 landscape morning variant, approximately1672×941.
```
