import type { TaskOccurrence } from "./types/task";

export function occurrenceState(record: TaskOccurrence | null, now = Date.now(), scheduledEndAt = record?.scheduledEndAt): "planned" | "in-progress" | "completed" | "missed" {
    if (record?.endedAt != null || record?.legacyCompleted) return "completed";
    if (record?.startedAt != null) return "in-progress";
    return scheduledEndAt !== undefined && now > scheduledEndAt ? "missed" : "planned";
}

export function canLateStart(scheduledStartAt: number, now: number, timeZone: string): boolean {
    const date = (at: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    return date(scheduledStartAt) === date(now);
}

export function occurrenceDuration(record: TaskOccurrence | null): number | null {
    return record?.startedAt != null && record.endedAt != null ? record.endedAt - record.startedAt : null;
}
