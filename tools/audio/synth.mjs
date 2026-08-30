/**
 * vnmaker OST/SFX 합성용 DSP 프리미티브. 외부 샘플 없이 전부 수식으로 만든다.
 * 샘플은 Float32Array, 모노, 44100Hz 로 다룬다.
 */

export const SR = 44100;

export function buffer(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** 부드러운 ADSR. 값은 0..1. */
export function adsr(t, dur, { a = 0.01, d = 0.12, s = 0.6, r = 0.3 } = {}) {
  if (t < 0 || t > dur + r) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < dur) return s;
  return s * Math.max(0, 1 - (t - dur) / r);
}

function addInto(target, offsetSamples, source, gain) {
  const end = Math.min(target.length, offsetSamples + source.length);
  for (let i = Math.max(0, offsetSamples); i < end; i += 1) {
    target[i] += source[i - offsetSamples] * gain;
  }
}

export { addInto as mixInto };

/** 피아노 느낌. 배음별로 감쇠 속도를 달리하고 살짝 디튠한다. */
export function piano(freq, dur, velocity = 1) {
  const tail = 1.6;
  const out = buffer(dur + tail);
  const partials = [
    [1, 1.0, 1.0],
    [2, 0.46, 1.5],
    [3, 0.24, 2.1],
    [4, 0.13, 2.7],
    [5, 0.07, 3.4],
    [6, 0.04, 4.1],
    [8, 0.02, 5.0],
  ];
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let v = 0;
    for (const [mult, amp, decay] of partials) {
      const detune = 1 + (mult - 1) * 0.0008;
      v += amp * Math.exp(-decay * t) * Math.sin(2 * Math.PI * freq * mult * detune * t);
    }
    // 해머 어택
    const attack = t < 0.004 ? t / 0.004 : 1;
    const body = Math.exp(-1.1 * t);
    out[i] = v * attack * body * 0.16 * velocity;
  }
  return out;
}

/** 카플러스-스트롱 발현음. 기타/우쿨렐레 같은 뜯는 소리. */
export function pluck(freq, dur, velocity = 1, damping = 0.494) {
  const out = buffer(dur);
  const n = Math.max(2, Math.round(SR / freq));
  const line = new Float32Array(n);
  for (let i = 0; i < n; i += 1) line[i] = Math.random() * 2 - 1;
  let idx = 0;
  for (let i = 0; i < out.length; i += 1) {
    const next = (idx + 1) % n;
    const value = (line[idx] + line[next]) * damping;
    out[i] = line[idx] * 0.5 * velocity;
    line[idx] = value;
    idx = next;
  }
  return out;
}

/** 현/패드. 디튠된 톱니 세 개를 원폴 로우패스로 눌러 만든다. */
export function pad(freq, dur, velocity = 1) {
  const out = buffer(dur + 0.8);
  const detunes = [0.997, 1, 1.004];
  let lp = 0;
  const cutoff = Math.min(0.28, (freq * 6) / SR);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    let v = 0;
    for (const dt of detunes) {
      const phase = (freq * dt * t) % 1;
      v += 2 * phase - 1;
    }
    v /= detunes.length;
    lp += cutoff * (v - lp);
    const vib = 1 + 0.004 * Math.sin(2 * Math.PI * 4.7 * t);
    out[i] = lp * adsr(t, dur, { a: 0.35, d: 0.3, s: 0.8, r: 0.6 }) * 0.09 * velocity * vib;
  }
  return out;
}

/** 종/글로켄. FM 비배음 비율로 물방울 같은 소리를 만든다. */
export function bell(freq, dur, velocity = 1) {
  const out = buffer(dur + 1.2);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const mod = Math.sin(2 * Math.PI * freq * 2.76 * t) * Math.exp(-4 * t) * 2.4;
    const env = Math.exp(-2.6 * t) * (t < 0.002 ? t / 0.002 : 1);
    out[i] = Math.sin(2 * Math.PI * freq * t + mod) * env * 0.13 * velocity;
  }
  return out;
}

