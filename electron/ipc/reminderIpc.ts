import { ipcMain } from "electron";
import type { SenderValidator } from "./validateSender";
import type { CreateReminderInput } from "../../shared/types/reminder";
import { createReminder, deleteReminder, getAllReminders } from "../services/reminderService";

export function registerReminderIpc(validateSender: SenderValidator) {
    ipcMain.handle("reminder:list", (event) => {
        validateSender(event);
        return getAllReminders();
    });
    ipcMain.handle("reminder:create", (event, input: CreateReminderInput) => {
        validateSender(event);
        return createReminder(input);
    });
    ipcMain.handle("reminder:delete", (event, id: number) => {
        validateSender(event);
        deleteReminder(id);
    });
}
