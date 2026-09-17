/**
 * losia.online 개인 토큰(la_…) 저장소.
 *
 * credentials.ts 의 auth.json 과 분리된 파일이다 — 갱신·쓰기 주기가 다르고, 이 토큰은
 * Google OAuth 갱신 절차와 무관하게 사용자가 스튜디오에서 직접 넣는다.
 * 쓰기는 writeFileAtomic + 0600 으로 다른 사용자가 읽지 못하게 한다.
 */
import { readFile, unlink } from "node:fs/promises";
import { writeFileAtomic } from "../atomic.js";
import { LOSIA_TOKEN_FILE } from "../config.js";

/** losia 가 발급하는 개인 토큰 형식 — `la_` + 40 hex. */
export const LOSIA_TOKEN_PATTERN = /^la_[0-9a-f]{40}$/;

export interface LosiaTokenStore {
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export function createFileLosiaTokenStore(path: string = LOSIA_TOKEN_FILE): LosiaTokenStore {
  return {
    async read() {
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { token?: unknown };
        return typeof parsed["token"] === "string" && LOSIA_TOKEN_PATTERN.test(parsed["token"]) ? parsed["token"] : null;
      } catch {
        return null;
      }
    },
    async write(token) {
      await writeFileAtomic(path, `${JSON.stringify({ token }, null, 2)}\n`, 0o600);
    },
    async clear() {
      try {
        await unlink(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}

/** 테스트용 인메모리 저장소. */
export function createMemoryLosiaTokenStore(initial: string | null = null): LosiaTokenStore & { peek(): string | null } {
  let current = initial;
  return {
    read: async () => current,
    write: async token => { current = token; },
    clear: async () => { current = null; },
    peek: () => current,
  };
}
