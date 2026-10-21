import { Notification } from "electron";
import { abandonReminder, claimReminder, getDueReminders, isReminderRelevant, markReminderFailed, markReminderSent,
    recoverInterruptedReminders, type DueReminder } from "../services/reminderService";
import { SCHEDULER_POLL_MS } from "../services/reminderPolicy";
let timer: NodeJS.Timeout | null = null;
const pending = new Map<string, { notification: Notification; reminder: DueReminder }>();
export function startTaskScheduler() {
    if (timer) return;
    recoverInterruptedReminders();
    timer = setInterval(checkOccurrences, SCHEDULER_POLL_MS);
    checkOccurrences();
}
export function stopTaskScheduler() {
    if (timer) clearInterval(timer);
    timer = null;
    for (const { notification } of pending.values()) { notification.removeAllListeners(); notification.close(); }
    pending.clear();
}
function checkOccurrences() {
    try {
        for (const [key, { notification, reminder }] of pending) {
            if (!isReminderRelevant(reminder)) {
                abandonReminder(reminder);
                notification.removeAllListeners(); notification.close(); pending.delete(key);
            }
        }
        if (!Notification.isSupported()) return;
        for (const reminder of getDueReminders()) {
            const key = `${reminder.occurrenceId}:${reminder.slot}`;
            if (pending.has(key) || !claimReminder(reminder)) continue;
            try {
                const notification = new Notification({ title: "Self Discipline Manager",
                    body: reminder.slot === -5 ? `Upcoming in 5 minutes: ${reminder.title}` : `Time to start: ${reminder.title}` });
                pending.set(key, { notification, reminder });
                const finish = (success: boolean) => {
                    if (pending.get(key)?.notification !== notification) return;
                    try { if (success) markReminderSent(reminder); else markReminderFailed(reminder); }
                    catch (error) { console.error("Failed to record task notification", error); }
                    finally { notification.removeAllListeners(); pending.delete(key); }
                };
                notification.once("show", () => finish(true));
                notification.once("failed", (_event, error) => { console.error("Task notification failed", error); finish(false); });
                notification.show();
            } catch (error) {
                pending.get(key)?.notification.removeAllListeners(); pending.delete(key);
                markReminderFailed(reminder);
                console.error("Failed to show task notification", error);
            }
        }
    } catch (error) { console.error("Failed to check task occurrences", error); }
}
