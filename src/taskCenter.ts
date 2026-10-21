import type { ScheduledOccurrence, Task, WeekSchedule } from "../shared/types/task";
import { categoryMetadata, type TaskCategory } from "../shared/taskCategories";

export type TaskCenterFilter = "all" | "recurring" | "missed";
export interface TaskCenterEntry {
    key: string;
    kind: "recurring" | "missed" | "one-time";
    task: Task;
    occurrence?: ScheduledOccurrence;
}

/** Merge definitions and missed occurrences by identity, never by their titles. */
export function taskCenterEntries(data: WeekSchedule): TaskCenterEntry[] {
    const missedByTask = new Map<number, ScheduledOccurrence[]>();
    for (const occurrence of data.occurrences) {
        const rows = missedByTask.get(occurrence.taskId) ?? [];
        rows.push(occurrence);
        missedByTask.set(occurrence.taskId, rows);
    }
    return [...data.tasks].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).flatMap<TaskCenterEntry>(task => {
        const missed = (missedByTask.get(task.id) ?? []).map(occurrence => ({ key: `occurrence:${task.id}:${occurrence.scheduledStartAt}:${occurrence.scheduledEndAt}`, kind: "missed" as const, task, occurrence }));
        if (task.scheduleType === "recurring") return [{ key: `series:${task.id}`, kind: "recurring" as const, task }, ...missed];
        return missed.length ? missed : [{ key: `task:${task.id}`, kind: "one-time" as const, task }];
    });
}

export function toggleTaskCenterFilter(current: TaskCenterFilter, tag: Exclude<TaskCenterFilter, "all">): TaskCenterFilter {
    return current === tag ? "all" : tag;
}

export function filterTaskCenterEntries(entries: TaskCenterEntry[], filter: TaskCenterFilter, query = "", category: TaskCategory | "all" = "all"): TaskCenterEntry[] {
    const title = query.trim().toLocaleLowerCase();
    const rows = entries.filter(row => (filter === "all" || row.kind === filter)
        && row.task.title.toLocaleLowerCase().includes(title)
        && (category === "all" || categoryMetadata(row.task.category).key === category));
    return filter === "missed" ? rows.sort((a, b) => b.occurrence!.scheduledStartAt - a.occurrence!.scheduledStartAt || b.task.id - a.task.id) : rows;
}
