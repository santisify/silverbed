import {http} from "./client";
import type {
    ApiKey,
    Folder,
    FolderNode,
    GalleryBatchResult,
    GalleryFolderPick,
    GalleryItem,
    GalleryOwnerCount,
    ImageFile,
    Meta,
    Overview,
    Paginated,
    PublicShare,
    Share,
    Tag,
    UploadedFile,
    UploadTicket,
    User,
} from "./types";

export const authApi = {
    me: () => http.get<{ user: User; token: string; mode: string }>("/auth/me"),
    login: (username: string, password: string) => http.post<{
        token: string
        refreshToken?: string | null
        user: User
    }>("/auth/login", { username, password }),
    register: (username: string, password: string, email?: string) =>
      http.post<{ token?: string; user?: User; pendingConfirmation?: boolean; message?: string }>(
        "/auth/register", { username, password, email }),
    providers: () => http.get<{
        github: boolean
        google: boolean
        supabase: boolean
        supabaseLogin: boolean
        loginWithEmail: boolean
        mode: string
    }>("/auth/providers"),
    updateProfile: (body: { email?: string; defaultAccess?: string }) => http.patch<{
        updated: boolean
    }>("/auth/profile", body),
    changePassword: (current: string, next: string) => http.patch<{ updated: boolean }>("/auth/password", {
        current,
        next
    }),
};

export const setupApi = {
    status: () => http.get<{
        installed: boolean;
        siteName: string;
        siteDescription: string;
        allowRegister: boolean;
        guestUpload: boolean
    }>("/setup/status"),
    install: (body: {
        username: string;
        password: string;
        email?: string;
        siteName?: string;
        siteDescription?: string
    }) =>
      http.post<{ token: string; user: User }>("/setup/install", body),
};

export const metaApi = {
    get: () => http.get<Meta>("/meta"),
};

export const filesApi = {
    list: (params: Record<string, string | number | undefined>) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
        return http.get<Paginated<ImageFile>>(`/files?${qs.toString()}`);
    },
    get: (id: string) => http.get<ImageFile>(`/files/${id}`),
    upload: (form: FormData) => http.post<{ files: UploadedFile[]; deduplicated: number }>("/files/upload", form),
    /** Presigned PUT so large files bypass the function body limit. */
    signUpload: (body: { name: string; size: number; folderId?: string | null; accessLevel?: string }) =>
      http.post<UploadTicket>("/uploads/sign", body),
    /** Registers an object the browser already pushed to the bucket. */
    importUpload: (body: {
        id: string;
        key: string;
        name: string;
        folderId?: string | null;
        accessLevel?: string;
        description?: string;
        tags?: string;
        expiresInDays?: number
    }) => http.post<UploadedFile>("/files/import", body),
    update: (id: string, body: Partial<{
        name: string;
        description: string;
        accessLevel: string;
        folderId: string | null;
        tags: string[]
    }>) =>
      http.patch<ImageFile>(`/files/${id}`, body),
    remove: (id: string) => http.del<{ deleted: boolean }>(`/files/${id}`),
    restore: (id: string) => http.post<{ restored: boolean }>(`/files/${id}/restore`),
    batch: (action: string, ids: string[], value?: string) => http.post<{ affected: number }>("/files/batch", {
        action,
        ids,
        value
    }),
    stats: () => http.get<{
        files: number;
        bytes: number;
        bytesHuman: string;
        views: number;
        downloads: number;
        formats: { ext: string; count: number; bytes: number }[];
        quota: number
    }>("/files/stats"),
};

/** The shared "all images" sheet. Listing is public; management is scoped server-side. */
export const galleryApi = {
    list: (params: Record<string, string | number | undefined>) => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
        return http.get<Paginated<GalleryItem>>(`/gallery?${qs.toString()}`);
    },
    batch: (action: string, ids: string[], value?: string) =>
      http.post<GalleryBatchResult>("/gallery/batch", {action, ids, value}),
    owners: () => http.get<GalleryOwnerCount[]>("/gallery/owners"),
    ownerFolders: (id: string) => http.get<GalleryFolderPick[]>(`/gallery/owners/${id}/folders`),
};

export const foldersApi = {
    list: () => http.get<{ folders: Folder[]; tree: FolderNode[]; rootFileCount: number }>("/folders"),
    create: (body: {
        name: string;
        parentId?: string | null;
        accessLevel?: string
    }) => http.post<Folder>("/folders", body),
    update: (id: string, body: { name?: string; parentId?: string | null; accessLevel?: string }) => http.patch<{
        updated: boolean
    }>(`/folders/${id}`, body),
    remove: (id: string) => http.del<{ deleted: boolean }>(`/folders/${id}`),
};

