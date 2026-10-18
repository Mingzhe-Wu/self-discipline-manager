import { contextBridge, ipcRenderer } from "electron";

import type { CreateReminderInput } from "../shared/types/reminder";

contextBridge.exposeInMainWorld("electronAPI", {
    listReminders: () => ipcRenderer.invoke("reminder:list"),
    createReminder: (input: CreateReminderInput) => ipcRenderer.invoke("reminder:create", input),
    deleteReminder: (id: number) => ipcRenderer.invoke("reminder:delete", id),

    listTasks: () => {
        return ipcRenderer.invoke("task:list");
    },

    createTask: (title: string) => {
        return ipcRenderer.invoke("task:create", title);
    },

    updateTaskCompleted: (id: number, completed: boolean) => {
        return ipcRenderer.invoke("task:update-completed", id, completed);
    },

    deleteTask: (id: number) => {
        return ipcRenderer.invoke("task:delete", id);
    },
});
