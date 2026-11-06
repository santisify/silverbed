import { zipSync, type Zippable } from "fflate";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Builds an in-memory zip archive from named entries (deflate). */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const files: Zippable = {};
  const used = new Map<string, number>();
  for (const entry of entries) {
    const count = used.get(entry.name) ?? 0;
    used.set(entry.name, count + 1);
    const name = count === 0 ? entry.name : entry.name.replace(/(\.[^.]+)?$/, `-${count}$1`);
    files[name] = entry.data;
  }
  return zipSync(files, { level: 6 });
}
