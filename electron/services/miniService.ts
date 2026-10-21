import type { MiniToday, MiniTaskDetails } from "../../shared/types/mini";
import type { OccurrenceTarget } from "../../shared/types/task";
import { localDayRange } from "../../shared/scheduling/recurrence";
import { dayKey } from "../../shared/scheduling/week";
import { getWeekSchedule } from "./taskService";

export function getMiniToday(): MiniToday {
    const now = Date.now(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { from, to } = localDayRange(now, timeZone);
    const schedule = getWeekSchedule(from, to);
    const ids = new Set(schedule.occurrences.map(row => row.taskId));
    return { ...schedule, tasks: schedule.tasks.filter(task => ids.has(task.id)), now, timeZone, date: dayKey(now, timeZone) };
}

/** Resolve fresh data rather than trusting a task/record sent by the renderer. */
export function getMiniTaskDetails(input: OccurrenceTarget): MiniTaskDetails {
    if (!input || !Number.isSafeInteger(input.taskId) || input.taskId <= 0) throw new Error("Invalid task target");
    const today = getMiniToday();
    const occurrence = today.occurrences.find(row => row.taskId === input.taskId && (
        input.occurrenceId !== undefined
            ? Number.isSafeInteger(input.occurrenceId) && row.record?.id === input.occurrenceId
            : Number.isSafeInteger(input.scheduledStartAt) && Number.isSafeInteger(input.scheduledEndAt) && row.scheduledStartAt === input.scheduledStartAt && row.scheduledEndAt === input.scheduledEndAt
    ));
    const task = today.tasks.find(task => task.id === input.taskId);
    if (!task || !occurrence) throw new Error("This task occurrence is no longer available. Refresh the mini view.");
    return { task, occurrence };
}
