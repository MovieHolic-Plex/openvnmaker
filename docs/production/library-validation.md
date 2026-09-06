# Project library corruption isolation

Project enumeration previously cast IndexedDB results directly to manuscript records. An invalid script could break the library render or prevent bootstrap from reaching a healthy recovery candidate. Enumeration now validates each record independently, sorts only valid manuscripts, and returns a separate damaged count. Invalid records are never deleted or rewritten by this read operation. The library explains the excluded count while keeping healthy projects available.

When the quick recovery key is absent, bootstrap chooses from validated manuscripts. If records exist but none are readable, it stops before sample initialization and explains that the original storage remains unchanged. This does not recover malformed manuscripts or repair a damaged IndexedDB database.

Mobile visual QA also exposed the library dialog disappearing when its sidebar ancestor becomes hidden at narrow viewport widths. The dialog now renders through a body portal, independently of sidebar visibility. The final 390x844 screenshot shows a bounded scrolling dialog with the corruption notice visible and no horizontal spill.

Validation on 2026-09-06:

- Seven Chromium recovery tests passed in 36.8 seconds with the final code, including mixed healthy/damaged records, opening a healthy manuscript, exact preservation of a malformed original, missing-key recovery with a damaged newest record, and an entirely damaged library preserving its records without creating a sample.
- Workspace typecheck, unit tests and build passed. The final portal change was typechecked and built again.
- First exploratory browser run received a hot update while waiting on the disappearing dialog; it is not the final regression evidence. The subsequent clean test run is retained separately.
- Evidence: `evidence/library-validation-final.log`, `evidence/library-validation-final/`, `evidence/library-validation-typecheck-final.log`, `evidence/library-validation-tests.log`, `evidence/library-validation-build-final.log`.

## Backup import from an entirely damaged library

The all-damaged startup screen now accepts manuscript JSON (up to 8 MiB) or exported game ZIP (up to 512 MiB). JSON passes the manuscript parser; ZIP uses the existing path/CRC/media validation and asset restoration pipeline. A validated manuscript is saved under a new project ID before it becomes active. Original library records are not replaced. JSON alone does not carry image/audio bytes, which the screen explains.

The recovery screen retains the editor writer lock throughout import and after mounting the editor. This is necessary because restoring a backup writes to shared project and media storage. Failed validation displays an error and re-enables the file input. If activation fails after the durable save succeeds, the new library copy can remain available for later recovery; this is not an atomic transaction across IndexedDB and localStorage.

Nine final Chromium recovery tests passed in 1.3 minutes, including actual generated ZIP and JSON imports, malformed JSON followed by a successful retry, exact preservation of damaged originals, a waiting second tab, and persistence after reload. Workspace typecheck, unit tests and build passed. The 390x844 error-state screenshot was inspected. Evidence: `evidence/library-backup-{typecheck,tests,build,browser}.log` and `evidence/library-backup-browser/`.

## Original-record archive

Both the damaged-record library view and all-damaged recovery screen offer an original JSON archive. A readonly IndexedDB transaction captures all project records; serialization does not run the manuscript parser or discard unknown fields. The versioned `vnmaker-library-archive` envelope includes the records themselves. It is an inspection/repair artifact, not an importable manuscript or a full game/media backup, as explained in the interface.

The serializer rejects values JSON cannot retain accurately, including undefined, non-finite numbers, negative zero, bigint, dates, maps, binary objects, sparse arrays, repeated object references and excessive nesting. It does not invoke custom `toJSON` methods. Unsupported data produces an error without downloading a partial archive or changing the database. This is a logical record snapshot, not a binary database copy, and it does not handle every value supported by IndexedDB structured cloning.

Unit tests cover invalid manuscript fields and rejection of lossy conversions. Browser tests download and parse real archives from mixed healthy/damaged and all-damaged libraries, compare originals, and then exercise normal project opening and JSON/ZIP restoration. Evidence: `evidence/library-archive-{typecheck,tests,build,browser}.log`, `evidence/library-archive-browser/`. The 390px recovery screenshot was inspected; the expanded content scrolls vertically.

Remaining work includes binary/non-JSON record archival, database-level corruption recovery and large-library performance. This screen handles readable databases containing invalid manuscript records; an IndexedDB open failure still prevents bootstrap. Parsing every manuscript on enumeration and collecting records for archival can be expensive at scale; this run does not establish a project-count or memory bound. The production goal remains active.
