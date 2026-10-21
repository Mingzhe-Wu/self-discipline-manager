import type { PlanningHours } from "../shared/types/settings";

export interface QuickAddDraft { date: string; startTime: string; endTime: string }
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

/** Offset is relative to the timeline itself; scrolling needs no extra correction. */
export function quickAddDraft(date: string, offsetPixels: number, density: number, origin: number, hours: PlanningHours): QuickAddDraft | null {
    if (!Number.isFinite(offsetPixels) || !Number.isFinite(density) || density <= 0) return null;
    const minute = origin + offsetPixels / density;
    const wake = minutes(hours.wakeTime);
    // The existing same-day form offers end times through 23:55.
    const latestEnd = Math.min(minutes(hours.sleepTime), 1435);
    if (minute < wake || minute >= latestEnd) return null;
    const start = Math.round(minute / 5) * 5;
    if (start < wake || start >= latestEnd) return null;
    return { date, startTime: clock(start), endTime: clock(Math.min(start + 60, latestEnd)) };
}
