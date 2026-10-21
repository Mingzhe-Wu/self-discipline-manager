import { and, asc, desc, eq, gte, isNull, lt, lte, notExists, or } from "drizzle-orm";
import { getDatabase } from "./database";
import { tasksTable, taskOccurrencesTable, occurrenceReminderSlotsTable, recurrenceExclusionsTable, type TaskRecord, type OccurrenceRecord } from "./schema";
import { isExcluded } from "../../shared/scheduling/week";

export type PlannedRange = { scheduledStartAt: number; scheduledEndAt: number };

function withExclusions(task: TaskRecord): TaskRecord {
    return { ...task, excludedOccurrences: getDatabase().select({ scheduledStartAt: recurrenceExclusionsTable.scheduledStartAt,
        scheduledEndAt: recurrenceExclusionsTable.scheduledEndAt }).from(recurrenceExclusionsTable).where(eq(recurrenceExclusionsTable.taskId, task.id)).all() };
}

export function getAllTasks(): TaskRecord[] {
    return getDatabase().select().from(tasksTable).where(isNull(tasksTable.deletedAt)).orderBy(asc(tasksTable.id)).all().map(withExclusions);
}

export function getTask(id: number): TaskRecord | undefined {
    const task = getDatabase().select().from(tasksTable).where(and(eq(tasksTable.id, id), isNull(tasksTable.deletedAt))).get();
    return task ? withExclusions(task) : undefined;
}

export function createTask(values: typeof tasksTable.$inferInsert, times: PlannedRange[]): TaskRecord {
    return getDatabase().transaction((transaction) => {
        const task = transaction.insert(tasksTable).values(values).returning().get();
        for (const range of times) {
            transaction.insert(taskOccurrencesTable).values({ taskId: task.id, ...range,
                createdAt: values.createdAt, updatedAt: values.createdAt }).run();
        }
        return task;
    });
}

export function materializeOccurrences(taskId: number, times: PlannedRange[], through: number, now: number): void {
    const db = getDatabase();
    const task = getTask(taskId)!;
    db.transaction((transaction) => {
        for (const range of times) {
            if (isExcluded(task, range.scheduledStartAt, range.scheduledEndAt)) continue;
            transaction.insert(taskOccurrencesTable).values({ taskId, ...range, createdAt: now, updatedAt: now })
                .onConflictDoNothing().run();
        }
        transaction.update(tasksTable).set({ generatedThrough: through }).where(eq(tasksTable.id, taskId)).run();
    });
}

export function listOccurrences(taskId: number, from: number, to: number): OccurrenceRecord[] {
    return getDatabase().select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, taskId),
        gte(taskOccurrencesTable.scheduledStartAt, from), lt(taskOccurrencesTable.scheduledStartAt, to)))
        .orderBy(desc(taskOccurrencesTable.scheduledStartAt)).all();
}

/** Actual ranges can intersect a week far away from their planned dates. */
export function listActualOccurrences(taskId: number, from: number, to: number): OccurrenceRecord[] {
    return getDatabase().select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, taskId),
        lt(taskOccurrencesTable.startedAt, to), or(isNull(taskOccurrencesTable.endedAt), gte(taskOccurrencesTable.endedAt, from)))).all();
}

export function getCurrentOccurrence(taskId: number, now: number): OccurrenceRecord | undefined {
    const db = getDatabase();
    return db.select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, taskId), lte(taskOccurrencesTable.scheduledStartAt, now)))
        .orderBy(desc(taskOccurrencesTable.scheduledStartAt)).get()
        ?? db.select().from(taskOccurrencesTable).where(eq(taskOccurrencesTable.taskId, taskId)).orderBy(asc(taskOccurrencesTable.scheduledStartAt)).get();
}

export function getNextOccurrence(taskId: number, now: number): OccurrenceRecord | undefined {
    return getDatabase().select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, taskId),
        gte(taskOccurrencesTable.scheduledStartAt, now + 1), isNull(taskOccurrencesTable.endedAt), eq(taskOccurrencesTable.legacyCompleted, false)))
        .orderBy(asc(taskOccurrencesTable.scheduledStartAt)).get();
}

export function getOccurrence(taskId: number, id: number): OccurrenceRecord | undefined {
    return getDatabase().select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.id, id), eq(taskOccurrencesTable.taskId, taskId))).get();
}

export function getOccurrenceAt(taskId: number, scheduledStartAt: number, scheduledEndAt: number): OccurrenceRecord | undefined {
    return getDatabase().select().from(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, taskId), eq(taskOccurrencesTable.scheduledStartAt, scheduledStartAt), eq(taskOccurrencesTable.scheduledEndAt, scheduledEndAt))).get();
}

export function ensureOccurrence(taskId: number, scheduledStartAt: number, scheduledEndAt: number, now: number): OccurrenceRecord {
    if (isExcluded(getTask(taskId)!, scheduledStartAt, scheduledEndAt)) throw new Error("Task occurrence was excluded from its schedule");
    getDatabase().insert(taskOccurrencesTable).values({ taskId, scheduledStartAt, scheduledEndAt, createdAt: now, updatedAt: now }).onConflictDoNothing().run();
    return getOccurrenceAt(taskId, scheduledStartAt, scheduledEndAt)!;
}

