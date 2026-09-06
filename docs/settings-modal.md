# Player settings modal

Settings previously rendered as a div. Opening it with a keyboard left focus on the background Settings button. The before-fix browser test captured this failure in evidence/settings-modal-before.log.

Settings now uses a named native modal dialog. It explicitly focuses Close after showModal, cycles Tab/Shift+Tab through the two buttons and four sliders, blocks interaction with the background, and restores a surviving opener on unmount. Escape closes it through the existing panel state. Switching into Credits also returns focus to the player Settings button when credits close. Closing does not advance dialogue.

The dialog fits the viewport and scrolls when necessary. The setting-label grid gives sliders a shrinkable column so the panel does not overflow horizontally. A 390x400 render was inspected.

Verification:
- Focus on open, forward and reverse keyboard cycling, slider arrow-key adjustment, persistence after reload, Escape return focus, credits return focus, unchanged dialogue position.
- Player keyboard, audio settings, and runtime credits regressions passed.
- Typecheck, unit tests, production build passed.
- Standalone ZIP test checks the named settings dialog and initial Close focus after keyboard opening.

This covers Chromium and the current settings controls. It is not a complete screen-reader, controller, or cross-browser accessibility audit. History panel focus behavior remains separate work.
