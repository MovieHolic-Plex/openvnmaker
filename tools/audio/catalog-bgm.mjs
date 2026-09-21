/**
 * losia 카탈로그용 추가 BGM — 내장 OST(tracks.mjs)가 덮지 못하는 감정대를 채운다.
 * 재현성 테스트가 내장 트랙의 해시를 검증하므로 여기는 별도 파일로 둔다.
 *
 * 각 함수는 Float32Array(모노, 44100Hz) 를 돌려준다. 루프용이라 양끝을
 * fadeEdges 로 닦는다 — 루프 이음새가 딸깍이지 않게.
 */
import { random } from "./random.mjs";
import {
  SR, bandpass, bass, bell, buffer, epiano, fadeEdges, highpass, lowpass,
  midiToFreq, mixInto, noise, normalize, pad, piano, pluck, reverb,
} from "./synth.mjs";

function render(seconds, events) {
  const out = buffer(seconds);
  for (const ev of events) mixInto(out, Math.round(ev.at * SR), ev.voice(midiToFreq(ev.midi), ev.dur, ev.vel ?? 1), 1);
  return out;
}
const CHORD_SHAPES = { maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], sus4: [0, 5, 7], dim: [0, 3, 6], aug: [0, 4, 8] };
const chord = (root, shape) => CHORD_SHAPES[shape].map(i => root + i);
function arpeggio(notes, at, beat, count, voice, vel = 1) {
  const path = [...notes, ...notes.slice(1, -1).reverse()];
  return Array.from({ length: count }, (_, i) => ({ at: at + i * beat, dur: beat * 1.9, midi: path[i % path.length] + (i >= path.length ? 12 : 0), vel, voice }));
}
function melody(at, beat, line, voice, vel = 1) {
  return line.filter(([, m]) => m !== null).map(([o, midi, len = 1]) => ({ at: at + o * beat, dur: beat * len, midi, vel, voice }));
}
function shaped(dur, fn) {
  const out = buffer(dur);
  for (let i = 0; i < out.length; i += 1) out[i] = fn(i / SR, dur);
  return out;
}

/* ── 긴장: A minor, 100 BPM — 8분 저음 펄스 + 간헐적 스타카토 ── */
export function tension() {
  const beat = 60 / 100, bar = beat * 4;
  const prog = [chord(45, "min"), chord(45, "min"), chord(41, "maj"), chord(43, "sus4"), chord(45, "min"), chord(40, "aug")];
  const total = bar * prog.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      for (let k = 0; k < 8; k++) events.push({ at: at + k * beat / 2, dur: beat * 0.42, midi: notes[0] - 12, vel: 0.62, voice: bass });
      notes.forEach(m => events.push({ at, dur: bar * 0.96, midi: m + 12, vel: 0.4, voice: pad }));
      if (pass === 1) [0.75, 2.5].forEach(d => events.push({ at: at + d * beat, dur: beat * 0.5, midi: notes[2] + 24, vel: 0.5, voice: pluck }));
    });
  }
  return normalize(fadeEdges(reverb(render(total, events), 0.3, 0.9), 0.3));
}

/* ── 미스터리: D minor 6/8, 66 BPM — 오르골 아르페지오 + 옅은 패드 ── */
export function mystery() {
  const beat = 60 / 66, bar = beat * 3; // 6/8 느낌 — 3분박
  const prog = [chord(62, "min"), chord(58, "maj"), chord(60, "maj"), chord(57, "min")];
  const total = bar * prog.length * 4;
  const events = [];
  for (let pass = 0; pass < 4; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      events.push(...arpeggio(notes.map(m => m + 12), at, beat / 2, 6, bell, 0.7));
      notes.forEach(m => events.push({ at, dur: bar * 1.1, midi: m, vel: 0.4, voice: pad }));
      events.push({ at, dur: bar, midi: notes[0] - 24, vel: 0.5, voice: bass });
    });
  }
  const tune = [[0, 86, 1.5], [1.5, 84, 0.5], [2, 81, 1], [3, 79, 2], [6, 81, 1], [7, 84, 1], [8, 86, 1], [9, 89, 3], [12, 86, 1.5], [13.5, 84, 0.5], [14, 81, 1], [15, 77, 3]];
  events.push(...melody(bar * prog.length * 2, beat, tune, bell, 0.8));
  return normalize(fadeEdges(reverb(render(total, events), 0.4, 1.3), 0.4));
}

