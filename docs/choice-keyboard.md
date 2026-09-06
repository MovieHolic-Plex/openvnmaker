# Choice keyboard and overflow behavior

The web choice menu declared menu semantics but did not implement arrow navigation. Its list also lacked a maximum height or scrolling, so long options could extend outside the viewport. The before-fix browser test failed on ArrowDown focus movement.

The menu now provides ArrowUp/ArrowDown cycling over allowed choices, Home/End movement, a single tab stop at the active choice, and local number shortcuts matching the displayed 1-8 labels. Hidden and disabled choices cannot be triggered by shortcuts. Modifier/composition events are ignored, and repeated number-key events do not trigger picks. Focus scrolls the active option into view. Number shortcuts are exposed through aria-keyshortcuts.

The list has a viewport-relative height and vertical scrolling. Disabled opacity now survives entrance animation by disabling that animation on disabled items. Existing pointer selection remains available.

Validation:
- Eight authored choices with one hidden and one disabled: initial available focus, arrow skipping/wrapping, Home/End, last-option visibility, exact chosen flag, and correct displayed-number mapping.
- Mobile screenshots at 390x844 inspected; final choice visible without horizontal overflow.
- Hidden/disabled numbers and Control+number do not choose.
- Existing history and player-keyboard regressions passed.
- Typecheck, unit tests, and production build passed.
- Standalone ZIP export test selects its branch using the number shortcut.

Evidence uses evidence/choice-keyboard-* logs and output directories. The first screenshot was captured during entrance animation; final screenshots explicitly wait for visible opacity. This does not constitute full controller, screen-reader, or cross-browser validation. Ren'Py's existing choice navigation is separate and unchanged.
