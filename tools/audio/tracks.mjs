/**
 * 트랙 정의. 각 함수는 Float32Array(모노, 44100Hz) 를 돌려준다.
 * 진행은 실제 코드 진행을 쓰고, 멜로디는 음 배열로 직접 적었다.
 */
import { random } from "./random.mjs";
import {
  SR,
  bandpass,
  bass,
  bell,
  buffer,
  epiano,
  fadeEdges,
  highpass,
  lowpass,
  midiToFreq,
  mixInto,
  noise,
  normalize,
  pad,
  piano,
  pluck,
  reverb,
} from "./synth.mjs";

function render(seconds, events) {
  const out = buffer(seconds);
  for (const ev of events) {
    const voice = ev.voice(midiToFreq(ev.midi), ev.dur, ev.vel ?? 1);
    mixInto(out, Math.round(ev.at * SR), voice, 1);
  }
  return out;
}

/** 코드 이름 → 미디 노트. 옥타브는 root 기준. */
const CHORD_SHAPES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  maj7: [0, 4, 7, 11],
  min7: [0, 3, 7, 10],
  dom7: [0, 4, 7, 10],
  sus4: [0, 5, 7],
};

function chord(root, shape) {
  return CHORD_SHAPES[shape].map((i) => root + i);
}

/** 아르페지오. 코드 톤을 위로 올렸다 내린다. */
function arpeggio(notes, at, beat, count, voice, vel = 1) {
  const path = [...notes, ...notes.slice(1, -1).reverse()];
  const events = [];
  for (let i = 0; i < count; i += 1) {
    const midi = path[i % path.length] + (i >= path.length ? 12 : 0);
    events.push({ at: at + i * beat, dur: beat * 1.9, midi, vel, voice });
  }
  return events;
}

function melody(at, beat, line, voice, vel = 1) {
  return line
    .filter(([, midi]) => midi !== null)
    .map(([offsetBeats, midi, lengthBeats = 1]) => ({
      at: at + offsetBeats * beat,
      dur: beat * lengthBeats,
      midi,
      vel,
      voice,
    }));
}

/* ── 타이틀: A minor, 68 BPM ───────────────────────────────── */

export function mainTheme() {
  const beat = 60 / 68;
  const bar = beat * 4;
  const progression = [
    chord(57, "min"), chord(53, "maj"), chord(60, "maj"), chord(55, "maj"),
    chord(57, "min"), chord(50, "min"), chord(52, "dom7"), chord(57, "min"),
  ];
  const total = bar * progression.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass += 1) {
    progression.forEach((notes, i) => {
      const at = pass * bar * progression.length + i * bar;
      events.push(...arpeggio(notes, at, beat / 2, 8, piano, 0.9));
      events.push(...notes.map((m) => ({ at, dur: bar * 0.96, midi: m + 12, vel: 0.5, voice: pad })));
      events.push({ at, dur: bar * 0.9, midi: notes[0] - 24, vel: 0.7, voice: bass });
    });
  }
  const top = [
    [0, 76, 2], [2, 74, 1], [3, 72, 1], [4, 69, 3], [8, 72, 2], [10, 74, 2],
    [12, 76, 4], [16, 79, 2], [18, 77, 2], [20, 76, 4], [24, 72, 2], [26, 74, 2], [28, 69, 4],
  ];
  events.push(...melody(bar * progression.length, beat, top, piano, 1.05));
  return normalize(fadeEdges(reverb(render(total, events), 0.32, 1.1), 0.35));
}

/* ── 일상: F major, 92 BPM ─────────────────────────────────── */

export function daily() {
  const beat = 60 / 92;
  const bar = beat * 4;
  const progression = [chord(53, "maj"), chord(57, "min7"), chord(58, "maj"), chord(60, "maj")];
  const total = bar * progression.length * 5;
  const events = [];
  for (let pass = 0; pass < 5; pass += 1) {
    progression.forEach((notes, i) => {
      const at = pass * bar * progression.length + i * bar;
      notes.forEach((m, k) => events.push({ at: at + k * 0.012, dur: bar * 0.8, midi: m + 12, vel: 0.75, voice: epiano }));
      events.push({ at, dur: bar * 0.9, midi: notes[0] - 24, vel: 0.6, voice: bass });
      if (pass >= 1) {
        const pattern = [0, 1.5, 2.5, 3];
        pattern.forEach((p, k) => {
          events.push({ at: at + p * beat, dur: beat, midi: notes[(k + pass) % notes.length] + 24, vel: 0.6, voice: pluck });
        });
      }
    });
  }
  const tune = [
    [0, 77, 1.5], [1.5, 79, 0.5], [2, 81, 2], [4, 79, 1], [5, 77, 1], [6, 74, 2],
    [8, 76, 1.5], [9.5, 77, 0.5], [10, 79, 2], [12, 77, 4],
  ];
  events.push(...melody(bar * progression.length * 2, beat, tune, epiano, 1.0));
  events.push(...melody(bar * progression.length * 3, beat, tune, pluck, 0.9));
  return normalize(fadeEdges(reverb(render(total, events), 0.22), 0.32));
}