/* ── 코믹: C major, 132 BPM — 통통 튀는 플럭 + 트라이톤 도약 ── */
export function comic() {
  const beat = 60 / 132, bar = beat * 4;
  const prog = [chord(60, "maj"), chord(65, "maj"), chord(67, "dom7"), chord(60, "maj")];
  const total = bar * prog.length * 4;
  const events = [];
  for (let pass = 0; pass < 4; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      [0, 1.5, 2, 3.5].forEach((d, k) => events.push({ at: at + d * beat, dur: beat * 0.3, midi: notes[k % notes.length] + 12, vel: 0.75, voice: pluck }));
      events.push({ at, dur: beat * 0.5, midi: notes[0] - 12, vel: 0.8, voice: bass });
      events.push({ at: at + 2 * beat, dur: beat * 0.5, midi: notes[0] - 5, vel: 0.7, voice: bass });
    });
  }
  const tune = [[0, 84, 0.5], [0.5, 79, 0.5], [1, 84, 0.5], [1.5, 88, 0.5], [2, 84, 1], [4, 82, 0.5], [4.5, 79, 0.5], [5, 76, 1], [6, 78, 1], [8, 81, 0.5], [8.5, 84, 0.5], [9, 88, 1], [10, 84, 2], [12, 79, 0.5], [12.5, 82, 0.5], [13, 85, 0.5], [13.5, 82, 0.5], [14, 79, 2]];
  events.push(...melody(bar * prog.length, beat, tune, pluck, 1.0));
  events.push(...melody(bar * prog.length * 3, beat, tune, pluck, 1.05));
  return normalize(fadeEdges(reverb(render(total, events), 0.18, 0.8), 0.25));
}

/* ── 이별: E minor, 56 BPM — 독주 피아노 + 패드 스웰 ── */
export function farewell() {
  const beat = 60 / 56, bar = beat * 4;
  const prog = [chord(52, "min"), chord(48, "maj"), chord(55, "maj"), chord(50, "maj7")];
  const total = bar * prog.length * 3;
  const events = [];
  for (let pass = 0; pass < 3; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      notes.forEach(m => events.push({ at, dur: bar * 1.08, midi: m + 12, vel: 0.42 + pass * 0.08, voice: pad }));
      events.push(...arpeggio(notes, at, beat, 4, piano, 0.6));
    });
  }
  const tune = [
    [0, 76, 3], [3, 74, 1], [4, 71, 2], [6, 69, 2], [8, 71, 1], [9, 74, 1], [10, 76, 2], [12, 79, 4],
    [16, 78, 1], [17, 76, 1], [18, 74, 2], [20, 71, 4], [24, 74, 1], [25, 76, 1], [26, 79, 1], [27, 76, 1], [28, 74, 4],
  ];
  events.push(...melody(bar * prog.length, beat, tune, piano, 1.0));
  events.push(...melody(bar * prog.length * 2, beat, tune, piano, 1.1));
  return normalize(fadeEdges(reverb(render(total, events), 0.44, 1.5), 0.45));
}

/* ── 왈츠: F major 3/4, 108 BPM — 로맨스 ── */
export function waltz() {
  const beat = 60 / 108, bar = beat * 3;
  const prog = [chord(53, "maj"), chord(58, "maj"), chord(55, "min7"), chord(60, "dom7")];
  const total = bar * prog.length * 6;
  const events = [];
  for (let pass = 0; pass < 6; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      events.push({ at, dur: beat * 0.9, midi: notes[0] - 12, vel: 0.85, voice: bass });
      [1, 2].forEach(d => notes.slice(1).forEach(m => events.push({ at: at + d * beat, dur: beat * 0.8, midi: m + 12, vel: 0.5, voice: epiano })));
    });
  }
  const tune = [
    [0, 77, 1.5], [1.5, 81, 0.5], [2, 84, 1], [3, 81, 1], [4, 77, 1], [5, 74, 1], [6, 77, 3],
    [9, 79, 1.5], [10.5, 82, 0.5], [11, 86, 1], [12, 84, 1], [13, 81, 1], [14, 77, 1], [15, 79, 3],
    [18, 81, 1], [19, 84, 1], [20, 88, 1], [21, 86, 1.5], [22.5, 84, 0.5], [23, 81, 1], [24, 77, 6],
  ];
  events.push(...melody(bar * prog.length * 2, beat, tune, epiano, 0.95));
  events.push(...melody(bar * prog.length * 4, beat, tune, epiano, 1.05));
  return normalize(fadeEdges(reverb(render(total, events), 0.3, 1.1), 0.35));
}

