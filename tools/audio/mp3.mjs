/**
 * lamejs MP3 인코더 로더.
 *
 * lamejs 1.2.1 의 CommonJS 엔트리(src/js/index.js)는 MPEGMode 같은 심볼을 전역으로 기대해서
 * Node 에서 그대로 require 하면 ReferenceError 가 난다. 배포본에 함께 들어 있는
 * 브라우저 번들(lame.min.js)은 자기 안에서 전부 정의하므로, 그걸 vm 샌드박스에 올려 쓴다.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createContext, runInContext } from "node:vm";

const require = createRequire(import.meta.url);

function loadLamejs() {
  const bundlePath = require.resolve("lamejs/lame.min.js");
  const source = readFileSync(bundlePath, "utf8");
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Uint8Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    parseInt,
    parseFloat,
    isNaN,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  createContext(sandbox);
  runInContext(source, sandbox);
  const lame = sandbox.lamejs;
  if (typeof lame?.Mp3Encoder !== "function") throw new Error("lamejs 번들에서 Mp3Encoder 를 찾지 못했다");
  return lame;
}

const lamejs = loadLamejs();

/** Float32(-1..1) 모노 샘플을 MP3 버퍼로 인코딩한다. */
export function encodeMp3(samples, sampleRate, kbps = 128) {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = Math.round(v * 32767);
  }
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const chunks = [];
  const block = 1152;
  for (let i = 0; i < pcm.length; i += block) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, Math.min(i + block, pcm.length)));
    if (buf.length > 0) chunks.push(Buffer.from(buf));
  }
  const tail = encoder.flush();
  if (tail.length > 0) chunks.push(Buffer.from(tail));
  return Buffer.concat(chunks);
}
