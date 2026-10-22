const minutes = (time: string): number | null => {
    if (!/^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(time)) return null;
    const [hour, minute] = time.split(':').map(Number);
    return minute < 60 ? hour * 60 + minute : null;
};
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Preserve an overflowing hour so the form can reject it instead of wrapping to tomorrow. */
export function defaultEndTime(start: string, durationMinutes = 60): string {
    const startMinutes = minutes(start);
    return startMinutes === null ? '' : clock(startMinutes + durationMinutes);
}

export function moveStartTime(start: string, end: string, nextStart: string, manuallyEditedEnd: boolean): string {
    if (manuallyEditedEnd || end === '') return end;
    const nextMinutes = minutes(nextStart);
    if (nextMinutes === null) return '';
    const startMinutes = minutes(start), endMinutes = minutes(end);
    return startMinutes === null || endMinutes === null ? end : clock(nextMinutes + endMinutes - startMinutes);
}
