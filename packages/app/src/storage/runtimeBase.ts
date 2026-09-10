/** Each standalone bundle has its own module instance; studio never configures it. */
let runtimeBase: URL | undefined;

export class RuntimeAssetPathError extends Error {
  override readonly name = "RuntimeAssetPathError";
  constructor(readonly source: string) {
    super(`Asset is not a package-owned path: ${source}`);
  }
}

/** Called before rendering or playing audio, using the exported entry module URL. */
export function configureRuntimeBase(entryUrl: string): void {
  runtimeBase = new URL("./", entryUrl);
}

/** Resolve logical asset paths, never rewrite the manuscript or its save identity. */
export function resolveRuntimeAsset(source: string, packageBase = runtimeBase): string {
  if (!packageBase) return source;
  const path = source.replace(/^(?:\.\/|\/)/, "");
  // Reject unsafe paths before URL normalization can erase traversal.
  if (!/^assets\/(?:[a-zA-Z0-9][a-zA-Z0-9_-]*\/)*[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(path)) {
    throw new RuntimeAssetPathError(source);
  }
  return new URL(path, packageBase).pathname;
}
