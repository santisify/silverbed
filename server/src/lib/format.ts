export const IMAGE_EXTENSIONS = new Map<string, string>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["svg", "image/svg+xml"],
  ["ico", "image/x-icon"],
  ["tif", "image/tiff"],
  ["tiff", "image/tiff"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);

export const isImageExt = (ext: string) => IMAGE_EXTENSIONS.has(ext.toLowerCase());
export const mimeForExt = (ext: string) => IMAGE_EXTENSIONS.get(ext.toLowerCase()) ?? "application/octet-stream";

export function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

export function baseName(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

export function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/]+/g, "_")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  return (cleaned || "untitled").slice(0, 200);
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function slugTitle(title: string, fallback = "shared album") {
  return (title || fallback).replace(/\s+/g, " ").trim().slice(0, 120);
}
