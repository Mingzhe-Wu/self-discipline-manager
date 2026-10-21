import { Temporal } from "@js-temporal/polyfill";
import { occurrenceState } from "../occurrenceLifecycle";
import type { ScheduledOccurrence } from "../types/task";

export type ResizeEdge = "start" | "end";

export function resizeField(occurrence: ScheduledOccurrence, edge: ResizeEdge) {
    const state = occurrenceState(occurrence.record);
    return edge === "start"
        ? state === "planned" ? "scheduledStartAt" : "startedAt"
        : state === "completed" ? "endedAt" : "scheduledEndAt";
}

export function resizeBounds(occurrence: ScheduledOccurrence, edge: ResizeEdge) {
    const field = resizeField(occurrence, edge), record = occurrence.record;
    if (field === "scheduledStartAt") return { min: -Infinity, max: occurrence.scheduledEndAt - 1 };
    if (field === "scheduledEndAt") return { min: Math.max(occurrence.scheduledStartAt + 1, record?.startedAt ?? -Infinity), max: Infinity };
    if (field === "startedAt") return { min: -Infinity, max: record?.endedAt ?? occurrence.scheduledEndAt };
    return { min: record?.startedAt ?? Infinity, max: Infinity };
}

/** Change exactly one lifecycle-dependent endpoint; untouched actual precision survives. */
export function resizeOccurrenceRange(occurrence: ScheduledOccurrence, edge: ResizeEdge, at: number) {
    if (edge !== "start" && edge !== "end") throw new Error("Invalid resize edge");
    const field = resizeField(occurrence, edge), bounds = resizeBounds(occurrence, edge);
    if (!Number.isSafeInteger(at) || at < bounds.min || at > bounds.max) throw new Error("End must be at or after actual start, and planned end must be later than planned start");
    if ((field === "endedAt" && occurrence.record?.startedAt == null) || (field === "startedAt" && occurrenceState(occurrence.record) === "completed" && occurrence.record?.startedAt == null)) throw new Error("Actual start is unknown; use Details to provide valid actual times first");
    return { scheduledStartAt: occurrence.scheduledStartAt, scheduledEndAt: occurrence.scheduledEndAt,
        startedAt: occurrence.record?.startedAt ?? null, endedAt: occurrence.record?.endedAt ?? null, [field]: at };
}

/** Pointer offsets use the viewer's wall-clock grid, bounded to the anchor's day. */
export function resizeDragTime(anchor: number, deltaMinutes: number, timeZone: string): number {
    const local = Temporal.Instant.fromEpochMilliseconds(anchor).toZonedDateTimeISO(timeZone);
    const minute = Math.max(0, Math.min(1435, Math.round((local.hour * 60 + local.minute + deltaMinutes) / 5) * 5));
    return local.with({ hour: Math.floor(minute / 60), minute: minute % 60, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 }).epochMilliseconds;
}
