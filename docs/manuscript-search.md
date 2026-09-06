# Manuscript search verification

The command palette now returns every matching dialogue line, including repeated matches inside one scene, and searches speaker names/IDs plus scene IDs, chapters, and ending labels. Scene matches open the first line; dialogue matches open their exact line. Empty search lists scenes in manuscript order.

Results render in batches of 40 with a remaining count and a load-more button. Arrow navigation expands the visible batch and scrolls the selected result into view. Enter during IME composition is ignored; focused buttons retain their own keyboard activation.

Verified with `tests/e2e/manuscript-search.spec.ts`: 65 repeated lines, line 65 via load more, line 43 via keyboard, actor name and ID, scene ID, ending label, empty results, Escape, and 390px viewport. Desktop and mobile screenshots inspected in `evidence/manuscript-search-results/`. Typecheck, unit tests, and production build passed.

Limits: literal substring search; no fuzzy matching, find/replace, or choice-text search. Search still scans the in-memory manuscript; maximum-schema-size responsiveness has not been benchmarked.