/* ── 추격: E minor, 152 BPM — 몰아치는 8분 베이스 ── */
export function chase() {
  const beat = 60 / 152, bar = beat * 4;
  const prog = [chord(40, "min"), chord(40, "min"), chord(43, "maj"), chord(38, "maj"), chord(40, "min"), chord(41, "dim"), chord(47, "dom7"), chord(40, "min")];
  const total = bar * prog.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      for (let k = 0; k < 8; k++) events.push({ at: at + k * beat / 2, dur: beat * 0.38, midi: notes[0] - 12 + (k === 7 ? 2 : 0), vel: 0.72, voice: bass });
      notes.forEach((m, k) => events.push({ at: at + k * 0.008, dur: bar * 0.5, midi: m + 24, vel: 0.45, voice: pad }));
      [0, 2].forEach(d => events.push({ at: at + d * beat, dur: beat * 0.25, midi: notes[0] + 24, vel: 0.7, voice: pluck }));
    });
  }
  const music = render(total, events);
  const drive = bandpass(noise(total), 900, 5200);
  for (let i = 0; i < music.length; i++) {
    const t = i / SR;
    music[i] += drive[i] * 0.05 * (Math.sin(2 * Math.PI * t / (beat * 2)) > 0.4 ? 1 : 0.25);
  }
  return normalize(fadeEdges(music, 0.2));
}

/* ── 판타지: D major(믹소), 96 BPM — 종 + 넓은 패드 ── */
export function fantasy() {
  const beat = 60 / 96, bar = beat * 4;
  const prog = [chord(50, "maj"), chord(55, "maj"), chord(48, "maj"), chord(57, "maj"), chord(50, "maj"), chord(52, "min"), chord(55, "maj"), chord(45, "maj")];
  const total = bar * prog.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      notes.forEach(m => events.push({ at, dur: bar * 1.02, midi: m + 12, vel: 0.5, voice: pad }));
      events.push({ at, dur: bar * 0.9, midi: notes[0] - 24, vel: 0.62, voice: bass });
      [0.5, 1.5, 2.5, 3.5].forEach((d, k) => events.push({ at: at + d * beat, dur: beat, midi: notes[k % notes.length] + 24, vel: 0.5, voice: bell }));
    });
  }
  const tune = [[0, 74, 2], [2, 78, 1], [3, 81, 1], [4, 78, 4], [8, 76, 2], [10, 74, 1], [11, 71, 1], [12, 74, 4], [16, 78, 2], [18, 81, 1], [19, 83, 1], [20, 81, 4], [24, 78, 2], [26, 76, 1], [27, 74, 1], [28, 71, 4]];
  events.push(...melody(bar * prog.length, beat, tune, bell, 0.85));
  return normalize(fadeEdges(reverb(render(total, events), 0.38, 1.4), 0.4));
}

/* ── 공포: 저역 드론 + 성긴 고역 종, 50 BPM ── */
export function dread() {
  const beat = 60 / 50, bar = beat * 4;
  const prog = [chord(38, "min"), chord(37, "dim"), chord(38, "min"), chord(33, "maj")];
  const total = bar * prog.length * 3;
  const events = [];
  for (let pass = 0; pass < 3; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      events.push({ at, dur: bar * 1.1, midi: notes[0] - 12, vel: 0.75, voice: bass });
      notes.forEach(m => events.push({ at, dur: bar * 1.05, midi: m + 12, vel: 0.3, voice: pad }));
      if (random() > 0.4) events.push({ at: at + random() * bar * 0.7, dur: beat * 2, midi: notes[1] + 36 + (random() > 0.5 ? 1 : 0), vel: 0.4, voice: bell });
    });
  }
  const music = render(total, events);
  const rumble = lowpass(noise(total), 90);
  for (let i = 0; i < music.length; i++) music[i] += rumble[i] * 0.35;
  return normalize(fadeEdges(reverb(music, 0.5, 1.6), 0.5), -6);
}

