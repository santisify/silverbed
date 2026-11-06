import { eq, inArray } from "drizzle-orm";
import { getDb } from ".";
import { settings } from "./schema";

export const SETTING_DEFAULTS = {
  site_name: "Silverbed",
  site_description: "Self-hosted image hosting with a contact-sheet workflow.",
  allow_register: "true",
  guest_upload: "false",
  hotlink_protect: "false",
  allowed_domains: "",
  max_upload_mb: "32",
  thumb_size: "520",
  preview_size: "1600",
  watermark_text: "",
  require_api_key: "false",
  announcement: "",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function allSettings(): Promise<Record<SettingKey, string>> {
  const rows = await getDb().select().from(settings);
  const out = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
  for (const row of rows) {
    if (row.key in out) out[row.key as SettingKey] = row.value;
  }
  return out;
}

export async function getSetting(key: SettingKey): Promise<string> {
  const rows = await getDb().select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? SETTING_DEFAULTS[key];
}

export async function getBool(key: SettingKey): Promise<boolean> {
  const v = (await getSetting(key)).toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export async function getInt(key: SettingKey, fallback: number): Promise<number> {
  const n = Number(await getSetting(key));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb()
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function seedSettings(): Promise<void> {
  const existing = await getDb()
    .select({ key: settings.key })
    .from(settings)
    .where(inArray(settings.key, Object.keys(SETTING_DEFAULTS)));
  const have = new Set(existing.map((r) => r.key));
  const missing = Object.entries(SETTING_DEFAULTS)
    .filter(([k]) => !have.has(k))
    .map(([key, value]) => ({ key, value, updatedAt: new Date() }));
  if (missing.length) await getDb().insert(settings).values(missing);
}
