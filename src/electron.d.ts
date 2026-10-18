import type { Task } from "../shared/types/task";
import type { CreateReminderInput, Reminder } from "../shared/types/reminder";

export {};

declare global {
    interface Window {
        electronAPI: {
            listReminders: () => Promise<Reminder[]>;
            createReminder: (input: CreateReminderInput) => Promise<Reminder>;
            deleteReminder: (id: number) => Promise<void>;

            listTasks: () => Promise<Task[]>;

            createTask: (
                title: string
            ) => Promise<Task>;

            updateTaskCompleted: (
                id: number,
                completed: boolean
            ) => Promise<Task | undefined>;

            deleteTask: (
                id: number
            ) => Promise<void>;
        };
    }
}