/* ── 자장가: G major 6/8, 66 BPM — 오르골 ── */
export function lullaby() {
  const beat = 60 / 66, bar = beat * 3;
  const prog = [chord(55, "maj"), chord(52, "min"), chord(48, "maj"), chord(50, "dom7")];
  const total = bar * prog.length * 5;
  const events = [];
  for (let pass = 0; pass < 5; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      events.push({ at, dur: beat * 0.9, midi: notes[0] - 12, vel: 0.5, voice: bass });
      events.push(...arpeggio(notes, at, beat / 2, 6, bell, 0.45));
      notes.forEach(m => events.push({ at, dur: bar * 1.05, midi: m + 12, vel: 0.3, voice: pad }));
    });
  }
  const tune = [[0, 79, 1.5], [1.5, 83, 0.5], [2, 86, 1], [3, 83, 2], [6, 81, 1.5], [7.5, 79, 0.5], [8, 76, 1], [9, 74, 3], [12, 76, 1.5], [13.5, 79, 0.5], [14, 83, 1], [15, 79, 3], [18, 74, 1.5], [19.5, 76, 0.5], [20, 79, 1], [21, 71, 3]];
  events.push(...melody(bar * prog.length, beat, tune, bell, 0.8));
  events.push(...melody(bar * prog.length * 3, beat, tune, bell, 0.75));
  return normalize(fadeEdges(reverb(render(total, events), 0.42, 1.3), 0.5));
}

/* ── 회상: Bb maj7 감성, 76 BPM — 일렉트릭 피아노 ── */
export function nostalgia() {
  const beat = 60 / 76, bar = beat * 4;
  const prog = [chord(58, "maj7"), chord(55, "min7"), chord(60, "min7"), chord(53, "maj7")];
  const total = bar * prog.length * 4;
  const events = [];
  for (let pass = 0; pass < 4; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      notes.forEach((m, k) => events.push({ at: at + k * 0.014, dur: bar * 0.85, midi: m + 12, vel: 0.55, voice: epiano }));
      events.push({ at, dur: bar * 0.9, midi: notes[0] - 24, vel: 0.55, voice: bass });
      if (pass >= 1) [1, 3].forEach(d => events.push({ at: at + d * beat, dur: beat * 0.8, midi: notes[3] + 24, vel: 0.4, voice: epiano }));
    });
  }
  const tune = [[0, 74, 1.5], [1.5, 77, 0.5], [2, 79, 2], [4, 77, 1], [5, 74, 1], [6, 70, 2], [8, 72, 4], [12, 74, 1.5], [13.5, 77, 0.5], [14, 81, 2], [16, 79, 1], [17, 77, 1], [18, 74, 2], [20, 72, 4]];
  events.push(...melody(bar * prog.length * 2, beat, tune, epiano, 0.9));
  return normalize(fadeEdges(reverb(render(total, events), 0.34, 1.2), 0.35));
}

/* ── 축제: A major, 128 BPM — 밝은 플럭 + 생동감 ── */
export function festival() {
  const beat = 60 / 128, bar = beat * 4;
  const prog = [chord(57, "maj"), chord(64, "maj"), chord(54, "maj"), chord(59, "maj"), chord(57, "maj"), chord(64, "maj"), chord(61, "min"), chord(52, "dom7")];
  const total = bar * prog.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass++) {
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      events.push(...arpeggio(notes.map(m => m + 12), at, beat / 2, 8, pluck, 0.65));
      events.push({ at, dur: beat * 0.5, midi: notes[0] - 12, vel: 0.75, voice: bass });
      events.push({ at: at + 2 * beat, dur: beat * 0.5, midi: notes[0] - 12, vel: 0.7, voice: bass });
      [1, 3].forEach(d => notes.forEach(m => events.push({ at: at + d * beat, dur: beat * 0.4, midi: m + 12, vel: 0.45, voice: epiano })));
    });
  }
  const tune = [[0, 81, 1], [1, 85, 1], [2, 88, 2], [4, 85, 1], [5, 83, 1], [6, 81, 2], [8, 78, 1], [9, 81, 1], [10, 85, 2], [12, 88, 1], [13, 90, 1], [14, 88, 2], [16, 85, 1], [17, 83, 1], [18, 81, 1], [19, 78, 1], [20, 81, 4]];
  events.push(...melody(bar * prog.length, beat, tune, pluck, 0.95));
  return normalize(fadeEdges(reverb(render(total, events), 0.2, 0.9), 0.25));
}

