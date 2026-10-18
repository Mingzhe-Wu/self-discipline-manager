import { ipcMain } from "electron";
import type { SenderValidator } from "./validateSender";

import {
    createTask,
    deleteTask,
    getAllTasks,
    updateTaskCompleted,
} from "../services/taskService";

export function registerTaskIpc(validateSender: SenderValidator) {
    ipcMain.handle("task:list", (event) => {
        validateSender(event);
        return getAllTasks();
    });

    ipcMain.handle("task:create", (event, title: string) => {
        validateSender(event);
        return createTask(title);
    });

    ipcMain.handle(
        "task:update-completed",
        (event, id: number, completed: boolean) => {
            validateSender(event);
            return updateTaskCompleted(id, completed);
        },
    );

    ipcMain.handle("task:delete", (event, id: number) => {
        validateSender(event);
        deleteTask(id);
    });
}
