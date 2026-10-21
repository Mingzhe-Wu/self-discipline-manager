import { Temporal } from "@js-temporal/polyfill";
import type { RecurrenceRule } from "../types/task";

export function validateRecurrence(rule: RecurrenceRule): RecurrenceRule {
    try {
        if (!rule || !["daily", "weekly"].includes(rule.frequency) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate) || !/^\d{2}:\d{2}$/.test(rule.startTime)) {
            throw new Error("Invalid recurrence schedule");
        }
        const date = Temporal.PlainDate.from(rule.startDate);
        if (date.year < 1970) throw new Error("Schedule start must be in 1970 or later");
        validatePlannedClockRange(rule.startTime, rule.endTime);
        Temporal.Now.zonedDateTimeISO(rule.timeZone);
        if (!Array.isArray(rule.weekdays) || rule.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
            throw new Error("Invalid weekdays");
        }
        if (rule.frequency === "weekly" && rule.weekdays.length === 0) throw new Error("Select at least one weekday");
        return { frequency: rule.frequency, startDate: rule.startDate, startTime: rule.startTime, endTime: rule.endTime, timeZone: rule.timeZone,
            weekdays: rule.frequency === "daily" ? [] : [...new Set(rule.weekdays)].sort() };
    } catch (error) {
        throw new Error(`Invalid recurrence schedule/time zone/weekday: ${error instanceof Error ? error.message : "invalid input"}`, { cause: error });
    }
}

export function atLocalDate(date: Temporal.PlainDate, rule: RecurrenceRule): number {
    return date.toPlainDateTime(Temporal.PlainTime.from(rule.startTime))
        .toZonedDateTime(rule.timeZone, { disambiguation: "compatible" }).epochMilliseconds;
}

export function firstOccurrenceAt(rule: RecurrenceRule): number {
    let date = Temporal.PlainDate.from(rule.startDate);
    while (rule.frequency === "weekly" && !rule.weekdays.includes(date.dayOfWeek % 7)) date = date.add({ days: 1 });
    return atLocalDate(date, rule);
}

/** Increment by calendar dates, never by 24-hour durations. Inclusive bounds. */
export function generateOccurrenceTimes(rule: RecurrenceRule, from: number, through: number): number[] {
    if (from > through) return [];
    const anchor = Temporal.PlainDate.from(rule.startDate);
    let date = Temporal.Instant.fromEpochMilliseconds(from).toZonedDateTimeISO(rule.timeZone).toPlainDate();
    if (Temporal.PlainDate.compare(date, anchor) < 0) date = anchor;
    const end = Temporal.Instant.fromEpochMilliseconds(through).toZonedDateTimeISO(rule.timeZone).toPlainDate();
    const times: number[] = [];
    for (; Temporal.PlainDate.compare(date, end) <= 0; date = date.add({ days: 1 })) {
        if (rule.frequency === "weekly" && !rule.weekdays.includes(date.dayOfWeek % 7)) continue;
        const timestamp = atLocalDate(date, rule);
        if (timestamp >= from && timestamp <= through) times.push(timestamp);
    }
    return times;
}

export function localDateAt(timestamp: number, timeZone: string): string {
    return Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

export function localDayRange(timestamp: number, timeZone: string) {
    const start = Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(timeZone).startOfDay();
    return { from: start.epochMilliseconds, to: start.add({ days: 1 }).epochMilliseconds };
}

/** New planned inputs only. Imported historical schedules are never rounded. */
export function validatePlannedClockRange(startTime: string, endTime: string): void {
    const aligned = (value: string) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) && Number(value.slice(3)) % 5 === 0;
    if (!aligned(startTime) || !aligned(endTime)) throw new Error("Planned times must use five-minute increments");
    if (endTime <= startTime) throw new Error("Planned end must be later than start within the same day; cross-midnight ranges are not supported");
}

export function occurrenceEndAt(task: { scheduleType: "one-time" | "recurring"; scheduledEndAt: number; recurrenceRule: RecurrenceRule | null }, scheduledStartAt: number): number {
    if (task.scheduleType === "one-time") return task.scheduledEndAt;
    if (!task.recurrenceRule) throw new Error("Missing recurrence range");
    const rule = task.recurrenceRule;
    const date = Temporal.Instant.fromEpochMilliseconds(scheduledStartAt).toZonedDateTimeISO(rule.timeZone).toPlainDate();
    const requestedStart = date.toPlainDateTime(Temporal.PlainTime.from(rule.startTime));
    const resolvedStart = requestedStart.toZonedDateTime(rule.timeZone, { disambiguation: "compatible" });
    // A spring gap shifts the whole planned range, preserving positive wall-clock length.
    const gap = resolvedStart.toPlainDateTime().since(requestedStart).total("milliseconds");
    const end = date.toPlainDateTime(Temporal.PlainTime.from(rule.endTime)).add({ milliseconds: gap })
        .toZonedDateTime(rule.timeZone, { disambiguation: "compatible" });
    if (end.epochMilliseconds <= scheduledStartAt || !end.toPlainDate().equals(date)) throw new Error("Planned recurrence range must end later on the same calendar day");
    return end.epochMilliseconds;
}

export function validatePlannedInstants(start: number, end: number, timeZone: string): void {
    const a = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
    const b = Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(timeZone);
    if (a.minute % 5 || b.minute % 5 || a.second || b.second || a.millisecond || b.millisecond) throw new Error("Planned times must use five-minute increments");
    if (end <= start || !a.toPlainDate().equals(b.toPlainDate()) || Temporal.PlainTime.compare(b.toPlainTime(), a.toPlainTime()) <= 0) throw new Error("Planned end must be later than start within the same day; cross-midnight ranges are not supported");
}
