import { ipcMain } from "electron";
import type { ResizeOccurrenceInput, OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput } from "../../shared/types/task";
import type { SenderValidator } from "./validateSender";
import { lateStartOccurrence, getMissedTasks, resizeOccurrence, correctOccurrenceTimes, updateOccurrencePlan, startOccurrence, endOccurrence, updateOccurrenceTimes, createTask, deleteTask, undoTaskDeletion, getAllTasks, getWeekSchedule, listOccurrences, setTaskEnabled, updateTask } from "../services/taskService";

export function registerTaskIpc(validateSender: SenderValidator, onChanged: () => void = () => {}) {
    const change = <T>(run: () => T): T => { const result = run(); onChanged(); return result; };
    ipcMain.handle("task:missed", (event) => { validateSender(event); return getMissedTasks(); });
    ipcMain.handle("task:late-start", (event, input: OccurrenceTarget) => { validateSender(event); return change(() => lateStartOccurrence(input)); });
    ipcMain.handle("task:resize-occurrence", (event, input: ResizeOccurrenceInput) => { validateSender(event); return change(() => resizeOccurrence(input)); });
    ipcMain.handle("task:update-occurrence-plan", (event, input: UpdateOccurrencePlanInput) => { validateSender(event); return change(() => updateOccurrencePlan(input)); });
    ipcMain.handle("task:list", (event) => { validateSender(event); return getAllTasks(); });
    ipcMain.handle("task:create", (event, input: CreateTaskInput) => { validateSender(event); return change(() => createTask(input)); });
    ipcMain.handle("task:update", (event, id: number, input: CreateTaskInput) => { validateSender(event); return change(() => updateTask(id, input)); });
    ipcMain.handle("task:week", (event, from: number, to: number) => { validateSender(event); return getWeekSchedule(from, to); });
    ipcMain.handle("task:delete", (event, id: number) => { validateSender(event); return change(() => deleteTask(id)); });
    ipcMain.handle("task:undo-delete", (event, token: string) => { validateSender(event); change(() => undoTaskDeletion(token)); });
    ipcMain.handle("task:set-enabled", (event, id: number, enabled: boolean) => { validateSender(event); change(() => setTaskEnabled(id, enabled)); });
    ipcMain.handle("task:occurrences", (event, id: number, from: number, to: number) => { validateSender(event); return listOccurrences(id, from, to); });
    ipcMain.handle("task:start-occurrence", (event, input: OccurrenceTarget) => { validateSender(event); return change(() => startOccurrence(input)); });
    ipcMain.handle("task:end-occurrence", (event, input: OccurrenceTarget) => { validateSender(event); return change(() => endOccurrence(input)); });
    ipcMain.handle("task:correct-occurrence-times", (event, input: UpdateOccurrenceTimesInput) => { validateSender(event); return change(() => correctOccurrenceTimes(input)); });
    ipcMain.handle("task:update-occurrence-times", (event, input: UpdateOccurrenceTimesInput) => { validateSender(event); return change(() => updateOccurrenceTimes(input)); });
}
