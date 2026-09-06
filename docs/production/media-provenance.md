# Bundled media: evidence and reproducible audio

The application's source MIT license is not a blanket license declaration for every bitmap, recording, font or generated output. This document records what the repository establishes and what still needs review.

## Artwork

The sample's production notes identify image generation and preserve prompts in `docs/qa/studio-longform-2026-09-05/art-prompts.md` and `art-supplement-prompts.md`. `tools/assemble-rain-novel.mjs` maps named images into the manuscript. These are useful production records, but they do not establish a complete per-file chain from original output to the currently distributed bytes. Do not interpret their existence as clearance of every image under `public/assets`.

Still required: original-output receipts, a hash inventory tying receipts to current artwork, any edits/reference inputs, and applicable distribution terms. Old QA documents also contain superseded scene/image counts; the current manuscript and files are authoritative.

## Audio

`tools/audio/tracks.mjs` contains the melodies/events and `synth.mjs` contains the mathematical synthesis primitives. These modules construct waveforms without loading recordings or instrument samples. `mp3.mjs` encodes them with the installed lamejs browser bundle. Encoder software licensing is separate from the provenance of a composition or output file.

The pre-existing bundled MP3s were generated before deterministic seeds and receipts were implemented. The current deterministic generator must not be presented as byte-for-byte proof of their historical origin. Existing files have deliberately not been regenerated in place: changing them would also affect exports and restoration checks that compare built-in audio bytes.

## Reproduction workflow

From the repository root, with dependencies installed:

```powershell
node tools/audio-gen.mjs --output output/audio-a --seed 20260906
node tools/audio-gen.mjs --output output/audio-b --seed 20260906
node tools/audio/verify-reproduction.mjs output/audio-a output/audio-b
node tools/audio-check.mjs output/audio-a
```

Each run writes five BGM tracks, ten effects and `generation.json`. The record contains seed, sample rate, channel count, bitrate, Node/V8 versions, encoder version/bundle hash, generator source hashes, sample counts and actual MP3 hashes. The verifier checks both records and the files on disk. The frame checker parses MP3 frames and validates durations. These checks do not replace listening for mix quality, loop seams or platform playback testing. Cross-engine and cross-platform byte equivalence has not been established; reproduce under the recorded runtime.

`--only cicada,rain-loop` renders a subset. Per-track seed initialization makes those files identical to the same tracks in a full run with the same inputs. The receipt lists only that invocation's outputs; older files in the directory are not attested. Unknown track IDs, invalid seeds and malformed options fail. Source changes during rendering prevent a new receipt from being written; use a stable checkout and a fresh output directory for release evidence.

Without `--output`, `assets:audio` writes into the application's bundled audio directory, as before. Use an explicit separate output directory when verifying an existing release. A new seed changes randomized sound textures; adopting generated files into the sample is a distinct release change requiring listening, restoration and playback validation.

## Author projects

The editor's media provenance fields and `MEDIA_CREDITS` exports contain author-supplied text. `recorded` means the basic fields are present; it is not a verified-rights flag. Built-in and unregistered files remain visible as needing records. Do not enter account secrets or private purchase keys into records that ship with a game.
