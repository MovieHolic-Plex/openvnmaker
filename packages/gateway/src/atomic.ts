import { randomUUID } from "node:crypto";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * tmp 파일에 쓰고 fsync 한 뒤 rename 한다 — 크래시가 나도 이전 파일이 온전히 남는다.
 * native-build-store.ts 의 saveNativeJob 과 같은 패턴이다.
 */
export async function writeFileAtomic(path: string, data: string | Buffer, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, "wx", mode);
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}
