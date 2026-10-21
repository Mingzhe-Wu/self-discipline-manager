export const SCHEDULER_POLL_MS = 30_000;
/** Latest relevant slot only; final slot includes thirty seconds of polling grace. */
export function reminderSlotAt(scheduledAt: number, now: number): number | null {
    const minutes = (now - scheduledAt) / 60_000;
    if (minutes < -5 || minutes >= 15.5) return null;
    if (minutes < 0) return -5;
    return Math.min(15, Math.floor(minutes / 3) * 3);
}
