import { Temporal } from "@js-temporal/polyfill";
import type { ScheduledOccurrence, Task, TaskOccurrence } from "../types/task";
import { generateOccurrenceTimes, occurrenceEndAt } from "./recurrence";

export type ScheduleDefinition = Pick<Task, "id" | "scheduleType" | "scheduledStartAt" | "scheduledEndAt" | "recurrenceRule" | "scheduleEffectiveAt"> & {
    excludedOccurrences?: { scheduledStartAt: number; scheduledEndAt: number }[];
};

export function isExcluded(task: Pick<ScheduleDefinition, "excludedOccurrences">, start: number, end: number): boolean {
    return task.excludedOccurrences?.some((range) => range.scheduledStartAt === start && range.scheduledEndAt === end) ?? false;
}

function localDate(timestamp: number, timeZone: string) {
    return Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(timeZone).toPlainDate();
}

function midnight(date: Temporal.PlainDate, timeZone: string) {
    return date.toZonedDateTime(timeZone).epochMilliseconds;
}

export function dayKey(timestamp: number, timeZone: string): string {
    return localDate(timestamp, timeZone).toString();
}

export function weekRange(timestamp: number, timeZone: string) {
    const date = localDate(timestamp, timeZone);
    const monday = date.subtract({ days: date.dayOfWeek - 1 });
    return { from: midnight(monday, timeZone), to: midnight(monday.add({ days: 7 }), timeZone) };
}

export function shiftWeek(timestamp: number, direction: number, timeZone: string): number {
    return midnight(localDate(timestamp, timeZone).add({ weeks: direction }), timeZone);
}

export function weekDays(from: number, timeZone: string) {
    const monday = localDate(from, timeZone);
    return Array.from({ length: 7 }, (_, index) => {
        const date = monday.add({ days: index });
        return { date: date.toString(), at: midnight(date, timeZone) };
    });
}

/** Half-open bounds. Pure projection: never writes rows or changes a cursor. */
export function expectedTimes(task: ScheduleDefinition, from: number, to: number): number[] {
    const start = Math.max(from, task.scheduleEffectiveAt);
    if (start >= to) return [];
    if (task.scheduleType === "one-time") return task.scheduledStartAt >= start && task.scheduledStartAt < to ? [task.scheduledStartAt] : [];
    return task.recurrenceRule ? generateOccurrenceTimes(task.recurrenceRule, start, to - 1)
        .filter((at) => !isExcluded(task, at, occurrenceEndAt(task, at))) : [];
}

export function deriveOccurrences(task: ScheduleDefinition, from: number, to: number, records: TaskOccurrence[]): ScheduledOccurrence[] {
    const byTime = new Map<number, ScheduledOccurrence>();
    for (const scheduledStartAt of expectedTimes(task, from, to)) byTime.set(scheduledStartAt, { taskId: task.id, scheduledStartAt, scheduledEndAt: occurrenceEndAt(task, scheduledStartAt), record: null });
    for (const record of records) {
        // History supplies state for current-rule cards, never extra cards of its own.
        if (record.taskId === task.id && byTime.get(record.scheduledStartAt)?.scheduledEndAt === record.scheduledEndAt) {
            byTime.set(record.scheduledStartAt, { taskId: task.id, scheduledStartAt: record.scheduledStartAt, scheduledEndAt: record.scheduledEndAt, record });
        }
    }
    return [...byTime.values()].sort((left, right) => left.scheduledStartAt - right.scheduledStartAt);
}
