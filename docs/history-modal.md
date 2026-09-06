# Dialogue history modal

Before the fix, HistoryPanel used a plain div and backlog-specific styles were absent from the app CSS. Browser evidence shows sixty lines overlapping the gameplay background without a usable bounded scroll area. The original test failed; its screenshot and log are retained under evidence/history-modal-before.

History now uses a named native modal dialog with a fixed header, entry count, speaker labels, and a bounded scroll region. On open it scrolls to the latest completed line and focuses Close. Tab and Shift+Tab cycle between Close and the named reading region; Home and End jump to the region's beginning/end. Native scrolling remains available. Escape and Close return focus to the surviving History button without advancing playback. Empty history shows an empty state; it does not populate future manuscript lines.

Validation:
- Sixty-line history, first/last keyboard navigation, initial latest record, modal semantics, focus return, exact scene and current dialogue preservation.
- Desktop and 390x600 screenshots inspected; no background overlap or horizontal overflow.
- Empty history before first advance.
- Settings-modal and player-keyboard regressions passed (four browser tests together).
- Actual downloaded/unpacked web ZIP on a separate origin: history opens by keyboard, contains the completed first line, and closes to the same second line.
- Typecheck, unit tests, and production build passed.

Evidence logs: evidence/history-modal-{before,after,final,export,typecheck,tests,build}.log. Final screenshots: evidence/history-modal-final/.

Completed dialogue and selected choices now capture the source scene ID and its chapter label (falling back to the scene ID). Adjacent records from the same chapter share a heading. Saved labels remain snapshots even if the manuscript chapter is renamed later. Legacy records without labels still load; malformed optional metadata is discarded while valid dialogue is retained.

The chapter follow-up passed engine/storage unit tests, workspace typecheck and build, and three history browser tests including manual save/reload across two chapters. The 390x700 restored-history screenshot was inspected: headings, dialogue and selected choice remain readable within the dialog; the unread chapter is absent. The actual exported web-player test also checks the chapter heading against its exported manuscript. Evidence: evidence/history-chapters-{typecheck,tests,build,browser,export}.log and evidence/history-chapters-browser/.

Limits: history storage retains the existing last-2000-entry load policy; no change to replay semantics, voice replay or search. Chapter snapshots apply to the web player, not Ren'Py's separate history implementation. Maximum-sized history performance, screen-reader narration, and browsers other than Chromium remain unverified. The full production goal remains active.
