import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDatabase } from "./database";
import { occurrenceReminderSlotsTable as slots, taskOccurrencesTable as occurrences, tasksTable as tasks } from "./schema";

export function findCandidates(now: number) {
    return getDatabase().select({ occurrence: occurrences, task: tasks }).from(occurrences)
        .innerJoin(tasks, eq(tasks.id, occurrences.taskId)).where(and(isNull(tasks.deletedAt), eq(tasks.enabled, true),
            isNull(occurrences.startedAt), isNull(occurrences.endedAt), eq(occurrences.legacyCompleted, false),
            eq(occurrences.remindersSuppressed, false), gte(occurrences.scheduledStartAt, now - 15.5 * 60_000),
            lte(occurrences.scheduledStartAt, now + 5 * 60_000))).orderBy(asc(occurrences.scheduledStartAt)).all();
}
export function getSlot(occurrenceId: number, slot: number) {
    return getDatabase().select().from(slots).where(and(eq(slots.occurrenceId, occurrenceId), eq(slots.slot, slot))).get();
}
export function claimSlot(occurrenceId: number, slot: number, now: number): boolean {
    return getDatabase().insert(slots).values({ occurrenceId, slot, state: "sending", lastAttemptAt: now })
        .onConflictDoUpdate({ target: [slots.occurrenceId, slots.slot], set: { state: "sending", lastAttemptAt: now,
            attemptCount: sql`${slots.attemptCount} + 1` }, setWhere: eq(slots.state, "failed") }).returning().get() !== undefined;
}
export function finishSlot(occurrenceId: number, slot: number, state: "sent" | "failed" | "unknown", now: number) {
    getDatabase().update(slots).set({ state, ...(state === "sent" ? { sentAt: now } : {}) })
        .where(and(eq(slots.occurrenceId, occurrenceId), eq(slots.slot, slot), eq(slots.state, "sending"))).run();
}
export function recoverInterruptedSlots() {
    getDatabase().update(slots).set({ state: "unknown" }).where(eq(slots.state, "sending")).run();
}
