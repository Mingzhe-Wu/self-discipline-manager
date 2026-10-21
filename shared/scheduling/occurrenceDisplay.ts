import type { ScheduledOccurrence } from "../types/task";

/** Display policy only. Planned identity and stored timestamps never change. */
export function occurrenceDisplayRange(occurrence: ScheduledOccurrence, now: number) {
    const record = occurrence.record;
    if (record?.startedAt == null) return { startAt: occurrence.scheduledStartAt, endAt: occurrence.scheduledEndAt };
    return { startAt: record.startedAt, endAt: record.endedAt ?? Math.max(occurrence.scheduledEndAt, record.startedAt, now) };
}