/* ── 결의: C→상승, 112 BPM — 점층하는 추진력 ── */
export function resolve2() {
  const beat = 60 / 112, bar = beat * 4;
  const prog = [chord(48, "maj"), chord(55, "maj"), chord(57, "min"), chord(53, "maj"), chord(50, "min"), chord(55, "dom7"), chord(48, "maj"), chord(52, "maj")];
  const total = bar * prog.length * 2;
  const events = [];
  for (let pass = 0; pass < 2; pass++) {
    const level = 0.65 + pass * 0.3;
    prog.forEach((notes, i) => {
      const at = pass * bar * prog.length + i * bar;
      notes.forEach(m => events.push({ at, dur: bar * 0.95, midi: m + 12, vel: level * 0.5, voice: pad }));
      for (let k = 0; k < 8; k++) events.push({ at: at + k * beat / 2, dur: beat * 0.45, midi: notes[0] - 12, vel: level * 0.7, voice: bass });
      events.push(...arpeggio(notes, at, beat / 2, 8, piano, level * 0.55));
    });
  }
  const tune = [[0, 72, 1], [1, 76, 1], [2, 79, 2], [4, 79, 1], [5, 81, 1], [6, 84, 2], [8, 83, 1], [9, 81, 1], [10, 79, 2], [12, 76, 4], [16, 77, 1], [17, 81, 1], [18, 84, 2], [20, 84, 1], [21, 86, 1], [22, 88, 2], [24, 86, 1], [25, 84, 1], [26, 81, 1], [27, 79, 1], [28, 84, 4]];
  events.push(...melody(bar * prog.length, beat, tune, piano, 1.0));
  return normalize(fadeEdges(reverb(render(total, events), 0.3, 1.2), 0.3));
}

/** losia 업로드용 이름·설명 — 태그는 카탈로그 facet 에 그대로 쓴다. */
export const CATALOG_BGM = {
  "bgm-tension":  { make: tension,  name: "긴장 · 쫓기는 밤",      tags: ["음악", "긴장", "밤"],     desc: "서스펜스·추리 장면용 저음 펄스" },
  "bgm-mystery":  { make: mystery,  name: "미스터리 · 오르골",     tags: ["음악", "미스터리"],      desc: "수수께끼·회상 장면의 6/8 오르골" },
  "bgm-comic":    { make: comic,    name: "코믹 · 소동극",         tags: ["음악", "코미디", "일상"], desc: "가벼운 소동·개그 장면" },
  "bgm-farewell": { make: farewell, name: "이별 · 피아노 독주",    tags: ["음악", "슬픔", "이별"],   desc: "이별·상실 장면의 느린 피아노" },
  "bgm-waltz":    { make: waltz,    name: "왈츠 · 3박자",          tags: ["음악", "로맨스"],        desc: "로맨스·무도회 장면의 3박자" },
  "bgm-chase":    { make: chase,    name: "추격 · 질주",           tags: ["음악", "액션", "긴장"],  desc: "액션·추격의 빠른 구동감" },
  "bgm-fantasy":  { make: fantasy,  name: "판타지 · 모험",         tags: ["음악", "판타지"],        desc: "여정·모험 장면의 종과 패드" },
  "bgm-dread":    { make: dread,    name: "공포 · 저역 드론",      tags: ["음악", "공포", "어둠"],   desc: "호러·불안 장면의 드론과 성긴 종" },
  "bgm-lullaby":  { make: lullaby,  name: "자장가 · 오르골",       tags: ["음악", "잔잔", "밤"],     desc: "아기·위로 장면의 오르골 자장가" },
  "bgm-nostalgia":{ make: nostalgia,name: "회상 · 일렉피아노",     tags: ["음악", "회상", "슬픔"],   desc: "그리움·과거 회상의 maj7 감성" },
  "bgm-festival": { make: festival, name: "축제 · 밝은 거리",      tags: ["음악", "축제", "일상"],   desc: "축제·외출 장면의 밝은 구동" },
  "bgm-resolve":  { make: resolve2, name: "결의 · 새벽",           tags: ["음악", "결의", "감동"],   desc: "각오·전진 장면의 점층 피아노" },
};
