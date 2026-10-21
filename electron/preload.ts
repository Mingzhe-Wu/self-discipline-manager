import { contextBridge, ipcRenderer } from "electron";
import type { OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput } from "../shared/types/task";

import type { PlanningHours } from "../shared/types/settings";

contextBridge.exposeInMainWorld("electronAPI", {
    getPlanningHours: () => ipcRenderer.invoke("settings:planning-hours"),
    updatePlanningHours: (input: PlanningHours) => ipcRenderer.invoke("settings:update-planning-hours", input),
    updateTaskOccurrencePlan: (input: UpdateOccurrencePlanInput) => ipcRenderer.invoke("task:update-occurrence-plan", input),
    onWindowShown: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("app:shown", listener);
        return () => ipcRenderer.removeListener("app:shown", listener);
    },
    listTasks: () => ipcRenderer.invoke("task:list"),
    createTask: (input: CreateTaskInput) => ipcRenderer.invoke("task:create", input),
    updateTask: (id: number, input: CreateTaskInput) => ipcRenderer.invoke("task:update", id, input),
    getWeekSchedule: (from: number, to: number) => ipcRenderer.invoke("task:week", from, to),
    deleteTask: (id: number) => ipcRenderer.invoke("task:delete", id),
    undoTaskDeletion: (token: string) => ipcRenderer.invoke("task:undo-delete", token),
    setTaskEnabled: (id: number, enabled: boolean) => ipcRenderer.invoke("task:set-enabled", id, enabled),
    listTaskOccurrences: (id: number, from: number, to: number) => ipcRenderer.invoke("task:occurrences", id, from, to),
    startTaskOccurrence: (input: OccurrenceTarget) => ipcRenderer.invoke("task:start-occurrence", input),
    endTaskOccurrence: (input: OccurrenceTarget) => ipcRenderer.invoke("task:end-occurrence", input),
    correctTaskOccurrenceTimes: (input: UpdateOccurrenceTimesInput) => ipcRenderer.invoke("task:correct-occurrence-times", input),
    updateTaskOccurrenceTimes: (input: UpdateOccurrenceTimesInput) => ipcRenderer.invoke("task:update-occurrence-times", input),
});
