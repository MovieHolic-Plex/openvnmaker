# Player keyboard regression

The global Enter/Space listener previously prevented native button activation and advanced dialogue even when the focused control was Settings or Save. Reproduced with an actual browser before the fix (`evidence/player-keyboard-before.log`).

The handler now defers to focused interactive controls and ignores composing, modified, repeated, or already-handled shortcut events. The stage advance target is a native button; its keyboard activation uses the same click path as pointer input. Repeated Enter/Space keydown on that target does not retrigger it. Escape still dismisses panels. This does not constitute a complete accessibility audit.

Visual QA also found the mobile preview return link overlapping the toolbar. At widths up to 640px, preview-only controls and save feedback are vertically separated. The standalone toolbar remains at its normal position.

Verified:
- Focused Settings + Enter and Save + Space open the correct panel without advancing.
- Stage button Enter/Space advances one line each; background Enter still advances.
- Background modifiers, composition, and repeat events do not advance; H toggles art view and Space restores dialogue without skipping it.
- Mobile return-link/toolbar rectangles do not overlap; 390px screenshot inspected.
- Related audio-settings and runtime-credits E2E regressions passed.
- Downloaded ZIP, unpacked and hosted separately: keyboard Settings activation passed alongside full fixture gameplay.
- Typecheck, unit tests, and production build passed.

Evidence logs use the prefix `evidence/player-keyboard-`; screenshots are in `evidence/player-keyboard-final/`.
