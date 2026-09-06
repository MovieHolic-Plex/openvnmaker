# Persistent narrative identity groundwork

Lines and choices now accept an optional `id`. Identity is scoped by scene and entry kind: `(scene.id, line.id)` and `(scene.id, choice.id)` are separate namespaces. IDs are 1–96 ASCII letters, digits, underscores or hyphens, starting with a letter or digit. The parser rejects invalid or duplicate IDs within the corresponding scene list, while manuscripts without IDs remain accepted.

New blank projects receive IDs immediately. The normal editor edit path assigns IDs to missing entries and preserves existing IDs. Reusing an entry twice within the same list preserves the first instance and assigns a new ID to the copied instance. Allocation reserves existing IDs before generating new ones and fails after bounded unsuccessful attempts. The transformation does not mutate its input and returns the original script when no changes are needed.

Unmodified imported or bundled legacy manuscripts are not rewritten on load. Their next ordinary edit assigns missing IDs as part of that undoable change. Undoing that first assignment also removes those IDs; redoing restores them, while a new edit from the pre-assignment state allocates new IDs. JSON replacement or external tools that omit IDs cannot preserve their earlier identities automatically. Moving an entry to another scene changes its scoped identity even if its ID string is retained.

Native release comparison uses IDs when both the previous and revised lists have a nonempty, unique ID on every entry. The decision is independent for lines and choices in each scene. It matches surviving entries by ID before comparing their text, cues or choice results, so moving duplicate captions does not invent changes in unrelated entries. Removed IDs produce high-priority findings; added IDs produce review findings, even when the total count is unchanged. Reordering surviving IDs remains a high-priority finding.

If either list lacks complete unique IDs, comparison retains its legacy fallback: line cues/text use positions, line order uses speaker/text anchors, and choices use unique surviving captions or positions for ambiguous captions. Identity-only additions are excluded from cue/choice-logic comparison. These fallbacks are estimates, not reliable historical identities. Empty or duplicate IDs are rejected by manuscript parsing; direct comparator boundary checks do not make such manuscripts importable.

Comparison findings do not restore saves by ID. Native generated execution statements have not been migrated to stable identity anchors.

## Identity-aware comparison verification - 2026-09-06

The comparator suite now has 57 cases, including incomplete IDs on either side, independent line/choice matching, insertion/deletion, equal-count replacement, empty lists and absent choices. Assertions check exact finding codes, severity, multiplicity, scope, counts and status. Eight isolated in-memory mutations each failed at the intended new assertion; the unmutated suite passed 57/57 with no skips. The production comparator was not modified during this verification.

The real Ren'Py baseline/revised-build browser test passed in 1.9 minutes. Both the preflight API and the report stored inside the native ZIP include the expected identity-aware changes. The lead also opened both report views in isolated Chromium at 1440x1000 and 390x844 and downloaded the retained JSON through its link. Its SHA-256 matched the build record: `6e138b816aa9ec08749dcaad32c10be086fc305f256de74e2ea2d6da9f607d44`. Baseline job: `6295caa5-49d5-400d-9010-12ec2adc15ed`; revised job: `ca8e871a-1c3c-4ea7-a279-9761b4df1f09`.

Two authoring regressions also passed: IDs and imported originals survive project switching, ZIP export and a new-browser restore; non-image input is rejected without modifying the manuscript. Final workspace typechecks and all 264 unit/tool tests passed, along with 15 audio-file checks. Strict compiler diagnostics for the comparator test file are empty after correcting two inherited fixture types. The earlier successful build remains applicable because this follow-up changed only tests and documentation.

Local receipts are under `.omo/evidence/codex-resume/`: `identity/summary.json` indexes the mutation RED and restored GREEN results; `final-verification.log` records the final checks; `qa/manual-actions.json`, `qa/manual-build-report.json`, `qa/manual-trace.zip` and four `qa/manual-*.png` files record direct browser use. These local artifacts are ignored by Git. Reproduce the retained tests with:

```sh
pnpm --filter @vnmaker/app exec node --test --import tsx test/native-compatibility.test.ts
pnpm exec playwright test tests/e2e/native-compatibility.spec.ts --project=desktop --trace on
```

The native test requires the configured Windows Ren'Py SDK described in the README. Its baseline wait subscribes to the real dialog's terminal-job response, and artifacts use a per-test output directory. Test-owned browser contexts and the local QA server were closed. Screenshots were captured, their dimensions were verified, and browser report-boundary assertions passed; pixel-level visual inspection was unavailable because the image readers lacked image support or quota. No visual-fidelity approval is claimed.

## Earlier identity-authoring verification

Validation covers idempotence, preservation across text edits and reordering, fresh copied-entry identity, invalid/duplicate rejection and JSON round-trip. A browser authoring flow verifies the same line ID through artwork/actor edits, project switching, ZIP export and restoration in a new browser context. Typed choice/condition authoring also passed. Evidence is retained under `evidence/narrative-ids-*`.

The additional browser test verifies that adding a line, undoing, redoing and reloading preserves both the original and newly allocated IDs. Its first run used a nonexistent test ID for Redo and timed out; the corrected accessible-button locator passed in 4.3 seconds. In total four targeted browser tests passed across the final runs, plus workspace typecheck/unit tests and build. Logs: `narrative-ids-browser.log`, `narrative-ids-undo-verified.log`, `narrative-ids-typecheck-final.log`, `narrative-ids-tests-final.log`, `narrative-ids-build-final.log` under `evidence/`.

This is infrastructure for release migration, not a migration feature or compatibility guarantee. Old saves with no identities cannot be assigned trustworthy historical identities by matching text alone. Explicit migration policy, removed-entry handling, stable native execution anchors and actual old-save update tests remain required.
