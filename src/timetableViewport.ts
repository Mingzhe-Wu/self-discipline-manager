import { Temporal } from "@js-temporal/polyfill";

export const TIMETABLE_HEADER_HEIGHT = 76;
export const VISIBLE_PLANNING_MINUTES = 480;

/** Eight wall-clock hours fit the available scrollport, not the whole planning day. */
export function viewportDensity(viewportHeight: number, headerHeight = TIMETABLE_HEADER_HEIGHT) {
    return Math.max(0.25, (viewportHeight - headerHeight - 16) / VISIBLE_PLANNING_MINUTES);
}

export function localMinute(timestamp: number, timeZone: string) {
    const time = Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(timeZone);
    return time.hour * 60 + time.minute + time.second / 60;
}

export function currentTimePosition(timestamp: number, timeZone: string, startMinute: number, endMinute: number, density: number) {
    const minute = localMinute(timestamp, timeZone);
    return { top: (minute - startMinute) * density, visible: minute >= startMinute && minute <= endMinute };
}

export function centeredScrollTop(minute: number, startMinute: number, endMinute: number, density: number, viewportHeight: number, headerHeight = TIMETABLE_HEADER_HEIGHT) {
    const visible = Math.max(0, viewportHeight - headerHeight);
    const offset = (Math.max(startMinute, Math.min(endMinute, minute)) - startMinute) * density;
    return Math.max(0, Math.min(Math.max(0, (endMinute - startMinute) * density - visible), offset - visible / 2));
}

export function timelineTicks(start: number, end: number) {
    const ticks = [start];
    for (let minute = Math.ceil((start + 1) / 120) * 120; minute < end; minute += 120) ticks.push(minute);
    if (end !== start) ticks.push(end);
    return ticks;
}
