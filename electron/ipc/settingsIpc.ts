import { ipcMain } from "electron";
import type { SenderValidator } from "./validateSender";
import { getPlanningHours, updatePlanningHours } from "../services/settingsService";

export function registerSettingsIpc(validateSender: SenderValidator) {
    ipcMain.handle("settings:planning-hours", (event) => { validateSender(event); return getPlanningHours(); });
    ipcMain.handle("settings:update-planning-hours", (event, input: unknown) => { validateSender(event); return updatePlanningHours(input); });
}
