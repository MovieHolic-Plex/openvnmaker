import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AUTH_FILE, PROVIDER } from "../config.js";

export interface Credentials {
  readonly refresh: string;
  readonly access: string;
  /** 만료 5분 전을 미리 당겨 넣은 epoch ms. */
  readonly expires: number;
  readonly projectId: string;
  readonly email?: string;
}

/** 자격증명 저장소. 읽기는 절대 던지지 않는다 — 없거나 깨졌으면 null 이다. */
export interface CredentialStore {
  read(): Promise<Credentials | null>;
  write(creds: Credentials): Promise<void>;
}

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c["refresh"] === "string" &&
    c["refresh"].length > 0 &&
    typeof c["access"] === "string" &&
    typeof c["expires"] === "number" &&
    typeof c["projectId"] === "string"
  );
}

export function createFileStore(path: string = AUTH_FILE): CredentialStore {
  return {
    async read() {
      let raw: string;
      try {
        raw = await readFile(path, "utf8");
      } catch {
        return null;
      }
      try {
        const store = JSON.parse(raw) as Record<string, unknown>;
        const creds = store[PROVIDER];
        return isCredentials(creds) ? creds : null;
      } catch {
        // 손상된 파일은 자격증명 없음으로 취급한다. 라우트는 500 대신 authenticated:false 를 준다.
        return null;
      }
    },
    async write(creds) {
      let store: Record<string, unknown> = {};
      try {
        store = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
      } catch {
        store = {};
      }
      store[PROVIDER] = creds;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
    },
  };
}

/** 테스트용 인메모리 저장소. 라우트에 주입해 네트워크 없이 검증한다. */
export function createMemoryStore(initial: Credentials | null = null): CredentialStore {
  let current = initial;
  return {
    async read() {
      return current;
    },
    async write(creds) {
      current = creds;
    },
  };
}
