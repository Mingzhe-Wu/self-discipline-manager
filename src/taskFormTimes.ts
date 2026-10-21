const minutes = (time: string) => { const [hour, minute] = time.split(':').map(Number); return hour * 60 + minute; };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** Preserve an overflowing hour so the form can reject it instead of wrapping to tomorrow. */
export function defaultEndTime(start: string, durationMinutes = 60): string { return clock(minutes(start) + durationMinutes); }

export function moveStartTime(start: string, end: string, nextStart: string, manuallyEditedEnd: boolean): string {
    if (end === '') return '';
    return manuallyEditedEnd ? end : clock(minutes(nextStart) + minutes(end) - minutes(start));
}
