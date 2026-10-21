import * as repository from "../db/reminderSlotRepository";
import * as taskRepository from "../db/taskRepository";
import { occurrenceEndAt } from "../../shared/scheduling/recurrence";
import { expectedTimes } from "../../shared/scheduling/week";
import { getAllTasks } from "./taskService";
import { reminderSlotAt } from "./reminderPolicy";
import { getUserSettings, notificationsAllowedForSlot } from "./settingsService";
export type DueReminder = { occurrenceId: number; taskId: number; scheduledStartAt: number; title: string; slot: number };
export function getDueReminders(): DueReminder[] {
    if (!getUserSettings().notificationsEnabled) return [];
    getAllTasks();
    const now = Date.now();
    return repository.findCandidates(now).flatMap(({ occurrence, task }) => {
        task = taskRepository.getTask(task.id)!;
        const slot = reminderSlotAt(occurrence.scheduledStartAt, now);
        if (slot !== null && !notificationsAllowedForSlot(occurrence.scheduledStartAt + slot * 60_000)) return [];
        if (now > occurrence.scheduledEndAt || slot === null || (expectedTimes(task, occurrence.scheduledStartAt, occurrence.scheduledStartAt + 1).length !== 1 || occurrenceEndAt(task, occurrence.scheduledStartAt) !== occurrence.scheduledEndAt)) return [];
        const state = repository.getSlot(occurrence.id, slot)?.state;
        return state && state !== "failed" ? [] : [{ occurrenceId: occurrence.id, taskId: task.id,
            scheduledStartAt: occurrence.scheduledStartAt, title: task.title, slot }];
    });
}
export function isReminderRelevant(reminder: DueReminder): boolean {
    const task = taskRepository.getTask(reminder.taskId);
    const occurrence = taskRepository.getOccurrence(reminder.taskId, reminder.occurrenceId);
    return !!task && task.enabled && !!occurrence && occurrence.startedAt === null && occurrence.endedAt === null &&
        !occurrence.legacyCompleted && !occurrence.remindersSuppressed && notificationsAllowedForSlot(occurrence.scheduledStartAt + reminder.slot * 60_000) && Date.now() <= occurrence.scheduledEndAt && reminderSlotAt(occurrence.scheduledStartAt, Date.now()) === reminder.slot &&
        expectedTimes(task, occurrence.scheduledStartAt, occurrence.scheduledStartAt + 1).length === 1 && occurrenceEndAt(task, occurrence.scheduledStartAt) === occurrence.scheduledEndAt;
}
export function claimReminder(reminder: DueReminder): boolean {
    return isReminderRelevant(reminder) && repository.claimSlot(reminder.occurrenceId, reminder.slot, Date.now());
}
export function markReminderSent(reminder: DueReminder) { repository.finishSlot(reminder.occurrenceId, reminder.slot, "sent", Date.now()); }
export function markReminderFailed(reminder: DueReminder) { repository.finishSlot(reminder.occurrenceId, reminder.slot, "failed", Date.now()); }
export function abandonReminder(reminder: DueReminder) { repository.finishSlot(reminder.occurrenceId, reminder.slot, "unknown", Date.now()); }
export function recoverInterruptedReminders() { repository.recoverInterruptedSlots(); }