/** 전자 피아노. 사인 + 3배음 살짝. */
export function epiano(freq, dur, velocity = 1) {
  const out = buffer(dur + 0.9);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const env = Math.exp(-1.9 * t) * (t < 0.006 ? t / 0.006 : 1);
    const v =
      Math.sin(2 * Math.PI * freq * t) +
      0.22 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-5 * t) +
      0.1 * Math.sin(2 * Math.PI * freq * 5 * t) * Math.exp(-8 * t);
    out[i] = v * env * 0.14 * velocity;
  }
  return out;
}

/** 저역 베이스. */
export function bass(freq, dur, velocity = 1) {
  const out = buffer(dur + 0.4);
  for (let i = 0; i < out.length; i += 1) {
    const t = i / SR;
    const env = adsr(t, dur, { a: 0.012, d: 0.2, s: 0.55, r: 0.3 });
    const v = Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t);
    out[i] = Math.tanh(v * 1.2) * env * 0.17 * velocity;
  }
  return out;
}

export function noise(dur) {
  const out = buffer(dur);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.random() * 2 - 1;
  return out;
}

/** 원폴 로우패스. cutoff 는 Hz. */
export function lowpass(input, cutoffHz) {
  const out = new Float32Array(input.length);
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let z = 0;
  for (let i = 0; i < input.length; i += 1) {
    z += alpha * (input[i] - z);
    out[i] = z;
  }
  return out;
}

export function highpass(input, cutoffHz) {
  const low = lowpass(input, cutoffHz);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = input[i] - low[i];
  return out;
}

export function bandpass(input, lowHz, highHz) {
  return lowpass(highpass(input, lowHz), highHz);
}

function comb(input, delaySec, feedback) {
  const out = new Float32Array(input.length);
  const d = Math.max(1, Math.round(delaySec * SR));
  for (let i = 0; i < input.length; i += 1) {
    const back = i - d >= 0 ? out[i - d] : 0;
    out[i] = input[i] + back * feedback;
  }
  return out;
}

function allpass(input, delaySec, gain) {
  const out = new Float32Array(input.length);
  const d = Math.max(1, Math.round(delaySec * SR));
  for (let i = 0; i < input.length; i += 1) {
    const backOut = i - d >= 0 ? out[i - d] : 0;
    const backIn = i - d >= 0 ? input[i - d] : 0;
    out[i] = -gain * input[i] + backIn + gain * backOut;
  }
  return out;
}

/** 슈뢰더 리버브. amount 0..1 로 드라이/웻을 섞는다. */
export function reverb(input, amount = 0.3, size = 1) {
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((d) => comb(input, d * size, 0.76));
  const summed = new Float32Array(input.length);
  for (const c of combs) for (let i = 0; i < input.length; i += 1) summed[i] += c[i] / combs.length;
  let wet = allpass(summed, 0.005, 0.7);
  wet = allpass(wet, 0.0017, 0.7);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = input[i] * (1 - amount) + wet[i] * amount;
  return out;
}

/** 앞뒤를 0으로 내려 루프 이음새를 지운다. */
export function fadeEdges(input, seconds = 0.3) {
  const n = Math.min(Math.round(seconds * SR), Math.floor(input.length / 2));
  for (let i = 0; i < n; i += 1) {
    const g = i / n;
    input[i] *= g;
    input[input.length - 1 - i] *= g;
  }
  return input;
}

/** 피크를 target(dBFS) 로 맞춘다. */
export function normalize(input, targetDb = -3) {
  let peak = 0;
  for (const v of input) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) return input;
  const target = 10 ** (targetDb / 20);
  const gain = target / peak;
  for (let i = 0; i < input.length; i += 1) input[i] = Math.tanh(input[i] * gain * 1.02);
  return input;
}
