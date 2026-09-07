import type {Page} from "@playwright/test";

export interface ZipBackupFile {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

/** Build the real export ZIP in the browser and land it on disk without CDP number[] copies. */
export async function materializeZipBackup(page: Page, destPath: string): Promise<ZipBackupFile> {
  const downloadWait = page.waitForEvent("download");
  const meta = await page.evaluate(async () => {
    const projectModule = "/src/studio/projects.ts", bundleModule = "/src/studio/exportBundle.ts";
    const {newProject} = await import(projectModule);
    const {buildExportBundle} = await import(bundleModule);
    const {blob, filename} = await buildExportBundle(newProject("외부 zip 복구 작품"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer));
    let sha256 = "";
    for (const byte of digest) sha256 += byte.toString(16).padStart(2, "0");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    Reflect.set(globalThis, "revokeBackupUrl", () => {
      URL.revokeObjectURL(url);
    });
    return {byteLength: bytes.length, sha256};
  });
  try {
    const download = await downloadWait;
    await download.saveAs(destPath);
  } finally {
    await page.evaluate(() => {
      const revoke = Reflect.get(globalThis, "revokeBackupUrl");
      if (typeof revoke === "function") revoke();
      Reflect.deleteProperty(globalThis, "revokeBackupUrl");
    });
  }
  return {path: destPath, byteLength: meta.byteLength, sha256: meta.sha256};
}
