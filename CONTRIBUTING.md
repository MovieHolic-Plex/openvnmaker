# Contributing to VN Maker

VN Maker is an in-progress authoring tool. Contributions should improve creating, recovering and independently distributing real games. Keep claims proportional to verified behavior.

## Setup

Use Node **24.20.0** (`.node-version`) and pnpm **11.24.0** (`package.json`). Install pnpm using your normal Node tooling if needed. From the repository root:

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @vnmaker/app dev --host 127.0.0.1 --port 5184 --strictPort
```

Open `http://127.0.0.1:5184/studio.html`; the player is at `/`. Ordinary authoring and web export require no AI credentials, gateway process or Ren'Py SDK. Use another free port if necessary; do not stop unrelated services.

For a clean-source check, put the checkout outside an existing repository so Node cannot resolve missing packages from that repository's parent `node_modules`. Install with the frozen lockfile before running checks. A separate pnpm store (`pnpm install --frozen-lockfile --store-dir <empty-directory>`) can also verify that packages download successfully. Keep `.env.local`, generated build output and SDK installations out of that checkout. This isolates project dependencies, not the machine's Node/pnpm installation or browser cache. See `docs/production/clean-source-check.md` for the measured scope of the local check.

Generated exports, native projects, binaries and audio reproduction runs belong under `output/`, which is ignored by Git. Keep their original source assets and metadata in the appropriate source directories; do not force-add generated packages as application source.

Browser projects are stored per origin. Changing host or port changes the visible library. Back up important work through the editor before testing storage migrations. Do not clear user storage as a shortcut for fixing issues.

The editor uses a browser Web Lock to allow one writer per origin. Additional editor tabs wait without mounting autosave or running migrations. Close the active editor after checking its save state; the next tab then loads the latest manuscript. This also applies to different projects because active-project/recovery storage is currently shared. Unsupported lock environments fail closed. It does not coordinate different origins, older application versions that ignore the lock, or external storage modifications.

## Checks

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm e2e:portable
```

On supported Linux runners, `pnpm exec playwright install --with-deps chromium` also installs system dependencies. `e2e:portable` selects authoring, state, arithmetic and standalone ZIP workflows without a native SDK. Playwright starts a local server when one is not already running. For port 5184 in PowerShell set `$env:VNMAKER_APP_PORT='5184'`; in a POSIX shell use `VNMAKER_APP_PORT=5184 pnpm e2e:portable`.

`pnpm e2e` includes native suites with additional setup; it is not a no-setup smoke command. Native tests require the pinned SDK and isolated output/save directories. See README native setup and `docs/production/status.md` for verified scope.

`pnpm e2e:crash` deliberately crashes only test-owned Chromium renderers/browser processes through CDP. It creates an isolated synthetic persistent profile under the test output directory, waits for termination signals, and verifies reopen/handoff. It does not target the user's browser or kill processes by name. It is a separate diagnostic suite; normal portable CI does not run it. The Windows results do not establish power-loss durability or cross-browser behavior.

The GitHub workflow runs core checks and the portable browser selection on Windows and Ubuntu. Windows-specific tests skip elsewhere. Inspect actual hosted results for the commit being released: a workflow file is not evidence of a successful CI run. This workflow does not sign packages, validate native macOS/Linux execution or upload to Steam. Failure artifacts retain traces and screenshots for seven days; use synthetic data, never personal projects or credentials.

## Review expectations

- Keep new manuscript fields optional for old projects; validate imports and preserve original media bytes. Exercise restoration when changing serialization.
- Test user behavior such as edit, reload, undo, branch outcomes and independent exported playback. Inspect desktop and narrow screenshots for visible changes.
- Distinguish simulated fixtures from actual SDK/package runs and reading estimates from human play time.
- Preserve the lockfile and generate runtime notices through the build when dependencies change.
- Do not commit credentials, user projects, SDK installations, generated native binaries or test evidence.

Original application/tool source uses the MIT license. Third-party components and media need their own notices and evidence. Preserve creator/source/usage/credit records; see `docs/production/media-provenance.md`. Reproduce audio into a separate directory to preserve existing release bytes.

Describe concrete before/after behavior, checks and limitations in contributions. Update `docs/production/status.md` when verified production capabilities change.
