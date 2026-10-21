import { contextBridge, ipcRenderer } from "electron";
import type { ResizeOccurrenceInput, OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput } from "../shared/types/task";

import type { UpdateLocalPreferencesInput, UpdateUserSettingsInput, PlanningHours } from "../shared/types/settings";

contextBridge.exposeInMainWorld("electronAPI", {
    updateLocalPreferences: (input: UpdateLocalPreferencesInput) => ipcRenderer.invoke("settings:update-local-preferences", input),
    getLocalPreferences: () => ipcRenderer.invoke("settings:local-preferences"),
    updateLocalProfile: (input: { displayName: string }) => ipcRenderer.invoke("settings:update-profile", input),
    updateUserSettings: (input: UpdateUserSettingsInput) => ipcRenderer.invoke("settings:update", input),
    getPlanningHours: () => ipcRenderer.invoke("settings:planning-hours"),
    updatePlanningHours: (input: PlanningHours) => ipcRenderer.invoke("settings:update-planning-hours", input),
    resizeTaskOccurrence: (input: ResizeOccurrenceInput) => ipcRenderer.invoke("task:resize-occurrence", input),
    updateTaskOccurrencePlan: (input: UpdateOccurrencePlanInput) => ipcRenderer.invoke("task:update-occurrence-plan", input),
    onWindowShown: (callback: () => void) => {
        const listener = () => callback();
        ipcRenderer.on("app:shown", listener);
        return () => ipcRenderer.removeListener("app:shown", listener);
    },
    getMissedTasks: () => ipcRenderer.invoke("task:missed"),
    lateStartTaskOccurrence: (input: OccurrenceTarget) => ipcRenderer.invoke("task:late-start", input),
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
