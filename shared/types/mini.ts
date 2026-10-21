import type { ScheduledOccurrence, Task, WeekSchedule } from "./task";

export interface MiniTaskDetails { task: Task; occurrence: ScheduledOccurrence }
export type MiniResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export interface MiniPointer { x: number; y: number }

export interface MiniToday extends WeekSchedule { now: number; date: string; timeZone: string }
export interface MiniWindowState {
    mode: "ball" | "expanded" | "docked";
    edge: "left" | "right" | null;
}
