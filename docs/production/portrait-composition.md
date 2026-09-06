# Portrait player composition

The all-route screenshots exposed a small character image on tall mobile screens. The absolute-positioned sprite containers had no explicit width; shrink-to-fit sizing constrained the keyed canvas. Portrait player styles now give center/side actors explicit viewport-relative widths with upper bounds, position the side slots around 20%/80%, and anchor their artwork at the bottom. The rule applies only at widths up to 640px in portrait orientation. Desktop and editor-preview sizing retain their existing rules.

Visual inspection of the two-actor fixture exposed a separate issue: dimming combined parent transparency and two brightness filters, so the background visibly showed through the listening character. Player listeners now remain opaque and use one brightness/saturation treatment. This applies to both desktop and mobile web players. The studio preview's separate appearance is unchanged.

Mobile studio-playback chapter labels also move below the return/toolbar/art controls. The dialogue panel dimensions are unchanged.

Validation on 2026-09-06:

- One-, two- and three-actor screenshots at 390x844 and a three-actor desktop screenshot were inspected. Faces and dialogue remain visible; the final two-actor image no longer shows the background through the listening actor.
- The browser test checks loaded canvases, widened sprite bounds, no document horizontal overflow, visible dialogue/settings controls and opaque listener styling. It is included in the portable suite.
- Three browser regressions passed: portrait composition, player keyboard and editor resize (15.3 seconds). Production build passed.
- Final evidence: `evidence/mobile-stage-verified.log`, `evidence/mobile-stage-verified/`, `evidence/mobile-stage-build-final.log`. Earlier screenshot sets preserve the intermediate ghosting observation.

Limits: these fixtures use the sample's portrait artwork. Unusual user image proportions, all expressions/poses, every mobile viewport, physical devices and native Ren'Py composition remain unverified. Intentional sprite overlap and edge cropping are part of this portrait layout. The earlier eight-route exported ZIP predates this CSS change; its route evidence remains valid for that artifact, not a claim that this new appearance was checked in that ZIP.
