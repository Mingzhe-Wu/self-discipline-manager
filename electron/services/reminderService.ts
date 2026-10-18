import type { CreateReminderInput, Reminder } from "../../shared/types/reminder";
import * as repository from "../db/reminderRepository";

export function getAllReminders(): Reminder[] {
    return repository.getAllReminders();
}

export function createReminder(input: CreateReminderInput): Reminder {
    if (!input || typeof input.title !== "string" || !input.title.trim()) {
        throw new Error("Reminder title cannot be empty");
    }
    if (!Number.isSafeInteger(input.dueAt) || !Number.isFinite(new Date(input.dueAt).getTime())) {
        throw new Error("Reminder time must be a valid timestamp");
    }
    // Past times are allowed: overdue reminders are delivered on the next check.
    return repository.createReminder(input.title.trim(), input.dueAt, Date.now());
}

export function deleteReminder(id: number): void {
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid reminder ID");
    }
    repository.deleteReminder(id);
}

export function getDueReminders(now: number = Date.now()): Reminder[] {
    return repository.findDueReminders(now);
}

export function markReminderAsNotified(id: number): void {
    repository.markReminderAsNotified(id);
}
