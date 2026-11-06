import sharp from "sharp";
import { readExif, type ExifSummary } from "./exif";

export interface ImageInfo {
  width: number;
  height: number;
  format: string;
  animated: boolean;
  hasAlpha: boolean;
  exif?: ExifSummary;
}

const RASTERIZABLE = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "tif", "svg", "heic", "heif"]);

/** Orientations 5–8 are quarter turns, so the stored pixel grid is transposed. */
const TRANSPOSED = new Set([5, 6, 7, 8]);

/** Reads dimensions/format metadata; returns null for formats sharp cannot decode. */
export async function inspect(data: Uint8Array, ext: string): Promise<ImageInfo | null> {
  if (!RASTERIZABLE.has(ext)) return null;
  try {
    const meta = await sharp(Buffer.from(data), { animated: true }).metadata();
    const orientation = meta.orientation ?? 1;
    // Thumbnails are produced with .rotate(), so the recorded size has to match
    // the picture as displayed rather than the raw pixel grid.
    const width = (TRANSPOSED.has(orientation) ? meta.height : meta.width) ?? 0;
    const height = (TRANSPOSED.has(orientation) ? meta.width : meta.height) ?? 0;
    return {
      width,
      height,
      format: meta.format ?? ext,
      animated: (meta.pages ?? 1) > 1,
      hasAlpha: meta.hasAlpha ?? false,
      exif: readExif(meta.exif),
    };
  } catch {
    return null;
  }
}

export interface VariantOptions {
  size: number;
  quality?: number;
  watermark?: string;
}

function watermarkSvg(width: number, height: number, text: string): Buffer {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.045));
  const pad = Math.round(fontSize * 0.8);
  const escaped = text.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] as string);
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
       <text x="${width - pad}" y="${height - pad}" font-family="sans-serif" font-size="${fontSize}"
             fill="rgba(255,255,255,0.82)" stroke="rgba(0,0,0,0.35)" stroke-width="1"
             text-anchor="end">${escaped}</text>
     </svg>`,
  );
}

/**
 * Produces a resized WebP derivative. Returns null when the source cannot be
 * decoded (e.g. .ico) or when the derived image would be larger than the original.
 */
export async function makeVariant(data: Uint8Array, opts: VariantOptions): Promise<Uint8Array | null> {
  const { size, quality = 82, watermark } = opts;
  try {
    const source = sharp(Buffer.from(data), { animated: false, failOn: "none" });
    const meta = await source.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) return null;

    let pipeline = sharp(Buffer.from(data), { animated: false, failOn: "none" })
      .rotate()
      .resize({ width: Math.min(size, width), height: Math.min(size, height), fit: "inside", withoutEnlargement: true });

    const resized = await pipeline.toBuffer({ resolveWithObject: true });
    if (watermark) {
      pipeline = sharp(resized.data).composite([
        { input: watermarkSvg(resized.info.width, resized.info.height, watermark), top: 0, left: 0 },
      ]);
    }
    return await pipeline.webp({ quality, effort: 4 }).toBuffer();
  } catch {
    return null;
  }
}

/** Strips metadata while keeping bytes identical in pixels for the original copy. */
export async function normalizeOriginal(data: Uint8Array, ext: string): Promise<Uint8Array> {
  if (!["jpg", "jpeg", "png", "webp"].includes(ext)) return data;
  try {
    const img = sharp(Buffer.from(data), { animated: true, failOn: "none" });
    const meta = await img.metadata();
    if (!meta.width) return data;
    if (ext === "jpg" || ext === "jpeg") return await img.jpeg({ quality: 92 }).toBuffer();
    if (ext === "png") return await img.png({ compressionLevel: 9 }).toBuffer();
    return await img.webp({ quality: 92 }).toBuffer();
  } catch {
    return data;
  }
}
