import { Temporal } from "@js-temporal/polyfill";
import type { PlanningHours } from "../types/settings";

export const DEFAULT_PLANNING_HOURS: Readonly<PlanningHours> = Object.freeze({ wakeTime: "00:00", sleepTime: "24:00" });

function clockMinutes(value: unknown, allowMidnightEnd: boolean): number {
    if (allowMidnightEnd && value === "24:00") return 1440;
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value) || Number(value.slice(3)) % 5) {
        throw new Error("Planning hours must use five-minute increments (HH:mm)");
    }
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

export function validatePlanningHours(value: unknown): PlanningHours {
    if (!value || typeof value !== "object" || !("wakeTime" in value) || !("sleepTime" in value)) throw new Error("Invalid planning hours");
    const wake = clockMinutes(value.wakeTime, false);
    const sleep = clockMinutes(value.sleepTime, true);
    if (sleep <= wake) throw new Error("Sleep time must be later than wake time on the same day");
    return { wakeTime: value.wakeTime as string, sleepTime: value.sleepTime as string };
}

/** Planned wall times use each task's saved zone, regardless of the viewer's zone.
 * This validator never processes, rounds, or rewrites recorded actual history. */
export function assertPlanningRange(start: number, end: number, timeZone: string, hours: PlanningHours): void {
    const a = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
    const b = Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(timeZone);
    if (a.minute % 5 || b.minute % 5 || a.second || b.second || a.millisecond || b.millisecond) throw new Error("Planned times must use five-minute increments");
    assertPlanningBounds(start, end, timeZone, hours);
}

/** Validate positive same-day ranges. Wake/Sleep are display preferences only. */
export function assertPlanningBounds(start: number, end: number, timeZone: string, hours: PlanningHours): void {
    validatePlanningHours(hours);
    const a = Temporal.Instant.fromEpochMilliseconds(start).toZonedDateTimeISO(timeZone);
    const b = Temporal.Instant.fromEpochMilliseconds(end).toZonedDateTimeISO(timeZone);
    const endAtMidnight = b.hour === 0 && b.minute === 0 && b.second === 0 && b.millisecond === 0 && b.toPlainDate().equals(a.toPlainDate().add({ days: 1 }));
    const startMinute = a.hour * 60 + a.minute + a.second / 60 + a.millisecond / 60000;
    const endMinute = endAtMidnight ? 1440 : b.hour * 60 + b.minute + b.second / 60 + b.millisecond / 60000;
    if (end <= start || (!a.toPlainDate().equals(b.toPlainDate()) && !endAtMidnight) || endMinute <= startMinute) {
        throw new Error("Planned range must end later within the same planning day");
    }
}
