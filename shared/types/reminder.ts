/** Timestamps are Unix milliseconds; the renderer displays them in local time. */
export interface Reminder {
    id: number;
    title: string;
    dueAt: number;
    notified: boolean;
    createdAt: number;
}

export interface CreateReminderInput {
    title: string;
    dueAt: number;
}
