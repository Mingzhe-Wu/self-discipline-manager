import { getDatabase } from "./database";
import { eq } from "drizzle-orm";

import {
    tasksTable,
    type Task
} from "./schema";

export function getAllTasks(): Task[] {
    const db = getDatabase();
    return db
        .select()
        .from(tasksTable)
        .all();
}

export function createTask(title: string): Task {
    const db = getDatabase();
    return db
        .insert(tasksTable)
        .values({
            title
        })
        .returning()
        .get();
}

export function updateTaskCompleted(
    id: number,
    completed: boolean
): Task | undefined {
    const db = getDatabase();
    return db
        .update(tasksTable)
        .set({
            completed
        })
        .where(
            eq(tasksTable.id, id)
        )
        .returning()
        .get();
}

export function deleteTask(
    id: number
): void {
    const db = getDatabase();
    db
        .delete(tasksTable)
        .where(
            eq(tasksTable.id, id)
        )
        .run();
}