export function assertNever(value: never): never {
  throw new Error(`unexpected: ${String(value)}`);
}

export function isPlainRecord(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function readObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isPlainRecord(value)) return undefined;
  return value;
}

export function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return readObject(value) !== undefined;
}
