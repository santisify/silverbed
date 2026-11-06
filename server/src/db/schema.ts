import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    username: text("username").notNull(),
    email: text("email"),
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    avatarUrl: text("avatar_url"),
    provider: text("provider").notNull().default("local"),
    externalId: text("external_id"),
    storageQuota: bigint("storage_quota", { mode: "number" }).notNull().default(0),
    storageUsed: bigint("storage_used", { mode: "number" }).notNull().default(0),
    fileCount: bigint("file_count", { mode: "number" }).notNull().default(0),
    defaultAccess: text("default_access").notNull().default("public"),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [
    uniqueIndex("users_username_uq").on(t.username),
    index("users_email_idx").on(t.email),
    index("users_provider_idx").on(t.provider, t.externalId),
  ],
);

export const folders = pgTable(
  "folders",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    userId: text("user_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    accessLevel: text("access_level").notNull().default("private"),
    sortOrder: integer("sort_order").notNull().default(0),
    fileCount: integer("file_count").notNull().default(0),
  },
  (t) => [index("folders_user_idx").on(t.userId), index("folders_parent_idx").on(t.parentId)],
);

export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
    userId: text("user_id").notNull(),
    folderId: text("folder_id"),
    name: text("name").notNull(),
    ext: text("ext").notNull(),
    mime: text("mime").notNull(),
    hash: text("hash").notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    storage: text("storage").notNull().default("local"),
    storageKey: text("storage_key").notNull(),
    thumbKey: text("thumb_key"),
    previewKey: text("preview_key"),
    accessLevel: text("access_level").notNull().default("public"),
    accessKey: text("access_key"),
    status: text("status").notNull().default("active"),
    description: text("description"),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    downloads: bigint("downloads", { mode: "number" }).notNull().default(0),
    expiresAt: ts("expires_at"),
    uploadedVia: text("uploaded_via").notNull().default("web"),
    apiKeyId: text("api_key_id"),
    duplicateOf: text("duplicate_of"),
    aiTags: text("ai_tags"),
    exif: jsonb("exif").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("files_user_idx").on(t.userId),
    index("files_folder_idx").on(t.folderId),
    index("files_hash_idx").on(t.hash),
    index("files_created_idx").on(t.createdAt),
    index("files_status_idx").on(t.status),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("slate"),
    fileCount: integer("file_count").notNull().default(0),
  },
  (t) => [uniqueIndex("tags_user_name_uq").on(t.userId, t.name)],
);

export const fileTags = pgTable(
  "file_tags",
  {
    fileId: text("file_id").notNull(),
    tagId: text("tag_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.fileId, t.tagId] }), index("file_tags_tag_idx").on(t.tagId)],
);

export const shares = pgTable(
  "shares",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    token: text("token").notNull(),
    userId: text("user_id").notNull(),
    title: text("title").notNull().default(""),
    kind: text("kind").notNull().default("files"),
    folderId: text("folder_id"),
    passwordHash: text("password_hash"),
    expiresAt: ts("expires_at"),
    allowDownload: boolean("allow_download").notNull().default(true),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    downloadCount: bigint("download_count", { mode: "number" }).notNull().default(0),
    revoked: boolean("revoked").notNull().default(false),
  },
  (t) => [uniqueIndex("shares_token_uq").on(t.token), index("shares_user_idx").on(t.userId)],
);

export const shareItems = pgTable(
  "share_items",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id").notNull(),
    fileId: text("file_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("share_items_share_idx").on(t.shareId)],
);

export const shareAccessLogs = pgTable(
  "share_access_logs",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    shareId: text("share_id").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    referer: text("referer"),
    unlocked: boolean("unlocked").notNull().default(false),
  },
  (t) => [index("share_logs_share_idx").on(t.shareId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").notNull().default("upload,read"),
    enabled: boolean("enabled").notNull().default(true),
    revokedAt: ts("revoked_at"),
    lastUsedAt: ts("last_used_at"),
    uploadCount: bigint("upload_count", { mode: "number" }).notNull().default(0),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index("api_keys_user_idx").on(t.userId)],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const accessLogs = pgTable(
  "access_logs",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    fileId: text("file_id"),
    userId: text("user_id"),
    kind: text("kind").notNull().default("view"),
    ip: text("ip"),
    referer: text("referer"),
    userAgent: text("user_agent"),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  },
  (t) => [index("access_logs_file_idx").on(t.fileId), index("access_logs_time_idx").on(t.createdAt)],
);

export const activityLogs = pgTable(
  "activity_logs",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    userId: text("user_id"),
    username: text("username"),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
    ip: text("ip"),
  },
  (t) => [index("activity_time_idx").on(t.createdAt)],
);

export const mailLogs = pgTable(
  "mail_logs",
  {
    id: text("id").primaryKey(),
    createdAt: ts("created_at").notNull().defaultNow(),
    to: text("to_addr").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    transport: text("transport").notNull().default("console"),
    error: text("error"),
  },
  (t) => [index("mail_logs_time_idx").on(t.createdAt)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  createdAt: ts("created_at").notNull().defaultNow(),
  provider: text("provider").notNull(),
  redirect: text("redirect"),
});
