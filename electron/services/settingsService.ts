import type { PlanningHours } from "../../shared/types/settings";
import { assertPlanningBounds, DEFAULT_PLANNING_HOURS, validatePlanningHours } from "../../shared/scheduling/planningHours";
import { expectedTimes } from "../../shared/scheduling/week";
import { firstOccurrenceAt, occurrenceEndAt } from "../../shared/scheduling/recurrence";
import * as repository from "../db/settingsRepository";
import * as tasks from "../db/taskRepository";

const DAY = 86400000;

export function getPlanningHours(): PlanningHours {
    return repository.getPlanningHours() ?? { ...DEFAULT_PLANNING_HOURS };
}

/** Settings constrain planned wall times in each task's persisted zone. Disabled
 * notifications do not disable a schedule. Completed and elapsed history stays intact. */
export function updatePlanningHours(input: unknown): PlanningHours {
    const hours = validatePlanningHours(input);
    const now = Date.now();
    const conflicts: string[] = [];
    for (const task of tasks.getAllTasks()) {
        const outside = (start: number, end: number) => {
            if (end < now) return false;
            const record = tasks.getOccurrenceAt(task.id, start, end);
            if ((record?.endedAt !== null && record?.endedAt !== undefined) || record?.legacyCompleted) return false;
            try { assertPlanningBounds(start, end, task.timeZone, hours); return false; } catch { return true; }
        };
        let conflict = task.scheduleType === "one-time" && outside(task.scheduledStartAt, task.scheduledEndAt);
        if (task.scheduleType === "recurring" && task.recurrenceRule) {
            const rule = task.recurrenceRule;
            // Rules have no end date: a finite set of excluded occurrences cannot
            // remove an out-of-bounds recurring clock range from every future date.
            conflict = rule.startTime < hours.wakeTime || rule.endTime > hours.sleepTime;
            if (!conflict) {
                const from = Math.max(now - 2 * DAY, task.scheduleEffectiveAt, firstOccurrenceAt(rule));
                // Include a full seasonal cycle: spring-gap resolution may move
                // the realized wall range beyond the configured sleep boundary.
                const seasonalConflict = (after: number) => expectedTimes(task, after, after + 370 * DAY).some((start) => {
                    try { return outside(start, occurrenceEndAt(task, start)); } catch { return true; }
                });
                conflict = seasonalConflict(from);
                // Also inspect beyond finite exclusions; skipping this year's DST
                // occurrence does not remove next year's recurring expectation.
                const afterExclusions = Math.max(from, ...(task.excludedOccurrences ?? []).map((range) => range.scheduledStartAt + 1));
                if (!conflict && afterExclusions > from) conflict = seasonalConflict(afterExclusions);
            }
        }
        if (conflict) conflicts.push(`${task.title} (#${task.id})`);
    }
    if (conflicts.length) throw new Error(`Planning hours conflict with current or future tasks: ${conflicts.join(", ")}`);
    return repository.savePlanningHours(hours);
}
