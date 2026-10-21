export interface ActualTimes { startedAt: number | null; endedAt: number | null }
export interface TimelineScale { start: number; end: number }
export type ActualEndpoint = keyof ActualTimes;
export const ACTUAL_TIME_STEP = 5 * 60_000;

function localDayBounds(timestamp: number): TimelineScale {
    const start = new Date(timestamp), end = new Date(timestamp);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 55, 0, 0);
    return { start: start.getTime(), end: end.getTime() };
}

/** A single epoch scale for both rows; never scale the bars independently. */
export function timelineScale(plannedStart: number, plannedEnd: number, actualStart: number | null, actualEnd: number | null): TimelineScale {
    const points = [plannedStart, plannedEnd, actualStart, actualEnd].filter((value): value is number => value !== null && Number.isFinite(value));
    const start = Math.min(...points), end = Math.max(...points);
    const padding = Math.max(ACTUAL_TIME_STEP, (end - start) * .08);
    // Keep existing cross-day/precise history visible, without adding padding
    // into another day or allowing repeated drags to grow the range forever.
    return { start: Math.max(localDayBounds(start).start, start - padding), end: Math.min(Math.max(end, localDayBounds(end).end), end + padding) };
}

export function timelinePosition(timestamp: number, scale: TimelineScale): number {
    return (timestamp - scale.start) / (scale.end - scale.start) * 100;
}

export function timelineBar(start: number, end: number, scale: TimelineScale) {
    return { left: timelinePosition(start, scale), width: (end - start) / (scale.end - scale.start) * 100 };
}

export function snapActualTime(timestamp: number): number { return Math.round(timestamp / ACTUAL_TIME_STEP) * ACTUAL_TIME_STEP; }

export function clampActualEndpoint(endpoint: ActualEndpoint, value: number, actual: ActualTimes): number {
    const original = actual[endpoint];
    if (original === null) return value;
    const day = localDayBounds(original);
    const minimum = endpoint === 'endedAt' && actual.startedAt !== null ? Math.max(day.start, Math.ceil(actual.startedAt / ACTUAL_TIME_STEP) * ACTUAL_TIME_STEP) : day.start;
    const maximum = endpoint === 'startedAt' && actual.endedAt !== null ? Math.min(day.end, Math.floor(actual.endedAt / ACTUAL_TIME_STEP) * ACTUAL_TIME_STEP) : day.end;
    // Imported precise records can have no valid five-minute slot on this day.
    return minimum > maximum ? original : Math.max(minimum, Math.min(maximum, value));
}

export function draggedActualTime(endpoint: ActualEndpoint, fraction: number, scale: TimelineScale, actual: ActualTimes): number {
    const snapped = snapActualTime(scale.start + Math.max(0, Math.min(1, fraction)) * (scale.end - scale.start));
    return clampActualEndpoint(endpoint, snapped, actual);
}

export function validateActualTimes(actual: ActualTimes): string | null {
    if ([actual.startedAt, actual.endedAt].some(value => value !== null && !Number.isFinite(value))) return 'Enter valid actual dates and times.';
    if (actual.endedAt !== null && actual.startedAt === null) return 'Set an actual start before setting an end.';
    if (actual.endedAt !== null && actual.startedAt !== null && actual.endedAt < actual.startedAt) return 'Actual end must be at or after actual start.';
    return null;
}

export function actualStatistics(plannedStart: number, plannedEnd: number, actual: ActualTimes) {
    const plannedDuration = plannedEnd - plannedStart;
    const actualDuration = actual.startedAt !== null && actual.endedAt !== null ? actual.endedAt - actual.startedAt : null;
    return {
        startDelta: actual.startedAt === null ? null : actual.startedAt - plannedStart,
        endDelta: actual.endedAt === null ? null : actual.endedAt - plannedEnd,
        plannedDuration,
        actualDuration,
        durationDelta: actualDuration === null ? null : actualDuration - plannedDuration,
    };
}

export interface ActualTimeOption { value: number; label: string; precise: boolean }

/** Enumerate real local instants, retaining DST overlaps and a saved sub-slot instant. */
export function localTimeOptions(date: string, exact: number | null): ActualTimeOption[] {
    const start = new Date(`${date}T00:00:00`), end = new Date(start);
    if (!Number.isFinite(start.getTime())) return [];
    end.setDate(end.getDate() + 1);
    const options: ActualTimeOption[] = [];
    const formatter = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' });
    for (let value = start.getTime(); value < end.getTime(); value += ACTUAL_TIME_STEP) {
        options.push({ value, label: formatter.format(value), precise: false });
    }
    if (exact !== null && exact >= start.getTime() && exact < end.getTime() && !options.some(option => option.value === exact)) {
        options.push({ value: exact, label: `${new Date(exact).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, fractionalSecondDigits: 3 })} (saved precise time)`, precise: true });
        options.sort((a, b) => a.value - b.value);
    }
    return options;
}
