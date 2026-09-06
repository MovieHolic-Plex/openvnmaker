# Long-form sample: exported web route verification

The existing export test only followed the first available choice. It now enumerates all eight acyclic paths in the current sample and executes each path in the actual downloaded, unpacked web game hosted on a separate local origin. The exported manuscript is compared with the current source (20 scenes, 829 authored lines and 35 artwork records).

The final run passed in 2.2 minutes on Windows/Chromium. It reached all 20 scenes and both endings, alternating 1440x900 and 390x844 viewports across routes. At every scene it checks the expected scene ID, first conditionally visible dialogue and absence of runtime errors. At each ending it checks the title, final flags and autosaved completed-history count. Routes 1–4 contain 700 history entries each; routes 5–8 contain 699 each, including selected choices. No missing asset requests, external/API requests or page errors were observed.

The test records one initial-frame screenshot per scene plus all eight ending screenshots. Representative desktop branch scenes and mobile ending/scene images were inspected. The mobile scene keeps dialogue readable but gives the character substantially less visual space than the desktop composition; this evidence does not establish optimal mobile art direction. It is not a pixel comparison or an inspection of every frame.

Evidence:

- `evidence/longform-all-routes-verified.log` — final passing run.
- `evidence/longform-all-routes-verified/export-bundle-the-entire-l-f7ae0-d-plays-through-every-route-desktop/all-route-report.json` — route scene IDs, choice indices, final flags, ending and history count.
- The same directory contains `rain-novel-play.zip`, its unpacked game and the screenshots.
- `evidence/longform-all-routes-hashes.json` — source manuscript and tested ZIP SHA-256 values.

Two exploratory runs are retained separately. The first incorrectly expected a history toolbar on the ending screen and timed out. The second used ordinary typewriter timing and exceeded five minutes after seven routes. The final run uses the player's supported 5 ms text-speed setting and checks the ending autosave directly. No game engine or manuscript changes were needed for this result; this turn expanded executable release evidence.

Limits: each scene is advanced with the normal Skip control after checking its first visible line. This proves route reachability and aggregate history, not correct rendering/timing/audio of every intermediate line or cue. Expected flags and conditional-line counts use the content condition helpers, so this is not an independent proof of those helpers' semantics. This is not a human 90-minute playtest, native-platform verification, save migration test or overall production-readiness claim. The retained test is already included in the portable suite through `export-bundle.spec.ts`.
