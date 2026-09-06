# Synthetic harness fixtures (task 6)

These are deterministic synthetic test data, not a novel, AI artwork, a live
capability probe, an approved release, or evidence of production harness completion.
No helper connects to a real provider or reads account credentials.

## Medium fixture and independent oracle

- `generateMedium()` in `medium.ts` returns an existing `VnScript`, parsed through
  the verified `@vnmaker/harness` root `scriptSchema` export.
- The inventory is exactly 80 scenes, 6,000 authored lines, eight characters,
  three endings, 120 distinct artwork references and 20 distinct audio references.
  Every asset is referenced by a scene or character; all 140 payload hashes differ.
- Scenes s001-s077 are shared, followed by one of s078-s080. Binary decisions at
  s020/s040/s060 set a/b/c and add 1/2/4 to score. At s077 one state-gated exit is
  available. Thus there are eight finite choice vectors, not 24 possible endings.
- `ROUTE_RECIPE` in `oracle.ts` separately declares all eight decisions, scores and
  endings. `routeOracle()` expands scene/line ID ranges from that recipe only. It
  imports neither the generator nor any production interpreter/selector helpers.
  Each path has 78 visited scenes, 5,849 visible lines and four choice history entries
  (5,853 total). The two conditional lines in s041 are mutually exclusive.
- `assertRoute(script, expected, mode?)` in `verify.ts` drives the real existing app
  reducer and compares exact menus, choices, flags, ending, visited IDs and history
  IDs against the independent oracle. `mode` is `skipScene` by default or `advance`.
  Checking available menus also detects unintended, unselected ninth routes.
- `assertInventory(script)` checks exact counts, graph audit, reference inventory,
  unique payloads, media size and agreement between the shared canonical hash and
  Node SHA-256 of canonical bytes. `mediaInventory()` generates tiny real PNG/PCM WAV
  buffers in memory; the CLI writes them only beneath ignored runtime directories.
  The medium media totals 10,840 bytes, comfortably below the 400 MiB ceiling.

## Adversarial recipes, not future handler implementations

| Export | Fixture contract |
| --- | --- |
| `partialChapterFixture()` | R1: parsed immutable preview with three materialized scenes, four planned scenes, an unwritten choice target, unchanged source head, independent zero-side-effect expectations. |
| `scopedOperationFixtures()` | R2: parsed insert/update envelopes, stale gap, absent scoped target and a different scene retaining the same line ID with different content. Treat insert/update as separate scenarios, not sequential calls with reused authority. |
| `qualityFixtures()` | R3: parsed world/belief/rumour/conditional facts, known-alpha PNG with solid green foreground, wrong opaque-alpha bytes and wrong-cast reference/bytes. Pixel checks do not confer visual approval. |
| `counterFixtures()` | R4: payload-bound exact 7,000 tokens versus 30,000 text bytes, unsupported and auth/quota/transport errors. Capability data is scripted, never live-verified. |
| `reuseFixtures()` | R5: hash-correct H0/H1, unrelated scene edit preserved, separate new-ID collision and distinct candidate content. Classification fields are expected results for downstream handlers. |

## Isolated event infrastructure

- `armEvent({source,event,accept?}, signal)` subscribes synchronously. Supply an exact
  event name, or an exact IPC-token predicate; trigger the action only afterward.
  Matching completion and abort remove listeners. There are no polling delays.
- `EventGate` supplies bounded `arrived`, `pause()` and `release()`. `using` disposal
  releases held work; callers can provide an AbortSignal. Default deadline is 10s.
- `startFixtureProvider(ReadonlyMap<path, FixtureReply>)` starts a loopback-only
  server on port 0. Replies contain status/chunks and optional before-reply or
  after-first-chunk gates/disconnection. Request bodies are preserved up to 64 KiB;
  unmatched paths return 404. Events are `request:N` and `chunk:N:index`, scoped to
  that server. Async disposal closes connections, drains work and exposes a receipt.
- `createSandbox(parent?)` creates unique filesystem/SQLite/IDB namespaces under this
  worktree's ignored `.omo` output. Async disposal removes only its own runtime root.
- `probeIndexedDb` is a serializable Playwright callback using actual complete/abort
  events, rollback observation and delete-request cleanup. Gate before a transaction;
  never hold a native IDB transaction open by awaiting external work or keepalive polling.
- `exerciseProcess` uses an isolated IPC child, explicit prepare/commit tokens and a
  real SQLite commit before acknowledging. `exerciseInfrastructure` also exercises
  loopback HTTP and fresh Chromium IDB contexts. Receipts record process exit, closed
  browser/server, deleted databases and removed runtime directories.

## CLI and checks

Run `pnpm exec tsx tools/qa/harness-fixtures.ts --case medium-oracle --out .omo/evidence/gemini-medium-game-harness/t06/medium`.
Use `--case injected-failure` with another output directory to corrupt an actual
ending: it must report `ROUTE_ENDING:000`, `ERR_ASSERTION` and exit 1. Baseline exits 0.
Each invocation retains unique `run-*/result.json` and `cleanup.json` evidence while
removing generated runtime payloads. Output must stay under this worktree's `.omo`.
`pnpm test:harness-fixtures` and `pnpm typecheck:harness-fixtures` are registered in
the root test/typecheck gates. Tests use Node's existing runner/tsx and require the
repository's Playwright Chromium installation; no fake browser fallback is provided.
