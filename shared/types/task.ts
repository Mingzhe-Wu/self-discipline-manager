import type { TaskCategory } from "../taskCategories";

export interface RecurrenceRule {
    frequency: "daily" | "weekly";
    startDate: string;
    startTime: string;
    endTime: string;
    timeZone: string;
    /** Sunday = 0, Monday = 1, ... Saturday = 6. Empty for daily. */
    weekdays: number[];
}

export interface TaskOccurrence {
    id: number;
    taskId: number;
    scheduledStartAt: number;
    scheduledEndAt: number;
    startedAt: number | null;
    endedAt: number | null;
    /** First lifecycle record entry, independent of current derived state. */
    recordedAt: number | null;
    progressSource: "normal" | "backfill" | "corrected" | "legacy" | null;
    /** Imported completed record whose actual start AND end are unknown. */
    legacyCompleted: boolean;
    remindersSuppressed: boolean;
    createdAt: number;
    updatedAt: number;
}

export interface Task {
    category: TaskCategory;
    id: number;
    title: string;
    scheduleType: "one-time" | "recurring";
    scheduledStartAt: number;
    scheduledEndAt: number;
    recurrenceRule: RecurrenceRule | null;
    timeZone: string;
    /** Current rule applies from this instant; older expectations remain stored. */
    scheduleEffectiveAt: number;
    origin: "user" | "legacy-task" | "legacy-reminder";
    /** Controls notifications; turning this off does not erase expected history. */
    enabled: boolean;
    createdAt: number;
    updatedAt: number;
    currentOccurrence: TaskOccurrence | null;
    nextOccurrenceAt: number | null;
}

export type CreateTaskInput = { title: string; category?: TaskCategory; enabled?: boolean } & (
    | { scheduleType: "one-time"; scheduledStartAt: number; scheduledEndAt: number; timeZone?: string }
    | { scheduleType: "recurring"; recurrenceRule: RecurrenceRule }
);

export type OccurrenceTarget = { taskId: number } &
    ({ occurrenceId: number; scheduledStartAt?: never; scheduledEndAt?: never } | { scheduledStartAt: number; scheduledEndAt: number; occurrenceId?: never });

export type UpdateOccurrenceTimesInput = OccurrenceTarget & { startedAt: number | null; endedAt: number | null };

export type UpdateOccurrencePlanInput = { target: OccurrenceTarget; changes: CreateTaskInput; sync: boolean };

export interface ResizeOccurrenceInput {
    target: OccurrenceTarget;
    edge: "start" | "end";
    at: number;
    expectedState: "planned" | "in-progress" | "completed";
}

export interface ScheduledOccurrence {
    taskId: number;
    scheduledStartAt: number;
    scheduledEndAt: number;
    record: TaskOccurrence | null;
}

export interface WeekSchedule {
    tasks: Task[];
    occurrences: ScheduledOccurrence[];
}

export const TASK_DELETE_UNDO_MS = 5000;
export interface TaskDeletionReceipt {
    undoToken: string;
    expiresAt: number;
}
