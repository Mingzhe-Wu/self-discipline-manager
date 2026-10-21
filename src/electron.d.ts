import type { TaskDeletionReceipt, ResizeOccurrenceInput, OccurrenceTarget, UpdateOccurrenceTimesInput, UpdateOccurrencePlanInput, CreateTaskInput, Task, TaskOccurrence, WeekSchedule } from "../shared/types/task";
import type { PlanningHours } from "../shared/types/settings";
export {};

declare global {
    interface Window {
        electronAPI: {
            getPlanningHours: () => Promise<PlanningHours>;
            updatePlanningHours: (input: PlanningHours) => Promise<PlanningHours>;
            resizeTaskOccurrence: (input: ResizeOccurrenceInput) => Promise<TaskOccurrence>;
            updateTaskOccurrencePlan: (input: UpdateOccurrencePlanInput) => Promise<Task>;
            onWindowShown: (callback: () => void) => () => void;
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
