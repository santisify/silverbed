import { getDb } from "../db";
import { accessLogs, activityLogs } from "../db/schema";
import { newId } from "../lib/ids";

export interface Actor {
  id?: string;
  username?: string;
  ip?: string;
}

export async function logActivity(action: string, actor: Actor, target = "", detail = ""): Promise<void> {
  await getDb().insert(activityLogs).values({
    id: newId(),
    action,
    userId: actor.id ?? null,
    username: actor.username ?? null,
    target,
    detail,
    ip: actor.ip ?? null,
    createdAt: new Date(),
  });
}

export interface AccessInput {
  fileId?: string | null;
  userId?: string | null;
  kind: "view" | "download";
  ip?: string;
  referer?: string;
  userAgent?: string;
  bytes?: number;
}

export async function logAccess(input: AccessInput): Promise<void> {
  await getDb().insert(accessLogs).values({
    id: newId(),
    fileId: input.fileId ?? null,
    userId: input.userId ?? null,
    kind: input.kind,
    ip: input.ip ?? null,
    referer: input.referer ?? null,
    userAgent: input.userAgent ?? null,
    bytes: input.bytes ?? 0,
    createdAt: new Date(),
  });
}
