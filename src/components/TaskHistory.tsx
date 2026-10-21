import { useEffect, useState } from "react";
import type { Task, TaskOccurrence } from "../../shared/types/task";
import { occurrenceState, occurrenceDuration } from "../../shared/occurrenceLifecycle";
import { errorMessage, formatDuration, formatScheduled, localDateInput, localDateTimeInput } from "../taskFormatting";
import { useToast } from "../toast";

function OccurrenceRow({ task, now, occurrence, onChange, onBusyChange }: { task: Task; now: number; occurrence: TaskOccurrence; onChange: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
    const notify = useToast();
    const initialStart = occurrence.startedAt === null ? "" : localDateTimeInput(occurrence.startedAt);
    const initialEnd = occurrence.endedAt === null ? "" : localDateTimeInput(occurrence.endedAt);
    const [start, setStart] = useState(initialStart);
    const [end, setEnd] = useState(initialEnd);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const state = occurrenceState(occurrence);
    const duration = occurrenceDuration(occurrence);
    // Unchanged minute-precision inputs must preserve the original seconds and milliseconds.
    const timestamp = (value: string, initial: string, original: number | null) => value === initial ? original : value ? new Date(value).getTime() : null;

    async function save(clear: boolean) {
        if (busy) return;
        const startedAt = clear ? null : timestamp(start, initialStart, occurrence.startedAt);
        const endedAt = clear ? null : timestamp(end, initialEnd, occurrence.endedAt);
        if ((startedAt !== null && !Number.isFinite(startedAt)) || (endedAt !== null && !Number.isFinite(endedAt))) { setError("Enter valid actual dates and times."); return; }
        if (endedAt !== null && (startedAt === null || endedAt < startedAt)) { setError("Enter a start time and an end time at or after the start."); return; }
        setBusy(true);
        onBusyChange(true);
        setError("");
        try {
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: task.id, occurrenceId: occurrence.id, startedAt, endedAt });
            await onChange();
            notify("Actual time updated");
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); onBusyChange(false); }
    }

    return (
        <li className="history-row" data-occurrence-id={occurrence.id}>
            <h4>Planned</h4>
            <p className="history-status">{formatScheduled(task, occurrence.scheduledStartAt) + " – " + formatScheduled(task, occurrence.scheduledEndAt)} — {state === "completed" ? "Completed" : state === "in-progress" ? "In progress" : occurrence.scheduledStartAt < now ? "Planned / not started" : "Upcoming"}</p>
            <h4>Actual</h4>
            <p>Start: {occurrence.startedAt === null ? state === "completed" ? "Unknown (imported record)" : "Not recorded" : new Date(occurrence.startedAt).toLocaleString()}; end: {occurrence.endedAt === null ? state === "completed" ? "Unknown (imported record)" : "Not recorded" : new Date(occurrence.endedAt).toLocaleString()}{state === "completed" && <>; duration: {duration === null ? "Unknown" : formatDuration(duration)}</>}</p>
            {occurrence.recordedAt !== null && <details><summary>Record details</summary><p className="form-hint">Recorded at: {new Date(occurrence.recordedAt).toLocaleString()}; source: {occurrence.progressSource}</p></details>}
            <div className="completion-editor">
                <label>Start time (local) <input type="datetime-local" value={start} disabled={busy} onChange={(event) => setStart(event.target.value)} /></label>
                <label>End time (local) <input type="datetime-local" value={end} disabled={busy} onChange={(event) => setEnd(event.target.value)} /></label>
                <button type="button" className="secondary-button" disabled={busy} onClick={() => void save(false)}>{state === "planned" ? "Save backfill" : "Save correction"}</button>
                {(state !== "planned" || occurrence.startedAt !== null || occurrence.endedAt !== null) && <button type="button" className="text-button" disabled={busy} onClick={() => void save(true)}>Clear times</button>}
            </div>
            {error && <p role="alert" className="notice error">{error}</p>}
        </li>
    );
}

export default function TaskHistory({ task, now, revision, disabled = false, onChange, onBusyChange }: { task: Task; now: number; revision: number; disabled?: boolean; onChange: () => Promise<void>; onBusyChange: (busy: boolean) => void }) {
    const [from, setFrom] = useState(() => localDateInput(Date.now() - 29 * 86400000));
    const [to, setTo] = useState(() => localDateInput(Date.now()));
    const [occurrences, setOccurrences] = useState<TaskOccurrence[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [refresh, setRefresh] = useState(0);
    const [saving, setSaving] = useState(false);
    function busyChanged(busy: boolean) { setSaving(busy); onBusyChange(busy); }
    useEffect(() => {
        let active = true;
        async function load() {
            try {
                const end = new Date(`${to}T00:00`);
                end.setDate(end.getDate() + 1);
                const rows = await window.electronAPI.listTaskOccurrences(task.id, new Date(`${from}T00:00`).getTime(), end.getTime());
                if (active) { setOccurrences(rows); setError(""); }
            } catch (error) { if (active) setError(errorMessage(error)); }
            finally { if (active) setLoading(false); }
        }
        void load();
        return () => { active = false; };
    }, [task.id, from, to, revision, refresh]);
    async function changed() { setRefresh((value) => value + 1); await onChange(); }
    return (
        <fieldset className="task-history" disabled={saving || disabled}>
            <legend className="sr-only">Actual occurrence times</legend>
            <p className="form-hint">History uses local date ranges. You can backfill, correct, or clear your own records.</p>
            <div className="history-range"><label>History from <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>History through <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
            {error && <p role="alert" className="notice error">{error}</p>}
            {loading ? <p role="status" className="form-hint">Loading occurrences…</p> : occurrences.length === 0 ? <p className="notice">No occurrences in this range.</p> : (
                <ul className="history-list">{occurrences.map((occurrence) => <OccurrenceRow key={`${occurrence.id}:${occurrence.updatedAt}:${occurrence.recordedAt}:${occurrence.startedAt}:${occurrence.endedAt}:${occurrence.legacyCompleted}`} task={task} now={now} occurrence={occurrence} onChange={changed} onBusyChange={busyChanged} />)}</ul>
            )}
        </fieldset>
    );
}


