import { occurrenceState } from "../occurrenceLifecycle";
import type { ScheduledOccurrence } from "../types/task";

/** Input is the service's local-today projection, including activity carried over from yesterday. */
export function miniSections(occurrences: ScheduledOccurrence[], now: number) {
    const running: ScheduledOccurrence[] = [], upcoming: ScheduledOccurrence[] = [], missed: ScheduledOccurrence[] = [];
    for (const row of occurrences) {
        const state = occurrenceState(row.record, now, row.scheduledEndAt);
        if (state === "in-progress") running.push(row);
        else if (state === "planned") upcoming.push(row);
        else if (state === "missed") missed.push(row);
    }
    running.sort((a, b) => a.record!.startedAt! - b.record!.startedAt! || a.taskId - b.taskId);
    upcoming.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt || a.taskId - b.taskId);
    missed.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt || b.taskId - a.taskId);
    return { running, upcoming: upcoming.slice(0, 4), missed };
}
