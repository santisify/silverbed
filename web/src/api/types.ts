export interface User {
    id: string;
    username: string;
    email: string | null;
    role: "admin" | "user";
    status: string;
    avatarUrl: string | null;
    provider: string;
    defaultAccess: "public" | "private";
    storageQuota: number;
    storageUsed: number;
    fileCount: number;
    createdAt: string;
    lastLoginAt: string | null;
}

export interface TagRef {
    id: string;
    name: string;
    color: string;
}

/** The photographic tags the API keeps from an upload's EXIF block. */
export interface ExifSummary {
    make?: string;
    model?: string;
    lens?: string;
    iso?: number;
    fNumber?: number;
    exposure?: number;
    focalLength?: number;
    takenAt?: string;
    orientation?: number;
    software?: string;
}

export interface ImageFile {
    id: string;
    name: string;
    ext: string;
    mime: string;
    size: number;
    sizeHuman: string;
    width: number;
    height: number;
    hash: string;
    folderId: string | null;
    accessLevel: "public" | "private";
    status: string;
    description: string | null;
    views: number;
    downloads: number;
    storage: string;
    hasThumb: boolean;
    hasPreview: boolean;
    uploadedVia: string;
    exif?: ExifSummary | null;
    apiKeyId: string | null;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    tags: TagRef[];
    url?: string;
    thumbUrl?: string | null;
    previewUrl?: string | null;
}

/** A presigned direct upload: the browser PUTs the file, then imports it. */
export interface UploadTicket {
    id: string;
    key: string;
    name: string;
    ext: string;
    mime: string;
    size: number;
    folderId: string | null;
    accessLevel: string;
    maxMb: number;
    uploadUrl: string;
    headers: Record<string, string>;
    expiresIn: number;
}

export interface UploadedFile {
    id: string;
    name: string;
    ext: string;
    mime: string;
    size: number;
    width: number;
    height: number;
    hash: string;
    thumbKey: string | null;
    previewKey: string | null;
    deduplicated: boolean;
    url: string;
    thumbUrl: string | null;
    previewUrl: string | null;
    pageUrl: string;
    markdown: string;
    html: string;
    createdAt: string;
}

export interface GalleryOwner {
    id: string;
    username: string;
}

export interface GalleryItem extends ImageFile {
    owner: GalleryOwner;
    canManage: boolean;
}

export interface GalleryOwnerCount extends GalleryOwner {
    count: number;
}

export interface GalleryFolderPick {
    id: string;
    name: string;
    parentId: string | null;
    fileCount: number;
}

export interface GalleryBatchResult {
    affected: number;
    skipped: { id: string; reason: string }[];
}

export interface Folder {
    id: string;
    name: string;
    parentId: string | null;
    accessLevel: "public" | "private";
    fileCount: number;
    createdAt: string;
}

export interface FolderNode extends Folder {
    children: FolderNode[];
}

export interface Tag {
    id: string;
    name: string;
    color: string;
    fileCount: number;
    createdAt: string;
}

export interface Share {
    id: string;
    token: string;
    title: string;
    kind: string;
    folderId: string | null;
    hasPassword: boolean;
    expiresAt: string | null;
    allowDownload: boolean;
    viewCount: number;
    downloadCount: number;
    revoked: boolean;
    createdAt: string;
    url: string;
    expired: boolean;
    itemCount?: number;
}

export interface ApiKey {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    enabled: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    uploadCount: number;
    revokedAt: string | null;
    secret?: string;
}

export interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
}

export interface Meta {
    siteName: string;
    siteDescription: string;
    announcement: string;
    allowRegister: boolean;
    guestUpload: boolean;
    maxUploadMb: number;
    storageDriver: string;
    authMode: string;
    providers: { github: boolean; google: boolean; password: boolean };
    totals: { files: number; bytes: number };
    version: string;
}

export interface Overview {
    totals: { files: number; bytes: number; bytesHuman: string; views: number; downloads: number };
    quota: { used: number; limit: number; percent: number | null };
    timeline: { day: string; count: number; bytes: number }[];
    top: { id: string; name: string; ext: string; views: number; size: number; thumbKey: string | null }[];
    byFormat: { ext: string; count: number; bytes: number }[];
    recentAccess: {
        id: string;
        kind: string;
        ip: string | null;
        referer: string | null;
        createdAt: string;
        fileId: string | null
    }[];
    recentActivity: { id: string; action: string; target: string | null; createdAt: string }[];
}

export interface PublicShare {
    token: string;
    title: string;
    kind: string;
    hasPassword: boolean;
    allowDownload: boolean;
    expiresAt: string | null;
    createdAt: string;
    locked: boolean;
    items: ImageFile[];
    totalBytes?: number;
    totalHuman?: string;
}
