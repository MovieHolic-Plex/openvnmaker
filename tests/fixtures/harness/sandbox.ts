import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKTREE = fileURLToPath(new URL("../../../", import.meta.url));
export const EVIDENCE_ROOT = resolve(WORKTREE, ".omo/evidence/gemini-medium-game-harness/t06");

/** Output boundary: never writes into source files or a sibling worktree. */
export function evidencePath(input: string): string {
  const path = resolve(WORKTREE, input);
  const local = relative(resolve(WORKTREE, ".omo"), path);
  assert.ok(local.length > 0 && !isAbsolute(local) && local !== ".." && !local.startsWith(`..${sep}`), "OUTPUT_MUST_BE_WORKTREE_OMO");
  return path;
}

export class Sandbox implements AsyncDisposable {
  readonly databaseName: string;
  readonly databasePath: string;
  #removed = false;
  constructor(readonly root: string) {
    this.databaseName = `synthetic-${basename(root)}`;
    this.databasePath = join(root, "fixture.sqlite");
  }
  get receipt() { return { root: this.root, databaseName: this.databaseName, databasePath: this.databasePath, removed: this.#removed }; }
  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#removed) return;
    await rm(this.root, { recursive: true });
    this.#removed = true;
  }
}

export async function createSandbox(parent = EVIDENCE_ROOT): Promise<Sandbox> {
  const safeParent = evidencePath(parent);
  await mkdir(safeParent, { recursive: true });
  return new Sandbox(await mkdtemp(join(safeParent, "runtime-")));
}
