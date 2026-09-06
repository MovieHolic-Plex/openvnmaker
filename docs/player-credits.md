# Player credits

The web player now opens media credits from the title menu, in-game settings, and ending screen. The modal lists registered artwork/audio records with a nonblank creator, license, or credit field. It displays those three fields as plain text, preserves line breaks, and wraps long text. Opening credits pauses automatic advancement and voice through the existing panel state. Native dialog semantics trap keyboard focus; closing returns focus to a surviving opener.

The source/purchase field is not rendered in this screen. It still ships in project.json and MEDIA_CREDITS documents; this is not a private-field or distribution-redaction feature. The editor explicitly describes this distinction. No rights verification is implied. Registered records may include unused library assets; this is not a runtime-used-only inventory. Built-in assets without provenance cannot gain attribution from this UI automatically.

Standalone web games link to their bundled THIRD_PARTY_NOTICES.txt. No remote request is needed to render credits. An ordered team/role editor is now available; see team-credits.md for its separate verification. Native screen verification is recorded below.

Validation:
- `pnpm typecheck`, `pnpm test`, `pnpm build` passed.
- All four export-bundle E2E tests passed, including download/unzip/new-origin gameplay and the long-form sample route.
- Actual exported game: title/settings/ending entry points, entered credit and license text, source-field exclusion from modal, local software notice availability, Escape/focus restoration, and unchanged dialogue position verified.
- `runtime-credits.spec.ts`: 30 records, long literal HTML-like text, 390x600 viewport, final record and close button reachable.
- Desktop/mobile screenshots inspected under evidence/runtime-credits-results and evidence/runtime-credits-stress.

## Native player verification

Ren'Py exports use the same three public fields in the About screen, reachable through the SDK's 버전정보 navigation entry, a new in-game 크레딧 quick-menu button, and an ending 크레딧 button. The SDK game-menu viewport and return behavior are retained. The original Ren'Py version/license text remains below the media credits. Source/purchase records are not rendered, but remain in shipped documents and project JSON.

`create-renpy-credits-tests.ts` creates executable SDK tests for title/menu/ending return paths and literal bracket/format-tag rendering. Initial visual inspection caught an unsupported middle-dot glyph and screenshots taken during transitions. Labels now use slashes; screenshots wait for transitions to settle. The literal-text test checks actual displayed text rather than escaped source syntax.

Verified on Windows with Ren'Py 8.5.3.26051504:
- Fresh conversion `output/native-credits-v2`, lint passed.
- SDK: two test cases, 13 assertions passed.
- PC distribution built successfully, 67,114,051 bytes; SHA-256 `a6592cc41c3b5b243edb771cb738136daade3ba39083291a8ddbc6bb32219175`.
- Extracted the produced ZIP and added only the QA script (excluded from the distribution by build rules). The packaged Windows executable passed the same two cases / 13 assertions with isolated saves. Runtime/theme files were not replaced in the extracted package.
- Screenshots inspected: title credits, full toolbar, ending return, and literal bracket/format text.
- Evidence: `evidence/native-credits-{v2-test,exe-test,lint-final,distribute,typecheck,tests,build}.log` and `output/native-credits-v2/tests/screenshots/`.

This does not verify macOS/Linux execution, arbitrary-length native credits, licensing completeness, or general team/role authoring. The full production-readiness goal remains open.
