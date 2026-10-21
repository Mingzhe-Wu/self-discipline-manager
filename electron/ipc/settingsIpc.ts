import { ipcMain } from "electron";
import type { SenderValidator } from "./validateSender";
import { updateLocalPreferences, getLocalPreferences, updateProfile, updateUserSettings, getPlanningHours, updatePlanningHours } from "../services/settingsService";

export function registerSettingsIpc(validateSender: SenderValidator) {
    ipcMain.handle("settings:update-local-preferences", (event, input: unknown) => { validateSender(event); return updateLocalPreferences(input); });
    ipcMain.handle("settings:local-preferences", event => { validateSender(event); return getLocalPreferences(); });
    ipcMain.handle("settings:update-profile", (event, input: unknown) => { validateSender(event); return updateProfile(input); });
    ipcMain.handle("settings:update", (event, input: unknown) => { validateSender(event); return updateUserSettings(input); });
    ipcMain.handle("settings:planning-hours", (event) => { validateSender(event); return getPlanningHours(); });
    ipcMain.handle("settings:update-planning-hours", (event, input: unknown) => { validateSender(event); return updatePlanningHours(input); });
}
