import type { RecurrenceRule } from "../../shared/types/task";
import { atLocalDate, occurrenceEndAt } from "../../shared/scheduling/recurrence";
import { Temporal } from "@js-temporal/polyfill";

/** Used only by migration0005: never round an existing planned or actual timestamp. */
export function legacyPlannedEnd(start: number, timeZone: string): number {
    const nextDay = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone).startOfDay().add({ days: 1 }).epochMilliseconds;
    return Math.max(start + 1, Math.min(start + 30 * 60_000, nextDay - 1));
}
export function legacyRecurrenceRange(json: string): string {
    const rule = JSON.parse(json);
    const start = Temporal.PlainTime.from(rule.time);
    const minutes = start.hour * 60 + start.minute;
    const endTime = minutes + 30 >= 1440 ? "23:59:59.999" : start.add({ minutes: 30 }).toString({ smallestUnit: "minute" });
    const rest = { ...rule };
    delete rest.time;
    return JSON.stringify({ ...rest, startTime: rule.time, endTime });
}

export function legacyScheduleEnd(start: number, timeZone: string, json: string | null): number {
    if (!json) return legacyPlannedEnd(start, timeZone);
    const saved = JSON.parse(json);
    const recurrenceRule: RecurrenceRule = saved.startTime ? saved : JSON.parse(legacyRecurrenceRange(json));
    const zoned = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
    const date = zoned.toPlainDate();
    if (atLocalDate(date, recurrenceRule) === start) {
        return occurrenceEndAt({ scheduleType: "recurring", scheduledEndAt: 0, recurrenceRule }, start);
    }
    // Retained history may belong to an older rule. Its original start is the
    // only known plan; never borrow the current rule's clock time for its end.
    const plannedEnd = zoned.toPlainDateTime().add({ minutes: 30 });
    const midnight = date.add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;
    const end = plannedEnd.toZonedDateTime(timeZone, { disambiguation: "compatible" }).epochMilliseconds;
    return Math.max(start + 1, Math.min(end > start ? end : start + 1800000, midnight - 1));
}
