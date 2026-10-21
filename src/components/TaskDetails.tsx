import { useId, useRef, useState } from "react";
import type { CreateTaskInput, ScheduledOccurrence, Task, TaskDeletionReceipt } from "../../shared/types/task";
import type { PlanningHours } from "../../shared/types/settings";
import TaskForm from "./TaskForm";
import { errorMessage } from "../taskFormatting";
import ActualTimelineEditor from "./ActualTimelineEditor";
import { useToast } from "../toast";
import Icon from "./Icon";
import "./TaskDetails.css";
import { canLateStart, occurrenceState } from "../../shared/occurrenceLifecycle";

export default function TaskDetails({ task, occurrence, now, onChange, onClose, onSave, planningHours, onBusyChange, onDetached, onLateStarted }: {
    task: Task; occurrence?: ScheduledOccurrence; now: number; revision: number; onChange: () => Promise<void>; onClose: (receipt: TaskDeletionReceipt) => void; onSave?: (input: CreateTaskInput, sync?: boolean) => Promise<void>; planningHours?: PlanningHours; onBusyChange: (busy: boolean) => void; onDetached?: (taskId: number) => void; onLateStarted?: (task: Task) => void;
}) {
    const notify = useToast();
    const formId = useId();
    const [editing, setEditing] = useState(false);
    const closingEdit = useRef(false);
    const [metadataBusy, setMetadataBusy] = useState(false);
    const [error, setError] = useState("");
    const [deleting, setDeleting] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [actualBusy, setActualBusy] = useState(false);
    function actualBusyChanged(busy: boolean) { setActualBusy(busy); onBusyChange(busy || metadataBusy); }
    const [startingLate, setStartingLate] = useState(false);
    const pending = deleting || actualBusy || metadataBusy || startingLate;
    const actual = occurrence ? occurrence.record : task.currentOccurrence;
    const comparison = occurrence ?? { taskId: task.id, scheduledStartAt: actual?.scheduledStartAt ?? task.scheduledStartAt, scheduledEndAt: actual?.scheduledEndAt ?? task.scheduledEndAt, record: actual };
    const missed = occurrenceState(actual, now, comparison.scheduledEndAt) === "missed";
    const todayMissed = missed && canLateStart(comparison.scheduledStartAt, now, Intl.DateTimeFormat().resolvedOptions().timeZone);
    async function startLate() {
        if (pending || startingLate) return;
        setStartingLate(true); onBusyChange(true); setError("");
        try {
            const saved = await window.electronAPI.lateStartTaskOccurrence(actual ? { taskId: task.id, occurrenceId: actual.id } : { taskId: task.id, scheduledStartAt: comparison.scheduledStartAt, scheduledEndAt: comparison.scheduledEndAt });
            onLateStarted?.(saved);
            notify(`New task started late · Planned ${new Date(saved.scheduledStartAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
            try { await onChange(); }
            catch { notify("New task started. Refresh the timetable if it has not appeared yet."); }
        } catch (error) { setError(errorMessage(error)); }
        finally { setStartingLate(false); onBusyChange(false); }
    }
    async function remove() {
        if (pending) return;
        setDeleting(true);
        onBusyChange(true);
        setError("");
        try { const receipt = await window.electronAPI.deleteTask(task.id); onClose(receipt); }
        catch (error) { setError(errorMessage(error)); }
        finally { setDeleting(false); onBusyChange(false); }
    }
    return (
        <section className="task-details">
            {missed && <div className="missed-detail-notice"><div><strong>Missed</strong><p>The original planned occurrence was not started. Correct actual times below{todayMissed ? ", or start a new one-time task now." : "."}</p></div>{todayMissed && <button type="button" className="secondary-button" disabled={pending || startingLate} onClick={() => void startLate()}>{startingLate ? "Starting…" : "Start late"}</button>}</div>}
            <div className="detail-summary">
                <ActualTimelineEditor occurrence={comparison} disabled={deleting || metadataBusy || confirmDelete || startingLate} onChange={onChange} onBusyChange={actualBusyChanged} onSuccess={notify} onSave={task.scheduleType === "recurring" ? (input) => window.electronAPI.correctTaskOccurrenceTimes(input) : undefined} onDetached={onDetached}
                    information={<TaskForm key={editing ? "edit" : "view"} task={task} occurrence={occurrence} planningHours={planningHours} formId={formId} readOnly={!editing} hideActions autoSave disabled={deleting || actualBusy || confirmDelete || startingLate} onSave={async (input, sync) => {
                        if (!onSave) return;
                        setMetadataBusy(true); onBusyChange(true);
                        try { await onSave(input, sync); }
                        finally { setMetadataBusy(false); onBusyChange(false); }
                    }} onSaveIdle={() => { if (closingEdit.current) { closingEdit.current = false; setEditing(false); notify("Task saved."); } }} onSaveError={() => { closingEdit.current = false; }} onCancel={() => {}} />}
                    informationActions={<div className="detail-edit-controls">
                        <span className="form-hint">{editing ? "Changes save automatically" : "Edit task information"}</span>
                        <label className="notification-field detail-edit-switch"><span>Edit</span><input role="switch" aria-label="Edit task information" className="switch-input" type="checkbox" checked={editing} disabled={deleting || actualBusy || confirmDelete} onChange={(event) => {
                            if (event.target.checked) { closingEdit.current = false; setEditing(true); }
                            else { closingEdit.current = true; (document.getElementById(formId) as HTMLFormElement | null)?.requestSubmit(); }
                        }} /><span className="switch-track" aria-hidden="true" /></label>
                    </div>}
                />
                {task.scheduleType === "recurring" && <p className="form-hint actual-detach-hint">Correcting actual times detaches only this occurrence from the series.</p>}
            </div>
            {task.origin === "legacy-task" && <p className="notice">This task was imported without original schedule or creation timestamps. Its initial occurrence uses the migration date; later schedule edits apply going forward. The original placeholder alert stays suppressed.</p>}
            {error && <p role="alert" className="notice error">{error}</p>}
            <div className="detail-footer">{confirmDelete ? <section aria-label="Confirm task deletion" className="notice">
                <p>{task.scheduleType === "recurring" ? `Delete recurring task “${task.title}”?` : `Delete “${task.title}”?`}</p>
                <p>{task.scheduleType === "recurring" ? "This removes the entire recurring series from the schedule and stops its notifications." : "This removes the task from the schedule and stops its notifications."} Saved occurrence history remains stored.</p>
                <div className="form-actions"><button type="button" className="secondary-button" disabled={pending} onClick={() => { setConfirmDelete(false); setError(""); }}>Cancel</button><button type="button" className="danger-button" disabled={pending} onClick={() => void remove()}>{deleting ? "Deleting…" : "Confirm delete"}</button></div>
            </section> : <button type="button" className="danger-button" disabled={pending} onClick={() => setConfirmDelete(true)}><Icon name="trash" />Delete task</button>}</div>
        </section>
    );
}

