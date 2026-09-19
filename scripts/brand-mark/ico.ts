/**
 * PNG 몇 장을 .ico 하나로 묶는다. Windows 아이콘은 PNG 를 그대로 품을 수 있어(Vista+)
 * 압축 없이 디렉터리만 쓰면 된다 — 이 한 가지 때문에 의존성을 더하지 않는다.
 */
export type IcoEntry = { size: number; png: Buffer };

export function packIco(entries: IcoEntry[]): Buffer {
  if (!entries.length) throw new Error("ico_needs_entries");
  if (entries.some((e) => e.size < 1 || e.size > 256)) throw new Error("ico_size_out_of_range");
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    // 256 은 0 으로 적는다(형식 규칙).
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size === 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // 팔레트 없음
    directory.writeUInt8(0, at + 3); // reserved
    directory.writeUInt16LE(1, at + 4); // color planes
    directory.writeUInt16LE(32, at + 6); // bits per pixel
    directory.writeUInt32LE(entry.png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((e) => e.png)]);
}
