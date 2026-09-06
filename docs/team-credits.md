# Team credits authoring

Project Overview now contains 함께 만든 사람들. Authors can add, edit, reorder and remove ordered role/name blocks. Multiple names can use line breaks. Edits use the normal undo/autosave path. Empty name blocks persist as drafts but do not appear in the game; a blank role with names displays 참여.

Schema: optional `credits: {role: string, names: string}[]`, up to 100 rows, 120 characters per role and 4,000 per name block. The parser rejects invalid shapes/types, oversized text, unknown keys and non-text control characters. Old projects without the field remain valid.

Web and Ren'Py credit screens display team blocks before registered media credits. They render literal text rather than interpreting authored HTML or Ren'Py formatting. The project JSON transports the records through ZIP export and restoration; MEDIA_CREDITS documents continue to describe media provenance only.

Verified:
- UI add/edit/multiline/reorder/delete and reload preservation.
- Downloaded ZIP includes the expected ordered records; hosted standalone player displays them.
- Fresh browser context restores that ZIP into the editor and retains role/names.
- Desktop/mobile editor and mobile runtime screenshots inspected.
- Parser rejection tests, full unit tests, typecheck and production build passed.
- Ren'Py 8.5.3 conversion and lint passed. Three executable SDK tests / 15 assertions passed, including the exact multiline text in the team-credit widget. Native screenshot inspected with the real media records restored after the literal-text fixture.

Native QA screenshots are now stored under a run-specific directory. They are manual visual evidence, not stable pixel-baseline tests; entrance effects and blinking UI had caused a 726-pixel comparison failure on repeat. Behavior/text assertions remain active, and the literal-media fixture restores its original list before the next testcase.

Evidence: evidence/team-credits-{final,tests,typecheck-final,build,native-verified,native-lint}.log; web screenshots under evidence/team-credits-final; native screenshot under output/team-credits-native-v1/tests/screenshots/credits-1788675011469735900/.

The same team-credit change has since passed in a newly packaged Windows EXE; see production/integrated-regression.md. Limits: Scrolling credit rolls, localization-specific names, portraits/logos, and maximum-size native performance remain unimplemented or unverified. The overall production goal remains open.
