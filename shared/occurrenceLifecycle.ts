import type { TaskOccurrence } from "./types/task";

export function occurrenceState(record: TaskOccurrence | null): "planned" | "in-progress" | "completed" {
    if (record?.endedAt != null || record?.legacyCompleted) return "completed";
    return record?.startedAt != null ? "in-progress" : "planned";
}

export function occurrenceDuration(record: TaskOccurrence | null): number | null {
    return record?.startedAt != null && record.endedAt != null ? record.endedAt - record.startedAt : null;
}