/* ── 비: D minor, 60 BPM ───────────────────────────────────── */

export function rain() {
  const beat = 1;
  const bar = beat * 4;
  const progression = [chord(50, "min"), chord(55, "min"), chord(58, "maj"), chord(57, "maj")];
  const total = bar * progression.length * 3.5;
  const events = [];
  for (let pass = 0; pass < 3.5; pass += 1) {
    progression.forEach((notes, i) => {
      const at = pass * bar * progression.length + i * bar;
      if (at >= total) return;
      notes.forEach((m) => events.push({ at, dur: bar * 1.1, midi: m, vel: 0.85, voice: pad }));
      events.push({ at, dur: bar, midi: notes[0] - 24, vel: 0.5, voice: bass });
      const drops = [0.5, 1.75, 3.25];
      drops.forEach((d, k) => {
        events.push({ at: at + d * beat, dur: beat, midi: notes[(k + i) % notes.length] + 36, vel: 0.55, voice: bell });
      });
    });
  }
  const music = render(total, events);
  const wash = lowpass(highpass(noise(total), 400), 3200);
  for (let i = 0; i < music.length; i += 1) {
    const t = i / SR;
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * t * 0.06);
    music[i] += wash[i] * 0.055 * swell;
  }
  return normalize(fadeEdges(reverb(music, 0.36, 1.3), 0.4));
}

/* ── 감정: C major → A minor, 72 BPM ──────────────────────── */

export function warm() {
  const beat = 60 / 72;
  const bar = beat * 4;
  const progression = [chord(60, "maj"), chord(55, "maj"), chord(57, "min"), chord(53, "maj7")];
  const total = bar * progression.length * 4;
  const events = [];
  for (let pass = 0; pass < 4; pass += 1) {
    const level = 0.6 + pass * 0.14;
    progression.forEach((notes, i) => {
      const at = pass * bar * progression.length + i * bar;
      notes.forEach((m) => events.push({ at, dur: bar * 1.05, midi: m, vel: level * 0.9, voice: pad }));
      events.push({ at, dur: bar * 0.95, midi: notes[0] - 24, vel: level * 0.7, voice: bass });
      events.push(...arpeggio(notes, at, beat, 4, piano, level * 0.6));
    });
  }
  const tune = [
    [0, 72, 2], [2, 76, 2], [4, 79, 3], [7, 76, 1], [8, 74, 2], [10, 72, 2], [12, 71, 4],
    [16, 76, 2], [18, 79, 2], [20, 81, 3], [23, 79, 1], [24, 76, 2], [26, 72, 2], [28, 74, 4],
  ];
  events.push(...melody(bar * progression.length, beat, tune, piano, 1.1));
  events.push(...melody(bar * progression.length * 3, beat, tune, piano, 1.15));
  return normalize(fadeEdges(reverb(render(total, events), 0.34, 1.2), 0.36));
}

/* ── 엔딩: Eb major, 56 BPM ───────────────────────────────── */

export function ending() {
  const beat = 60 / 56;
  const bar = beat * 4;
  const progression = [chord(63, "maj"), chord(60, "min"), chord(56, "maj"), chord(58, "maj")];
  const total = bar * progression.length * 4;
  const events = [];
  for (let pass = 0; pass < 4; pass += 1) {
    progression.forEach((notes, i) => {
      const at = pass * bar * progression.length + i * bar;
      events.push(...arpeggio(notes, at, beat, 4, piano, 0.85));
      notes.forEach((m) => events.push({ at, dur: bar * 1.1, midi: m + 12, vel: 0.45, voice: pad }));
      events.push({ at, dur: bar, midi: notes[0] - 24, vel: 0.6, voice: bass });
    });
  }
  const tune = [
    [0, 75, 3], [3, 74, 1], [4, 70, 4], [8, 72, 3], [11, 70, 1], [12, 67, 4],
    [16, 75, 2], [18, 79, 2], [20, 78, 4], [24, 75, 2], [26, 74, 2], [28, 70, 4],
  ];
  events.push(...melody(bar * progression.length, beat, tune, piano, 1.1));
  events.push(...melody(bar * progression.length * 2.5, beat, tune, piano, 0.95));
  return normalize(fadeEdges(reverb(render(total, events), 0.42, 1.5), 0.42));
}

/* ── 효과음 ────────────────────────────────────────────────── */

function shaped(dur, fn) {
  const out = buffer(dur);
  for (let i = 0; i < out.length; i += 1) out[i] = fn(i / SR, dur);
  return out;
}

