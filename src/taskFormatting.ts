import type { Task } from "../shared/types/task";

export function localDateInput(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localDateTimeInput(timestamp: number): string {
    const date = new Date(timestamp);
    return `${localDateInput(timestamp)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatScheduled(task: Task, timestamp: number): string {
    return new Date(timestamp).toLocaleString(undefined, { timeZone: task.timeZone });
}

export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unable to update tasks";
}

export function formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    if (seconds < 60) return `${seconds} sec`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
}

