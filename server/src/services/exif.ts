import reader from "exif-reader";

/**
 * The handful of EXIF tags worth showing next to a frame: what took the
 * picture, and how. Everything heavy (GPS, maker notes, thumbnails) is dropped
 * on the floor — the contact sheet is about the photograph, not the camera's
 * bookkeeping.
 */
export interface ExifSummary {
  make?: string;
  model?: string;
  lens?: string;
  /** ISO speed. */
  iso?: number;
  /** Aperture as an f-number, e.g. 2.8. */
  fNumber?: number;
  /** Shutter speed in seconds, e.g. 0.004. */
  exposure?: number;
  /** Focal length in millimetres. */
  focalLength?: number;
  /** Capture time, ISO 8601. */
  takenAt?: string;
  orientation?: number;
  software?: string;
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, 120) : undefined;
};

const positive = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return value;
};

const stamp = (value: unknown): string | undefined => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  // Cameras stamp local time with no zone; keep it as-is instead of pretending it is UTC.
  return value.toISOString().slice(0, 19).replace("T", " ");
};

/** Parses a TIFF/EXIF buffer; malformed blocks are simply ignored. */
export function readExif(buffer?: Buffer | null): ExifSummary | undefined {
  if (!buffer?.length) return undefined;
  try {
    const parsed = reader(buffer);
    const image = parsed.Image ?? {};
    const photo = parsed.Photo ?? {};
    const summary: ExifSummary = {
      make: text(image.Make),
      model: text(image.Model),
      lens: text((photo as Record<string, unknown>).LensModel),
      iso: positive((photo as Record<string, unknown>).ISOSpeedRatings ?? (photo as Record<string, unknown>).PhotographicSensitivity),
      fNumber: positive((photo as Record<string, unknown>).FNumber),
      exposure: positive((photo as Record<string, unknown>).ExposureTime),
      focalLength: positive((photo as Record<string, unknown>).FocalLength),
      takenAt: stamp((photo as Record<string, unknown>).DateTimeOriginal ?? image.DateTime),
      orientation: positive(image.Orientation),
      software: text(image.Software),
    };
    return Object.values(summary).some((value) => value !== undefined) ? summary : undefined;
  } catch {
    return undefined;
  }
}
