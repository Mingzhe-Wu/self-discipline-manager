import type { Task } from "../../shared/types/task";

import {
    createTask as createTaskRepository,
    deleteTask as deleteTaskRepository,
    getAllTasks as getAllTasksRepository,
    updateTaskCompleted as updateTaskCompletedRepository,
} from "../db/taskRepository";

export function getAllTasks(): Task[] {
    return getAllTasksRepository();
}

export function createTask(title: string): Task {
    if (typeof title !== "string") {
        throw new Error("Task title cannot be empty");
    }
    const normalizedTitle = title.trim();

    if (!normalizedTitle) {
        throw new Error("Task title cannot be empty");
    }

    return createTaskRepository(normalizedTitle);
}

export function updateTaskCompleted(
    id: number,
    completed: boolean,
): Task | undefined {
    validateTaskId(id);
    if (typeof completed !== "boolean") {
        throw new Error("Task completed must be a boolean");
    }
    return updateTaskCompletedRepository(id, completed);
}

export function deleteTask(id: number): void {
    validateTaskId(id);
    deleteTaskRepository(id);
}

function validateTaskId(id: number): void {
    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Invalid task ID");
    }
}
