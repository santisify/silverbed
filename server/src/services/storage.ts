import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { config } from "../config";

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
  size: number;
}

export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Public URL for a stored object. */
  url(key: string): string;
  /**
   * URL a browser can be redirected to instead of streaming the bytes back
   * through the API. Null means "serve it yourself".
   */
  publicUrl(key: string): string | null;
  /** Short-lived signed GET, for objects that are not world-readable. */
  signedGetUrl(key: string, ttlSeconds?: number, disposition?: string): Promise<string | null>;
  /**
   * Short-lived signed PUT, so the browser can upload straight to the bucket.
   * The headers come back with it: S3 signs `content-type` and `cache-control`,
   * so the PUT must repeat them byte for byte or the signature is rejected.
   */
  signedPutUrl(key: string, contentType: string, ttlSeconds?: number): Promise<SignedUpload | null>;
}

export interface SignedUpload {
  url: string;
  headers: Record<string, string>;
}

const MIME_BY_EXT: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  avif: "image/avif",
  svg: "image/svg+xml",
  bin: "application/octet-stream",
};

function sniff(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "bin";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

class LocalStorage implements StorageDriver {
  readonly name = "local";
  constructor(private root: string) {}

  private path(key: string): string {
    const clean = normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
    const full = resolve(this.root, clean);
    if (!full.startsWith(resolve(this.root) + sep) && full !== resolve(this.root)) {
      throw new Error("invalid storage key");
    }
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const p = this.path(key);
      const info = await stat(p);
      const body = await readFile(p);
      return { body, contentType: sniff(key), size: info.size };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await rm(this.path(key), { force: true });
    } catch {
      /* ignore */
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }

  url(key: string): string {
    return `${config.publicBaseUrl}/i/${key}`;
  }

  publicUrl(): string | null {
    return null;
  }

  async signedGetUrl(): Promise<string | null> {
    return null;
  }

  async signedPutUrl(): Promise<SignedUpload | null> {
    return null;
  }
}

/**
 * S3-compatible driver (MinIO / R2 / S3). Uses the AWS SDK lazily so the local
 * driver stays dependency-free at boot.
 */
class S3Storage implements StorageDriver {
  readonly name = "s3";
  private client: any;
  private sdk: any;

  constructor(private opts: typeof config.s3) {}

  /**
   * Endpoint without a trailing bucket: pasting `…/silverbed` into S3_ENDPOINT
   * is an easy mistake, and with path-style addressing it silently doubles the
   * bucket in every URL.
   */
  private endpoint(): string | undefined {
    const raw = this.opts.endpoint;
    if (!raw) return undefined;
    const trimmed = raw.replace(/\/+$/, "");
    const suffix = `/${this.opts.bucket}`;
    return trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
  }

  private async ready() {
    if (!this.client) {
      this.sdk = await import("@aws-sdk/client-s3");
      this.client = new this.sdk.S3Client({
        region: this.opts.region || "us-east-1",
        endpoint: this.endpoint(),
        forcePathStyle: Boolean(this.opts.endpoint),
        // R2 and friends reject the SDK's default CRC32 checksum parameters on
        // presigned uploads, and the browser has no way to send them.
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        credentials: this.opts.accessKey
          ? { accessKeyId: this.opts.accessKey, secretAccessKey: this.opts.secretKey }
          : undefined,
      });
    }
    return this.client;
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const client = await this.ready();
    await client.send(
      new this.sdk.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: data,
        ContentType: contentType || sniff(key),
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    const client = await this.ready();
    try {
      const res = await client.send(new this.sdk.GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      const bytes = new Uint8Array(await res.Body.transformToByteArray());
      return { body: bytes, contentType: res.ContentType ?? sniff(key), size: bytes.byteLength };
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    const client = await this.ready();
    await client.send(new this.sdk.DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key })).catch(() => {});
  }

  async exists(key: string): Promise<boolean> {
    const client = await this.ready();
    try {
      await client.send(new this.sdk.HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  url(key: string): string {
    if (this.opts.publicUrl) return `${this.opts.publicUrl}/${key}`;
    const endpoint = this.endpoint();
    if (endpoint) return `${endpoint}/${this.opts.bucket}/${key}`;
    return `https://${this.opts.bucket}.s3.${this.opts.region}.amazonaws.com/${key}`;
  }

  /** Only when the bucket is served by a CDN/public domain — otherwise we proxy. */
  publicUrl(key: string): string | null {
    return this.opts.publicUrl ? `${this.opts.publicUrl}/${key}` : null;
  }

  async signedGetUrl(key: string, ttlSeconds = 300, disposition?: string): Promise<string | null> {
    const client = await this.ready();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    return getSignedUrl(
      client,
      new this.sdk.GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: ttlSeconds },
    );
  }

  async signedPutUrl(key: string, contentType: string, ttlSeconds = 900): Promise<SignedUpload | null> {
    const client = await this.ready();
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    const type = contentType || sniff(key);
    const cacheControl = "public, max-age=31536000, immutable";
    const url = await getSignedUrl(
      client,
      new this.sdk.PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        ContentType: type,
        CacheControl: cacheControl,
      }),
      { expiresIn: ttlSeconds },
    );
    return { url, headers: { "Content-Type": type, "Cache-Control": cacheControl } };
  }
}

let driver: StorageDriver | null = null;

export function storage(): StorageDriver {
  if (driver) return driver;
  if (config.storageDriver === "s3") {
    driver = new S3Storage(config.s3);
  } else if (process.env.VERCEL) {
    throw new Error(
      "STORAGE_DRIVER=s3 is required on Vercel — the function filesystem is read-only. Point S3_* at a bucket (Cloudflare R2, MinIO, S3).",
    );
  } else {
    driver = new LocalStorage(join(resolve(config.dataDir), "uploads"));
  }
  return driver;
}

export function keyFor(userId: string, id: string, variant: string, ext: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${variant}/${userId}/${yyyy}${mm}/${id}.${ext}`;
}