export const tagsApi = {
    list: () => http.get<Tag[]>("/tags"),
    create: (name: string, color?: string) => http.post<Tag>("/tags", {name, color}),
    remove: (id: string) => http.del<{ deleted: boolean }>(`/tags/${id}`),
};

export const sharesApi = {
    list: () => http.get<Share[]>("/shares"),
    get: (id: string) => http.get<Share & { items: ImageFile[] }>(`/shares/${id}`),
    create: (body: {
        title?: string;
        fileIds: string[];
        password?: string;
        expiresInDays?: number;
        allowDownload?: boolean
    }) => http.post<Share>("/shares", body),
    update: (id: string, body: {
        title?: string;
        password?: string | null;
        revoked?: boolean;
        allowDownload?: boolean
    }) => http.patch<{ updated: boolean }>(`/shares/${id}`, body),
    remove: (id: string) => http.del<{ deleted: boolean }>(`/shares/${id}`),
    public: (token: string, password?: string) => http.get<PublicShare>(`/public/shares/${token}${password ? `?t=${encodeURIComponent(password)}` : ""}`),
    unlock: (token: string, password: string) => http.post<{
        accessToken: string
    }>(`/public/shares/${token}/unlock`, {password}),
};

export const keysApi = {
    list: () => http.get<ApiKey[]>("/keys"),
    create: (name: string, scopes?: string[]) => http.post<ApiKey>("/keys", {name, scopes}),
    update: (id: string, body: { name?: string; enabled?: boolean }) => http.patch<{
        updated: boolean
    }>(`/keys/${id}`, body),
    remove: (id: string) => http.del<{ deleted: boolean }>(`/keys/${id}`),
};

export const statsApi = {
    overview: () => http.get<Overview>("/stats/overview"),
};

export interface AdminOverview {
    totals: {
        files: number;
        bytes: number;
        bytesHuman: string;
        views: number;
        trashed: number;
        users: number;
        disabledUsers: number;
        shares: number;
        shareViews: number;
        accessEvents: number;
    };
    system: {
        storageDriver: string;
        database: string;
        authMode: string;
        smtp: boolean;
        publicBaseUrl: string;
        uptimeSeconds: number;
        runtime: string;
        memoryMb: number;
    };
    timeline: { day: string; uploads: number; bytes: number }[];
    topUploaders: { id: string; username: string; files: number; bytes: number }[];
    recentActivity: {
        id: string;
        action: string;
        username: string | null;
        target: string | null;
        ip: string | null;
        createdAt: string
    }[];
}

export const adminApi = {
    overview: () => http.get<AdminOverview>("/admin/overview"),
    users: (params: { page?: number; q?: string } = {}) => {
        const qs = new URLSearchParams();
        if (params.page) qs.set("page", String(params.page));
        if (params.q) qs.set("q", params.q);
        return http.get<Paginated<User>>(`/admin/users?${qs.toString()}`);
    },
    createUser: (body: {
        username: string;
        password: string;
        email?: string;
        role?: string;
        storageQuota?: number
    }) => http.post<User>("/admin/users", body),
    updateUser: (id: string, body: {
        role?: string;
        status?: string;
        storageQuota?: number;
        password?: string;
        email?: string
    }) =>
      http.patch<{ updated: boolean }>(`/admin/users/${id}`, body),
    deleteUser: (id: string) => http.del<{ deleted: boolean }>(`/admin/users/${id}`),
    settings: () => http.get<Record<string, string>>("/admin/settings"),
    updateSettings: (body: Record<string, string | number | boolean>) => http.patch<Record<string, string>>("/admin/settings", body),
    activity: (page = 1) => http.get<Paginated<{
        id: string;
        action: string;
        username: string | null;
        target: string | null;
        detail: string | null;
        ip: string | null;
        createdAt: string
    }>>(`/admin/activity?page=${page}`),
    mail: () => http.get<{
        id: string;
        to: string;
        subject: string;
        body: string;
        transport: string;
        error: string | null;
        createdAt: string
    }[]>("/admin/mail"),
    testMail: (to: string) => http.post<{ delivered: boolean; transport: string }>("/admin/mail/test", {to}),
    purgeTrash: () => http.post<{ purged: number }>("/maintenance/purge-trash"),
    expire: () => http.post<{ expired: number }>("/maintenance/expire"),
};

export * from "./types";
export {ApiError, tokenStore} from "./client";
