import type { Character } from "./schema.js";
import { CHARACTERS, EXPRESSIONS } from "./manifest.js";

export function validCharacterKey(value: unknown): value is string {
  return typeof value==="string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) && !["constructor","prototype","__proto__"].includes(value);
}
/** Only bundled actors have implicit files. Other actors may be dialogue-only. */
export function characterImage(character: Character | undefined, expression="neutral"): string | undefined {
  if(!character)return undefined;
  const explicit=character.expressionImages?.[expression]??character.expressionImages?.neutral;
  if(explicit)return explicit;
  if((CHARACTERS as readonly string[]).includes(character.id))return `/assets/sprite/${character.id}-${(EXPRESSIONS as readonly string[]).includes(expression)?expression:"neutral"}.png`;
  return undefined;
}
export function characterExpressions(character: Character | undefined): string[] {
  return [...new Set<string>([...EXPRESSIONS,...Object.keys(character?.expressionImages??{})])];
}
