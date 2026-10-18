import { Notification } from "electron";
import { getDueReminders, markReminderAsNotified } from "../services/reminderService";

let timer: NodeJS.Timeout | null = null;
// Retain notifications until the OS acknowledges them; skip them on later ticks.
const pending = new Map<number, Notification>();

export function startReminderScheduler() {
    if (timer) {
        return;
    }

    timer = setInterval(() => {
        checkReminders();
    }, 60_000);
    checkReminders();
}

export function stopReminderScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const notification of pending.values()) {
        notification.removeAllListeners();
        notification.close();
    }
    pending.clear();
}

function checkReminders() {
    try {
        if (!Notification.isSupported()) return;
        for (const reminder of getDueReminders()) {
            if (pending.has(reminder.id)) continue;
            try {
                const notification = new Notification({
                    title: "Self Discipline Manager",
                    body: reminder.title,
                });
                pending.set(reminder.id, notification);
                notification.once("show", () => {
                    try {
                        markReminderAsNotified(reminder.id);
                    } catch (error) {
                        console.error("Failed to record reminder notification", error);
                    } finally {
                        notification.removeAllListeners();
                        pending.delete(reminder.id);
                    }
                });
                notification.once("failed", (_event, error) => {
                    notification.removeAllListeners();
                    pending.delete(reminder.id);
                    console.error("Reminder notification failed", error);
                });
                notification.show();
            } catch (error) {
                pending.get(reminder.id)?.removeAllListeners();
                pending.delete(reminder.id);
                console.error("Failed to show reminder notification", error);
            }
        }
    } catch (error) {
        console.error("Failed to check reminders", error);
    }
}
