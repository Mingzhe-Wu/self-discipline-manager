import { DEFAULT_USER_SETTINGS } from "../../shared/types/settings";
import type { LocalPreferences, LocalProfile, PlanningHours, UserSettings } from "../../shared/types/settings";
import { validatePlanningHours } from "../../shared/scheduling/planningHours";
import * as repository from "../db/settingsRepository";

function ensure() {
    if (!repository.getSettings() || !repository.getProfile()) repository.ensureDefaults(Date.now());
}
export function getUserSettings(): UserSettings {
    ensure();
    const { wakeTime, sleepTime, defaultTaskDurationMinutes, weekStartsOn, notificationsEnabled, trayMiniEnabled, closeToTray } = repository.getSettings()!;
    return { wakeTime, sleepTime, defaultTaskDurationMinutes, weekStartsOn, notificationsEnabled, trayMiniEnabled, closeToTray };
}
export function getLocalPreferences(): LocalPreferences {
    return { settings: getUserSettings(), profile: repository.getProfile()! };
}
function validateProfile(input: unknown): string {
    if (!input || typeof input !== "object" || !("displayName" in input) || typeof input.displayName !== "string" || !input.displayName.trim() || input.displayName.trim().length > 80) throw new Error("Enter a display name of 1–80 characters");
    return input.displayName.trim();
}
export function updateProfile(input: unknown): LocalProfile {
    const displayName = validateProfile(input);
    ensure();
    return repository.saveProfile(displayName, Date.now());
}
function validateSettings(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid settings");
    for (const key of Object.keys(input)) if (!Object.hasOwn(DEFAULT_USER_SETTINGS, key)) throw new Error(`Unknown setting: ${key}`);
    const current = getUserSettings(), next = { ...current, ...input };
    validatePlanningHours(next);
    if (!Number.isSafeInteger(next.defaultTaskDurationMinutes) || next.defaultTaskDurationMinutes < 5 || next.defaultTaskDurationMinutes > 1435 || next.defaultTaskDurationMinutes % 5) throw new Error("Default duration must be 5–1435 minutes in five-minute steps");
    if (next.weekStartsOn !== 0 && next.weekStartsOn !== 1) throw new Error("Choose Monday or Sunday");
    for (const key of ["notificationsEnabled", "trayMiniEnabled", "closeToTray"] as const) if (typeof next[key] !== "boolean") throw new Error(`${key} must be a boolean`);
    const resumeAt = !current.notificationsEnabled && next.notificationsEnabled ? Date.now() : repository.getSettings()!.notificationsResumeAt;
    return { next, resumeAt };
}
export function updateUserSettings(input: unknown): UserSettings {
    const { next, resumeAt } = validateSettings(input);
    repository.saveSettings(next, resumeAt);
    return getUserSettings();
}
export function updateLocalPreferences(input: unknown): LocalPreferences {
    const displayName = validateProfile(input);
    if (!input || typeof input !== "object" || !("settings" in input)) throw new Error("Invalid settings");
    const { next, resumeAt } = validateSettings(input.settings);
    repository.savePreferences(displayName, next, resumeAt, Date.now());
    return getLocalPreferences();
}
/** Re-enable only future slots, without changing per-task preferences or delivery records. */
export function notificationsAllowedForSlot(targetAt: number): boolean {
    const settings = getUserSettings();
    return settings.notificationsEnabled && targetAt >= repository.getSettings()!.notificationsResumeAt;
}
/** Compatibility facade backed by the same centralized row. */
export function getPlanningHours(): PlanningHours {
    const { wakeTime, sleepTime } = getUserSettings(); return { wakeTime, sleepTime };
}
export function updatePlanningHours(input: unknown): PlanningHours {
    const hours = validatePlanningHours(input); updateUserSettings(hours); return hours;
}
