# Clean-source setup check — 2026-09-06

This check used the current uncommitted worktree as a source snapshot, not a git clone of a published commit. Application/packages, tools, tests, documentation, workspace configuration and lockfile were copied; existing dependencies, build output, local environment files, native SDKs and personal tool settings were excluded.

## Isolation and installation

An initial empty pnpm content store downloaded 49 packages with the frozen lockfile. The first copy was nested inside the repository; because Node can resolve undeclared modules from ancestor directories, the actual verification copy was placed outside it at `C:/Users/ubbio/AppData/Local/Temp/vnmaker-clean-source-20260906-v1`. That copy installed from the newly populated store. All five workspace projects were recognized. Node 24.20.0 and pnpm 11.24.0 came from the existing host.

Resolution checks for React, React DOM, Vite, TypeScript, tsx, fflate and the content workspace pointed inside the isolated snapshot. The source and copied lockfile retained SHA-256 `3ac13614b53b51a183e2c998a69311f79e24a6d54ce649646d82336bcec55f96`. A 420-file source hash manifest records the tested snapshot (documentation changes after the run are separate).

## Findings and corrections

- Roughly 5,000 generated native/output files appeared as untracked source candidates. `output/` is now ignored in its entirety. Existing generated files were preserved; no source assets were deleted.
- The first isolated browser run emitted one ResizeObserver loop warning. The keyed-art canvas changed layout-affecting dimensions synchronously during observer delivery, and editor preview size also updated state there. Both callbacks now defer/coalesce writes with requestAnimationFrame and cancel pending work on cleanup. A repeated narrow/wide viewport regression verifies loaded canvases and records resize errors. Its mobile screenshot was inspected.
- The initial browser suite had 28 passes and one recovery-fixture failure. The missing-key test could see the previous project's saved badge while asynchronous creation was still running, so its key removal did not necessarily occur after the new project was active. The test now waits for the new title, saved state, and actual persisted manuscript title before removing keys. It still verifies the recovery offer, absent quick-recovery key, explicit restore, and reload preservation.

## Final result

In the isolated copy, `pnpm typecheck`, `pnpm test`, and `pnpm build` passed. Playwright launched a new local server on port 5196 with no local environment file or configured Ren'Py SDK. The complete updated portable suite passed **30 tests**. No ResizeObserver error appeared in that final log. The existing inlineDynamicImports deprecation warning remains; it is unrelated to dependency isolation.

Evidence: evidence/clean-source-{manifest,isolated-manifest,file-hashes,resolved-modules}.json; clean-source-install.log; clean-source-isolated-install.log; clean-source-{typecheck,tests,build}-final.log; clean-source-browser.log (initial failure); clean-source-browser-final.log and clean-source-browser-final/ (verified run).

This was a clean project/dependency setup on the same Windows host. It reused installed Node/pnpm and the Chromium browser cache; it does not prove installation on a new OS, hosted CI, macOS/Linux native execution, all route correctness, or overall production readiness. The full production objective remains active.
