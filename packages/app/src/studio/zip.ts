export interface ZipEntry { readonly path: string; readonly bytes: Uint8Array }

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG/WebP/MP3 are already compressed. STORE ZIP avoids another large memory/compression pass. */
export function createZip(entries: readonly ZipEntry[]): Blob {
  if (entries.length > 65535) throw new Error("ZIP에 담을 수 있는 파일 수를 초과했습니다.");
  const paths = new Set<string>();
  const bodies: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    if (!entry.path || entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.split("/").some(part => !part || part === "." || part === "..") || paths.has(entry.path)) throw new Error(`ZIP 파일 경로가 올바르지 않습니다: ${entry.path}`);
    paths.add(entry.path);
    const name = new TextEncoder().encode(entry.path);
    if (name.length > 65535 || entry.bytes.length > 0xffffffff) throw new Error("파일이 ZIP 형식의 크기 제한을 초과했습니다.");
    const crc = crc32(entry.bytes);
    const header = new Uint8Array(30 + name.length);
    const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(12, 0x21, true); // 1980-01-01: stable metadata independent of local clock.
    h.setUint32(14, crc, true); h.setUint32(18, entry.bytes.length, true); h.setUint32(22, entry.bytes.length, true); h.setUint16(26, name.length, true);
    header.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, entry.bytes.length, true); c.setUint32(24, entry.bytes.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.set(name, 46);
    // A Blob owns the typed-array snapshot; no live editor data is retained.
    bodies.push(header, new Blob([entry.bytes as Uint8Array<ArrayBuffer>])); directory.push(central);
    offset += header.length + entry.bytes.length;
    if (offset > 0xffffffff) throw new Error("배포 ZIP은 4GB 미만이어야 합니다.");
  }
  const directorySize = directory.reduce((sum, bytes) => sum + bytes.length, 0);
  if (offset + directorySize + 22 > 0xffffffff) throw new Error("배포 ZIP은 4GB 미만이어야 합니다.");
  const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  return new Blob([...bodies, ...directory, end], { type: "application/zip" });
}
