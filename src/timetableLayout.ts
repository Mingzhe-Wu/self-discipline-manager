import { Temporal } from "@js-temporal/polyfill";
import type { ScheduledOccurrence } from "../shared/types/task";
import { occurrenceDisplayRange } from "../shared/scheduling/occurrenceDisplay";

export const MINUTES_PER_DAY = 1440;
export const PIXELS_PER_MINUTE = 2;

export interface PlannedRange { scheduledStartAt: number; scheduledEndAt: number }
export interface DisplaySegment {
    date: string;
    startMinute: number;
    endMinute: number;
    segmentStartAt: number;
    segmentEndAt: number;
}
export interface OverlapRange {
    startMinute: number;
    endMinute: number;
    /** Original boundaries, before viewer-midnight display clipping. */
    scheduledStartAt?: number;
    scheduledEndAt?: number;
    taskId?: number;
    occurrenceId?: number;
}
export interface OverlapLayout { groupSize: number; column: number; widthFraction: number; offsetFraction: number; zIndex: number }

/** Viewer wall-clock geometry for the selected display range. */
export function rangeGeometry(startMinute: number, endMinute: number, pixelsPerMinute = PIXELS_PER_MINUTE) {
    return { top: startMinute * pixelsPerMinute, height: Math.max(0, endMinute - startMinute) * pixelsPerMinute };
}

/** Rendering may enlarge short blocks; their true planned height remains available. */
export function displayRangeGeometry(startMinute: number, endMinute: number, pixelsPerMinute = PIXELS_PER_MINUTE) {
    const planned = rangeGeometry(startMinute, endMinute, pixelsPerMinute);
    return { top: planned.top, height: Math.max(15 * pixelsPerMinute, planned.height), plannedHeight: planned.height };
}

/** A saved occurrence keeps one identity even when its display spans local dates. */
export function splitDisplaySegments(range: PlannedRange, timeZone: string): DisplaySegment[] {
    if (range.scheduledEndAt <= range.scheduledStartAt) return [];
    const segments: DisplaySegment[] = [];
    let cursor = range.scheduledStartAt;
    while (cursor < range.scheduledEndAt) {
        const start = Temporal.Instant.fromEpochMilliseconds(cursor).toZonedDateTimeISO(timeZone);
        const midnight = start.toPlainDate().add({ days: 1 }).toZonedDateTime(timeZone).epochMilliseconds;
        const endAt = Math.min(midnight, range.scheduledEndAt);
        const end = Temporal.Instant.fromEpochMilliseconds(endAt).toZonedDateTimeISO(timeZone);
        const minute = (value: typeof start) => value.hour * 60 + value.minute + value.second / 60 + value.millisecond / 60000;
        const startMinute = minute(start);
        const endMinute = endAt === midnight ? MINUTES_PER_DAY : minute(end);
        // The fixed 24-hour grid cannot represent a repeated DST fold twice. If
        // wall time moves backward, show its positive elapsed length from start.
        const displayEnd = endMinute <= startMinute ? Math.min(MINUTES_PER_DAY, startMinute + (endAt - cursor) / 60000) : endMinute;
        segments.push({ date: start.toPlainDate().toString(), startMinute, endMinute: displayEnd, segmentStartAt: cursor, segmentEndAt: endAt });
        cursor = endAt;
    }
    return segments;
}

export function splitOccurrenceDisplaySegments(occurrence: ScheduledOccurrence, timeZone: string, now: number, window?: { from: number; to: number }): DisplaySegment[] {
    const range = occurrenceDisplayRange(occurrence, now);
    const start = Math.max(range.startAt, window?.from ?? -Infinity);
    const end = Math.min(Math.max(range.startAt + 1, range.endAt), window?.to ?? Infinity);
    return splitDisplaySegments({ scheduledStartAt: start, scheduledEndAt: end }, timeZone);
}

/** Connected visual intersections reuse columns as cards end. Width depends on
 * peak simultaneous occupancy, not the number of tasks connected by a long card.
 * minimumMinutes matches the short-card display floor; planned input is untouched. */
export function layoutOverlaps(ranges: readonly OverlapRange[], minimumMinutes = 0): OverlapLayout[] {
    const startOf = (index: number) => ranges[index].scheduledStartAt ?? ranges[index].startMinute;
    const endOf = (index: number) => ranges[index].scheduledEndAt ?? ranges[index].endMinute;
    const compare = (a: number, b: number) => startOf(a) - startOf(b) || endOf(a) - endOf(b) ||
        (ranges[a].taskId ?? 0) - (ranges[b].taskId ?? 0) ||
        (ranges[a].occurrenceId ?? 0) - (ranges[b].occurrenceId ?? 0) || a - b;
    const layouts: OverlapLayout[] = ranges.map(() => ({ groupSize: 1, column: 0, widthFraction: 1, offsetFraction: 0, zIndex: 1 }));
    [...ranges.keys()].sort(compare).forEach((index, rank) => { layouts[index].zIndex = rank + 1; });
    const visualOrder = [...ranges.keys()].sort((a, b) => ranges[a].startMinute - ranges[b].startMinute || compare(a, b));
    let members: number[] = [];
    let groupEnd = -Infinity;
    function finishGroup() {
        const columnEnds: number[] = [];
        const assigned = new Map<number, number>();
        // members already follows visual start order, with stable identity ties.
        for (const index of members) {
            const range = ranges[index];
            let column = columnEnds.findIndex(end => end <= range.startMinute);
            if (column === -1) column = columnEnds.length;
            columnEnds[column] = Math.max(range.endMinute, range.startMinute + minimumMinutes);
            assigned.set(index, column);
        }
        const count = columnEnds.length;
        const width = count === 1 ? 1 : 1.05 / count;
        const step = count === 1 ? 0 : (1 - width) / (count - 1);
        const columns: number[][] = Array.from({ length: count }, () => []);
        for (const index of members) columns[assigned.get(index)!].push(index);
        members.forEach(index => {
            const column = assigned.get(index)!;
            const range = ranges[index];
            const visualEnd = Math.max(range.endMinute, range.startMinute + minimumMinutes);
            let span = 1;
            for (let next = column + 1; next < count; next++) {
                const blocked = columns[next].some(other => ranges[other].startMinute < visualEnd &&
                    Math.max(ranges[other].endMinute, ranges[other].startMinute + minimumMinutes) > range.startMinute);
                if (blocked) break;
                span++;
            }
            layouts[index] = { ...layouts[index], groupSize: count, column, widthFraction: width + (span - 1) * step,
                offsetFraction: column * step };
        });
    }
    for (const index of visualOrder) {
        const range = ranges[index];
        if (members.length && range.startMinute >= groupEnd) { finishGroup(); members = []; groupEnd = -Infinity; }
        members.push(index);
        groupEnd = Math.max(groupEnd, range.endMinute, range.startMinute + minimumMinutes);
    }
    if (members.length) finishGroup();
    return layouts;
}

/** Keep the top anchored unless the expanded capsule would cross the visible bottom. */
export function hoverExpansionOffset(top: number, height: number, expandedHeight: number, visibleBottom: number) {
    return top + expandedHeight <= visibleBottom ? 0 : height - expandedHeight;
}
