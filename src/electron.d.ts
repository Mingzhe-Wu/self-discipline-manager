import type { MiniToday, MiniWindowState, MiniTaskDetails, MiniResizeEdge, MiniPointer } from "../shared/types/mini";
import type { TaskDeletionReceipt, ResizeOccurrenceInput, OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput, Task, TaskOccurrence, WeekSchedule } from "../shared/types/task";
import type { UpdateLocalPreferencesInput, LocalPreferences, LocalProfile, UpdateUserSettingsInput, UserSettings, PlanningHours } from "../shared/types/settings";
export {};

declare global {
    interface Window {
        miniAPI: {
            openTask: (target: OccurrenceTarget) => Promise<void>;
            beginResize: (edge: MiniResizeEdge, pointer: MiniPointer) => Promise<void>;
            moveResize: (pointer: MiniPointer) => Promise<void>;
            endResize: () => Promise<void>;
            getWindowState: () => Promise<MiniWindowState>;
            expand: () => Promise<void>;
            collapse: () => Promise<void>;
            beginDrag: () => Promise<void>;
            moveDrag: () => Promise<void>;
            endDrag: () => Promise<void>;
            onWindowStateChanged: (callback: (state: MiniWindowState) => void) => () => void;
            getToday: () => Promise<MiniToday>;
            start: (target: OccurrenceTarget) => Promise<TaskOccurrence>;
            finish: (target: OccurrenceTarget) => Promise<TaskOccurrence>;
            showBallMenu: () => Promise<void>;
            openMain: () => Promise<void>;
            onDataChanged: (callback: () => void) => () => void;
        };
        electronAPI: {
            onOpenTaskDetails: (callback: (details: MiniTaskDetails) => void) => () => void;
            updateLocalPreferences: (input: UpdateLocalPreferencesInput) => Promise<LocalPreferences>;
            getLocalPreferences: () => Promise<LocalPreferences>;
            updateLocalProfile: (input: { displayName: string }) => Promise<LocalProfile>;
            updateUserSettings: (input: UpdateUserSettingsInput) => Promise<UserSettings>;
            getPlanningHours: () => Promise<PlanningHours>;
            updatePlanningHours: (input: PlanningHours) => Promise<PlanningHours>;
            resizeTaskOccurrence: (input: ResizeOccurrenceInput) => Promise<TaskOccurrence>;
            updateTaskOccurrencePlan: (input: UpdateOccurrencePlanInput) => Promise<Task>;
            onWindowShown: (callback: () => void) => () => void;
            onDataChanged: (callback: () => void) => () => void;
            getMissedTasks: () => Promise<WeekSchedule>;
            lateStartTaskOccurrence: (input: OccurrenceTarget) => Promise<Task>;
            listTasks: () => Promise<Task[]>;
            createTask: (input: CreateTaskInput) => Promise<Task>;
            updateTask: (id: number, input: CreateTaskInput) => Promise<Task>;
            getWeekSchedule: (from: number, to: number) => Promise<WeekSchedule>;
            deleteTask: (id: number) => Promise<TaskDeletionReceipt>;
            undoTaskDeletion: (token: string) => Promise<void>;
            setTaskEnabled: (id: number, enabled: boolean) => Promise<void>;
            listTaskOccurrences: (id: number, from: number, to: number) => Promise<TaskOccurrence[]>;
            startTaskOccurrence: (input: OccurrenceTarget) => Promise<TaskOccurrence>;
            endTaskOccurrence: (input: OccurrenceTarget) => Promise<TaskOccurrence>;
            correctTaskOccurrenceTimes: (input: UpdateOccurrenceTimesInput) => Promise<TaskOccurrence>;
            updateTaskOccurrenceTimes: (input: UpdateOccurrenceTimesInput) => Promise<TaskOccurrence>;
        };
    }
}
