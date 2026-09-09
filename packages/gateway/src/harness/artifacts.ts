import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { extensionFor, sanitizeName } from "../images/store.js";

const HASH = /^[a-f0-9]{64}$/;

export class ArtifactPathError extends Error {
  override readonly name = "ArtifactPathError";
  constructor(readonly code: "traversal" | "unsupported-mime" | "mismatch") {
    super(code);
  }
}

export function isForbiddenImageUrl(url: string): boolean {
  const trimmed = url.trim();
  return trimmed !== url || /^(https?:)?\/\//i.test(trimmed) || /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

export function rejectRemoteImageUrl(url: string): { readonly kind: "rejected-remote-url"; readonly fetched: 0 } {
  void url;
  return { kind: "rejected-remote-url", fetched: 0 };
}

function assertInside(root: string, candidate: string): string {
  const base = resolve(root);
  const full = resolve(candidate);
  const rel = relative(base, full);
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new ArtifactPathError("traversal");
  return full;
}

export class CandidateArtifactStore {
  constructor(private readonly root: string) {}

  private fileName(hash: string, mime: string): string {
    if (!HASH.test(hash)) throw new ArtifactPathError("traversal");
    const ext = extensionFor(mime);
    if (ext === "bin") throw new ArtifactPathError("unsupported-mime");
    const name = `${hash}.${ext}`;
    if (sanitizeName(name) !== name) throw new ArtifactPathError("traversal");
    return name;
  }

  private async path(kind: "originals" | "deliveries", hash: string, mime: string): Promise<string> {
    const directory = assertInside(this.root, resolve(this.root, kind));
    await mkdir(directory, { recursive: true });
    return assertInside(directory, resolve(directory, this.fileName(hash, mime)));
  }

  async putOriginal(hash: string, bytes: Uint8Array, mime = "image/png"): Promise<"stored" | "exists"> {
    return this.put("originals", hash, bytes, mime);
  }

  async putDelivery(hash: string, bytes: Uint8Array, mime = "image/png"): Promise<"stored" | "exists"> {
    return this.put("deliveries", hash, bytes, mime);
  }

  async get(hash: string, mime = "image/png"): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(await this.path("originals", hash, mime)));
    } catch {
      try {
        return new Uint8Array(await readFile(await this.path("deliveries", hash, mime)));
      } catch {
        return null;
      }
    }
  }

  resolveNamed(rawName: string): string {
    const safe = sanitizeName(rawName);
    if (!safe || rawName.includes("..") || rawName.includes("/") || rawName.includes("\\") || rawName.includes("\0")) {
      throw new ArtifactPathError("traversal");
    }
    if (safe !== rawName) throw new ArtifactPathError("traversal");
    return assertInside(this.root, resolve(this.root, safe));
  }

  private async put(kind: "originals" | "deliveries", hash: string, bytes: Uint8Array, mime: string): Promise<"stored" | "exists"> {
    const path = await this.path(kind, hash, mime);
    try {
      await writeFile(path, bytes, { flag: "wx" });
      return "stored";
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
        const existing = await readFile(path);
        if (existing.length !== bytes.length || existing.some((value, index) => value !== bytes[index])) {
          throw new ArtifactPathError("mismatch");
        }
        return "exists";
      }
      throw error;
    }
  }
}
