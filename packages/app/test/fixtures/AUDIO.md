# Audio test fixtures

`wav.ts` generates a quiet 16-bit PCM sine wave in memory. `audio-tone.mp3` and `audio-tone.ogg` are synthetic 330 Hz, 0.25-second tones generated for decoder/import tests; they contain no sampled music or speech. These test fixtures are provided under the repository's MIT license.

Generation commands (requires FFmpeg with libmp3lame and libvorbis):

```sh
ffmpeg -f lavfi -i "sine=frequency=330:duration=0.25:sample_rate=16000" -c:a libvorbis -q:a 2 audio-tone.ogg
ffmpeg -f lavfi -i "sine=frequency=330:duration=0.25:sample_rate=16000" -c:a libmp3lame -q:a 6 audio-tone.mp3
```

They are codec fixtures, not production soundtracks or spoken voice recordings. Tests use WAV tones in the voice channel to verify its playback lifecycle.
