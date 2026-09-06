# Integrated regression and packaged team credits — 2026-09-06

This checkpoint verifies the accumulated authoring/player changes together. It does not declare the open-source tool production-ready.

## Browser suite

`VNMAKER_APP_PORT=5184 pnpm e2e:portable --output evidence/integrated-player-regression` completed successfully on this Windows host: **29 tests passed in 3.3 minutes**, one Chromium worker, no retries. The command reused the running local Vite server. This is not evidence of a fresh-machine install or a hosted Windows/Linux CI run.

Coverage includes arbitrary cast and imported image originals; project reload/switch/export/restore; numeric choice effects and typed conditional branches; autosave failures and retry; exclusive editor sessions; missing/corrupt recovery data; full long-form sample export and one complete route; audio volume/fades; manuscript search; credits, settings, history and choice/player keyboard behavior. The suite does not include SDK baseline/save-migration tests, deliberate browser crashes, native platform matrices, human-paced reading, or all routes of every project.

Evidence: evidence/integrated-player-regression.log and evidence/integrated-player-regression/.

## Actual Windows package

The team-credit project was built into `output/team-credits-native-v1/distributions/vnmaker-ec76a5bd740cde39-1.0-pc.zip` (67,115,303 bytes). SHA-256: `29f9add5f29042fde55b949671c7e862250988975470af532d06bdf42e396c9b`.

The ZIP was extracted into output/team-credits-packaged-v1. Only the QA testcase file, deliberately excluded from distribution, was added to the extracted copy. The shipped theme and project JSON match the source project bytes; the executable and runtime were not replaced. The packaged Windows executable passed **3 tests / 15 assertions** with isolated save data: title/in-game/ending credits and return paths, literal formatting text, and exact multiline team names. Its authored-team screenshot was visually inspected.

The native notice verifier also checked six files against original project bytes: source/SDK notices, media credit JSON/TXT, font notice and the shipped font. The font notice identifies the actual font hash. This is a bounded package-content check, not a complete third-party rights audit.

Evidence: evidence/team-credits-pc-{build,tests,error}.log, evidence/team-credits-pc-notices.json, evidence/team-credits-pc-source-hashes.json. Screenshot: output/team-credits-packaged-v1/vnmaker-ec76a5bd740cde39-1.0-pc/tests/screenshots/credits-1788675361478666800/native-team-credits-authored.png.

The package is a QA fixture with synthetic authors, not the finished bundled novel or a signed Steam release. macOS/Linux execution and platform distribution remain unverified here. The overall production objective stays active.