/** Atomic schedule cutover; only pristine future expectations are replaceable. */
export function updateTask(id: number, values: Partial<typeof tasksTable.$inferInsert>, cutover?: { at: number; past: PlannedRange[]; future: PlannedRange[] }): TaskRecord {
    const task = getTask(id)!;
    return getDatabase().transaction((transaction) => {
        if (cutover) {
            for (const range of cutover.past) transaction.insert(taskOccurrencesTable)
                .values({ taskId: id, ...range, createdAt: cutover.at, updatedAt: cutover.at }).onConflictDoNothing().run();
            transaction.delete(taskOccurrencesTable).where(and(eq(taskOccurrencesTable.taskId, id),
                gte(taskOccurrencesTable.scheduledStartAt, cutover.at), isNull(taskOccurrencesTable.recordedAt),
                isNull(taskOccurrencesTable.startedAt), isNull(taskOccurrencesTable.endedAt),
                eq(taskOccurrencesTable.legacyCompleted, false), eq(taskOccurrencesTable.remindersSuppressed, false),
                notExists(transaction.select().from(occurrenceReminderSlotsTable).where(eq(occurrenceReminderSlotsTable.occurrenceId, taskOccurrencesTable.id))))).run();
            for (const range of cutover.future.filter((range) => !isExcluded(task, range.scheduledStartAt, range.scheduledEndAt))) transaction.insert(taskOccurrencesTable)
                .values({ taskId: id, ...range, createdAt: cutover.at, updatedAt: cutover.at }).onConflictDoNothing().run();
        }
        return transaction.update(tasksTable).set(values).where(eq(tasksTable.id, id)).returning().get();
    });
}

/** The replacement and original exclusion must survive together or roll back together. */
export function detachOccurrence(original: OccurrenceRecord, values: typeof tasksTable.$inferInsert): TaskRecord {
    return getDatabase().transaction((transaction) => {
        transaction.insert(recurrenceExclusionsTable).values({ taskId: original.taskId, scheduledStartAt: original.scheduledStartAt,
            scheduledEndAt: original.scheduledEndAt, createdAt: values.createdAt }).run();
        const slot = transaction.select().from(occurrenceReminderSlotsTable).where(eq(occurrenceReminderSlotsTable.occurrenceId, original.id)).get();
        if (original.recordedAt !== null || original.progressSource !== null || original.startedAt !== null || original.endedAt !== null || original.legacyCompleted || original.remindersSuppressed || slot) {
            transaction.update(taskOccurrencesTable).set({ remindersSuppressed: true, updatedAt: values.createdAt }).where(eq(taskOccurrencesTable.id, original.id)).run();
        } else transaction.delete(taskOccurrencesTable).where(eq(taskOccurrencesTable.id, original.id)).run();
        const task = transaction.insert(tasksTable).values(values).returning().get();
        transaction.insert(taskOccurrencesTable).values({ taskId: task.id, scheduledStartAt: task.scheduledStartAt,
            scheduledEndAt: task.scheduledEndAt, createdAt: values.createdAt, updatedAt: values.createdAt }).run();
        return task;
    });
}

export function saveProgress(id: number, values: Pick<OccurrenceRecord, "startedAt" | "endedAt" | "recordedAt" | "progressSource" | "legacyCompleted" | "updatedAt">): OccurrenceRecord {
    return getDatabase().update(taskOccurrencesTable).set(values).where(eq(taskOccurrencesTable.id, id)).returning().get();
}

/** Transfer the existing history row and its slot FKs, rather than copying history. */
export function detachOccurrenceWithActual(original: OccurrenceRecord, taskValues: typeof tasksTable.$inferInsert,
    actualValues: Pick<OccurrenceRecord, "startedAt" | "endedAt" | "recordedAt" | "progressSource" | "legacyCompleted" | "updatedAt">): OccurrenceRecord {
    return getDatabase().transaction((transaction) => {
        transaction.insert(recurrenceExclusionsTable).values({ taskId: original.taskId, scheduledStartAt: original.scheduledStartAt,
            scheduledEndAt: original.scheduledEndAt, createdAt: taskValues.createdAt }).run();
        const task = transaction.insert(tasksTable).values(taskValues).returning().get();
        return transaction.update(taskOccurrencesTable).set({ ...actualValues, taskId: task.id })
            .where(and(eq(taskOccurrencesTable.id, original.id), eq(taskOccurrencesTable.taskId, original.taskId))).returning().get();
    });
}

export function setTaskEnabled(id: number, enabled: boolean, now: number): void {
    getDatabase().update(tasksTable).set({ enabled, updatedAt: now }).where(eq(tasksTable.id, id)).run();
}

export function deleteTask(id: number, now: number): void {
    getDatabase().update(tasksTable).set({ deletedAt: now, updatedAt: now, enabled: false }).where(eq(tasksTable.id, id)).run();
}

export function restoreDeletedTask(id: number, deletedAt: number, enabled: boolean, updatedAt: number): boolean {
    return getDatabase().update(tasksTable).set({ deletedAt: null, enabled, updatedAt })
        .where(and(eq(tasksTable.id, id), eq(tasksTable.deletedAt, deletedAt))).run().changes === 1;
}

/** Explicit correction of this one-time plan; actual/history/slot identity survives. */
export function correctOneTimePlan(id: number, occurrenceId: number, values: Partial<typeof tasksTable.$inferInsert>): TaskRecord {
    return getDatabase().transaction((transaction) => {
        const task = transaction.update(tasksTable).set(values).where(eq(tasksTable.id, id)).returning().get();
        transaction.update(taskOccurrencesTable).set({ scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt, updatedAt: values.updatedAt })
            .where(and(eq(taskOccurrencesTable.id, occurrenceId), eq(taskOccurrencesTable.taskId, id))).run();
        return task;
    });
}
