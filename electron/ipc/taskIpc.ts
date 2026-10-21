import { ipcMain } from "electron";
import type { ResizeOccurrenceInput, OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput } from "../../shared/types/task";
import type { SenderValidator } from "./validateSender";
import { resizeOccurrence, correctOccurrenceTimes, updateOccurrencePlan, startOccurrence, endOccurrence, updateOccurrenceTimes, createTask, deleteTask, undoTaskDeletion, getAllTasks, getWeekSchedule, listOccurrences, setTaskEnabled, updateTask } from "../services/taskService";

export function registerTaskIpc(validateSender: SenderValidator) {
    ipcMain.handle("task:resize-occurrence", (event, input: ResizeOccurrenceInput) => { validateSender(event); return resizeOccurrence(input); });
    ipcMain.handle("task:update-occurrence-plan", (event, input: UpdateOccurrencePlanInput) => { validateSender(event); return updateOccurrencePlan(input); });
    ipcMain.handle("task:list", (event) => { validateSender(event); return getAllTasks(); });
    ipcMain.handle("task:create", (event, input: CreateTaskInput) => { validateSender(event); return createTask(input); });
    ipcMain.handle("task:update", (event, id: number, input: CreateTaskInput) => { validateSender(event); return updateTask(id, input); });
    ipcMain.handle("task:week", (event, from: number, to: number) => { validateSender(event); return getWeekSchedule(from, to); });
    ipcMain.handle("task:delete", (event, id: number) => { validateSender(event); return deleteTask(id); });
    ipcMain.handle("task:undo-delete", (event, token: string) => { validateSender(event); undoTaskDeletion(token); });
    ipcMain.handle("task:set-enabled", (event, id: number, enabled: boolean) => { validateSender(event); setTaskEnabled(id, enabled); });
    ipcMain.handle("task:occurrences", (event, id: number, from: number, to: number) => { validateSender(event); return listOccurrences(id, from, to); });
    ipcMain.handle("task:start-occurrence", (event, input: OccurrenceTarget) => { validateSender(event); return startOccurrence(input); });
    ipcMain.handle("task:end-occurrence", (event, input: OccurrenceTarget) => { validateSender(event); return endOccurrence(input); });
    ipcMain.handle("task:correct-occurrence-times", (event, input: UpdateOccurrenceTimesInput) => { validateSender(event); return correctOccurrenceTimes(input); });
    ipcMain.handle("task:update-occurrence-times", (event, input: UpdateOccurrenceTimesInput) => { validateSender(event); return updateOccurrenceTimes(input); });
}
