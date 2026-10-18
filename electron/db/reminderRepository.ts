import { and, asc, eq, lte } from "drizzle-orm";
import { getDatabase } from "./database";
import { remindersTable, type Reminder } from "./schema";

export function getAllReminders(): Reminder[] {
    return getDatabase().select().from(remindersTable)
        .orderBy(asc(remindersTable.dueAt), asc(remindersTable.id)).all();
}

export function createReminder(title: string, dueAt: number, createdAt: number): Reminder {
    return getDatabase().insert(remindersTable)
        .values({ title, dueAt, createdAt }).returning().get();
}

export function deleteReminder(id: number): void {
    getDatabase().delete(remindersTable).where(eq(remindersTable.id, id)).run();
}

export function findDueReminders(now: number): Reminder[] {
    return getDatabase().select().from(remindersTable)
        .where(and(lte(remindersTable.dueAt, now), eq(remindersTable.notified, false)))
        .orderBy(asc(remindersTable.dueAt), asc(remindersTable.id)).all();
}

export function markReminderAsNotified(id: number): void {
    getDatabase().update(remindersTable).set({ notified: true })
        .where(eq(remindersTable.id, id)).run();
}
