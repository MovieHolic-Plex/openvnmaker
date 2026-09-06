let state = 0;
/** Per-track Mulberry32 state makes subset renders independent of track order. */
export function seedTrack(seed, kind, id) {
  state = seed >>> 0;
  for (const character of `${kind}/${id}`) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
}
export function random() {
  let value = state = (state + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
}
