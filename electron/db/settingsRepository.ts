import { eq } from "drizzle-orm";
import type { UserSettings } from "../../shared/types/settings";
import { getDatabase } from "./database";
import { localProfilesTable, userSettingsTable } from "./schema";

export function ensureDefaults(now: number): void {
    const db = getDatabase();
    db.insert(userSettingsTable).values({ id: 1 }).onConflictDoNothing().run();
    db.insert(localProfilesTable).values({ id: 1, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
}
export function getSettings() { return getDatabase().select().from(userSettingsTable).where(eq(userSettingsTable.id, 1)).get(); }
export function getProfile() { return getDatabase().select().from(localProfilesTable).where(eq(localProfilesTable.id, 1)).get(); }
export function saveSettings(settings: UserSettings, notificationsResumeAt: number): void {
    getDatabase().update(userSettingsTable).set({ ...settings, notificationsResumeAt }).where(eq(userSettingsTable.id, 1)).run();
}
export function saveProfile(displayName: string, now: number) {
    return getDatabase().update(localProfilesTable).set({ displayName, updatedAt: now }).where(eq(localProfilesTable.id, 1)).returning().get();
}

export function savePreferences(displayName: string, settings: UserSettings, notificationsResumeAt: number, now: number) {
    getDatabase().transaction(() => {
        saveProfile(displayName, now);
        saveSettings(settings, notificationsResumeAt);
    });
}