export const SFX = {
  "ui-click": () => {
    const dur = 0.11;
    const body = shaped(dur, (t) => Math.sin(2 * Math.PI * 1100 * t) * Math.exp(-42 * t));
    const tick = lowpass(noise(dur), 4200);
    for (let i = 0; i < body.length; i += 1) body[i] += tick[i] * Math.exp(-90 * (i / SR)) * 0.4;
    return normalize(body, -7);
  },
  "ui-hover": () => normalize(shaped(0.07, (t) => Math.sin(2 * Math.PI * 2300 * t) * Math.exp(-60 * t)), -16),
  "page-turn": () => {
    const dur = 0.55;
    const n = bandpass(noise(dur), 900, 7000);
    for (let i = 0; i < n.length; i += 1) {
      const t = i / SR;
      const sweep = Math.sin(Math.PI * Math.min(1, t / dur)) ** 1.6;
      n[i] *= sweep * (0.7 + 0.3 * Math.sin(2 * Math.PI * 7 * t));
    }
    return normalize(n, -9);
  },
  "door-open": () => {
    const dur = 1.0;
    const creak = shaped(dur, (t) => {
      const f = 150 + 60 * Math.sin(2 * Math.PI * 1.6 * t) + 30 * t;
      return Math.sin(2 * Math.PI * f * t) * Math.exp(-1.6 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 23 * t));
    });
    const latch = shaped(dur, (t) => (t > 0.82 ? Math.sin(2 * Math.PI * 700 * (t - 0.82)) * Math.exp(-50 * (t - 0.82)) : 0));
    for (let i = 0; i < creak.length; i += 1) creak[i] = creak[i] * 0.8 + latch[i] * 0.6;
    return normalize(reverb(creak, 0.18), -8);
  },
  footsteps: () => {
    const dur = 2.0;
    const out = buffer(dur);
    [0.1, 0.58, 1.06, 1.54].forEach((at, k) => {
      const step = lowpass(noise(0.16), 900 - k * 40);
      for (let i = 0; i < step.length; i += 1) step[i] *= Math.exp(-26 * (i / SR));
      const thud = shaped(0.16, (t) => Math.sin(2 * Math.PI * 92 * t) * Math.exp(-28 * t) * 0.7);
      for (let i = 0; i < step.length; i += 1) step[i] += thud[i];
      mixInto(out, Math.round(at * SR), step, 0.9 - k * 0.06);
    });
    return normalize(reverb(out, 0.2), -9);
  },
  "rain-loop": () => {
    const dur = 7.0;
    const bed = bandpass(noise(dur), 350, 6500);
    for (let i = 0; i < bed.length; i += 1) {
      const t = i / SR;
      bed[i] *= 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.23 * t) + 0.06 * Math.sin(2 * Math.PI * 1.7 * t);
    }
    const drops = buffer(dur);
    for (let k = 0; k < 90; k += 1) {
      const at = random() * (dur - 0.3);
      const d = shaped(0.12, (t) => Math.sin(2 * Math.PI * (1800 + random() * 900) * t) * Math.exp(-70 * t));
      mixInto(drops, Math.round(at * SR), d, 0.12);
    }
    for (let i = 0; i < bed.length; i += 1) bed[i] += drops[i];
    return normalize(fadeEdges(bed, 0.25), -11);
  },
  cicada: () => {
    const dur = 6.0;
    const out = buffer(dur);
    for (let i = 0; i < out.length; i += 1) {
      const t = i / SR;
      const carrier = Math.sin(2 * Math.PI * 4200 * t) + 0.6 * Math.sin(2 * Math.PI * 6300 * t);
      const buzz = 0.5 + 0.5 * Math.sin(2 * Math.PI * 42 * t);
      const chorus = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.31 * t) ** 2;
      out[i] = carrier * buzz * chorus * 0.2;
    }
    const shimmer = bandpass(noise(dur), 3000, 9000);
    for (let i = 0; i < out.length; i += 1) out[i] += shimmer[i] * 0.06;
    return normalize(fadeEdges(bandpass(out, 2500, 9500), 0.3), -13);
  },
  "phone-buzz": () => {
    const dur = 1.0;
    const out = shaped(dur, (t) => {
      const on = (t < 0.34) || (t > 0.5 && t < 0.84);
      if (!on) return 0;
      const local = t < 0.34 ? t : t - 0.5;
      const env = Math.min(1, local / 0.02) * Math.exp(-1.2 * local);
      return (Math.sin(2 * Math.PI * 62 * t) + 0.5 * Math.sin(2 * Math.PI * 124 * t)) * env * (0.7 + 0.3 * Math.sin(2 * Math.PI * 180 * t));
    });
    return normalize(out, -9);
  },
  "brush-stroke": () => {
    const dur = 0.45;
    const n = bandpass(noise(dur), 500, 5200);
    for (let i = 0; i < n.length; i += 1) {
      const t = i / SR;
      n[i] *= Math.sin(Math.PI * (t / dur)) ** 1.2 * (0.75 + 0.25 * Math.sin(2 * Math.PI * 14 * t));
    }
    return normalize(reverb(n, 0.12), -12);
  },
  heartbeat: () => {
    const dur = 2.0;
    const out = buffer(dur);
    [0.12, 0.42, 1.12, 1.42].forEach((at, k) => {
      const strong = k % 2 === 0;
      const thump = shaped(0.3, (t) => {
        const f = strong ? 56 : 48;
        return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.exp(-13 * t);
      });
      mixInto(out, Math.round(at * SR), thump, strong ? 1 : 0.7);
    });
    return normalize(lowpass(out, 260), -8);
  },
};

export const BGM = { "main-theme": mainTheme, daily, rain, warm, ending };
