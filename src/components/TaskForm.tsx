import { TASK_CATEGORIES, categoryMetadata } from "../../shared/taskCategories";
import type { TaskCategory } from "../../shared/taskCategories";
import { useEffect, useRef, useState } from "react";
import { occurrenceState } from "../../shared/occurrenceLifecycle";
import { Temporal } from "@js-temporal/polyfill";
import type { CreateTaskInput, ScheduledOccurrence, Task } from "../../shared/types/task";
import type { PlanningHours } from "../../shared/types/settings";
import { DEFAULT_PLANNING_HOURS, assertPlanningRange } from "../../shared/scheduling/planningHours";
import { defaultEndTime, moveStartTime } from "../taskFormTimes";
import { errorMessage, localDateInput } from "../taskFormatting";
import type { QuickAddDraft } from "../timetableQuickAdd";
import Icon from "./Icon";

const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const timeOptions = Array.from({ length: 288 }, (_, index) => `${String(Math.floor(index / 12)).padStart(2, "0")}:${String(index % 12 * 5).padStart(2, "0")}`);

export default function TaskForm({ task, occurrence, initialPlan, defaultDurationMinutes = 60, planningHours = DEFAULT_PLANNING_HOURS, onSave, onCancel, readOnly = false, disabled = false, formId, hideActions = false, autoSave = false, onSaveIdle, onSaveError }: { task?: Task; occurrence?: ScheduledOccurrence; initialPlan?: QuickAddDraft; defaultDurationMinutes?: number; planningHours?: PlanningHours; onSave: (input: CreateTaskInput, sync?: boolean) => Promise<void>; onCancel: () => void; readOnly?: boolean; disabled?: boolean; formId?: string; hideActions?: boolean; autoSave?: boolean; onSaveIdle?: () => void; onSaveError?: () => void }) {
    const timeZone = task?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const initialStart = task ? Temporal.Instant.fromEpochMilliseconds(occurrence?.scheduledStartAt ?? task.scheduledStartAt).toZonedDateTimeISO(timeZone) : null;
    const initialEnd = task ? Temporal.Instant.fromEpochMilliseconds(occurrence?.scheduledEndAt ?? task.scheduledEndAt).toZonedDateTimeISO(timeZone) : null;
    const [createdAt] = useState(Date.now);
    const initialDate = initialStart?.toPlainDate().toString() ?? initialPlan?.date ?? localDateInput(createdAt);
    const seriesRule = !occurrence ? task?.recurrenceRule : undefined;
    const initialStartTime = seriesRule?.startTime ?? initialStart?.toPlainTime().toString({ smallestUnit: initialStart.second || initialStart.millisecond ? "millisecond" : "minute" }) ?? initialPlan?.startTime ?? (planningHours.wakeTime <= "09:00" && planningHours.sleepTime > "10:00" ? "09:00" : planningHours.wakeTime);
    const initialEndTime = seriesRule?.endTime ?? initialEnd?.toPlainTime().toString({ smallestUnit: initialEnd.second || initialEnd.millisecond ? "millisecond" : "minute" }) ?? initialPlan?.endTime ?? defaultEndTime(initialStartTime, defaultDurationMinutes);
    const [category, setCategory] = useState<TaskCategory>(categoryMetadata(task?.category).key);
    const [title, setTitle] = useState(task?.title ?? "");
    const [scheduleType, setScheduleType] = useState<"one-time" | "recurring">(task?.scheduleType ?? "one-time");
    const [date, setDate] = useState(initialDate);
    const [startTime, setStartTime] = useState(initialStartTime);
    const [endTime, setEndTime] = useState(initialEndTime);
    const [manualEndEdit, setManualEndEdit] = useState(false);
    const [sync, setSync] = useState(true);
    const [frequency, setFrequency] = useState<"daily" | "weekly">(task?.recurrenceRule?.frequency ?? "daily");
    const [startDate, setStartDate] = useState(() => task?.recurrenceRule?.startDate ?? initialDate);
    const [days, setDays] = useState<number[]>(task?.recurrenceRule?.weekdays ?? [1]);
    const [enabled, setEnabled] = useState(task?.enabled ?? true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const form = useRef<HTMLFormElement>(null);
    const saveTimer = useRef<number | null>(null);
    const pending = useRef(false);
    const editVersion = useRef(0);
    const savedVersion = useRef(0);
    useEffect(() => () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); }, []);
    useEffect(() => {
        if (autoSave && !disabled && editVersion.current > savedVersion.current) {
            saveTimer.current = window.setTimeout(() => form.current?.requestSubmit(), 400);
        }
        return () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); };
    }, [autoSave, disabled]);
    const typeLocked = task?.scheduleType === "one-time" && task.currentOccurrence?.scheduledStartAt === task.scheduledStartAt && occurrenceState(task.currentOccurrence) !== "planned";
    const recurringSelection = task?.scheduleType === "recurring" && occurrence !== undefined;
    const hasActualHistory = recurringSelection && occurrence.record !== null && (occurrence.record.startedAt !== null || occurrence.record.endedAt !== null || occurrence.record.legacyCompleted);
    const detached = recurringSelection && !sync;
    const effectiveScheduleType = detached ? "one-time" : scheduleType;
    const originalRule = task?.recurrenceRule;
    const unchangedSchedule = task && !detached && scheduleType === task.scheduleType && startTime === initialStartTime && endTime === initialEndTime && (scheduleType === "one-time" ? date === initialDate : originalRule && frequency === originalRule.frequency && startDate === originalRule.startDate && [...days].sort().join() === [...originalRule.weekdays].sort().join());

    async function submit(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (pending.current || disabled) return;
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        if (autoSave && editVersion.current === savedVersion.current) { onSaveIdle?.(); return; }
        pending.current = true;
        const version = editVersion.current;
        let succeeded = false;
        setBusy(true);
        setError("");
        try {
            if (!title.trim()) throw new Error("Enter a task title.");
            if (effectiveScheduleType === "recurring" && frequency === "weekly" && days.length === 0) throw new Error("Choose at least one weekday.");
            if (!unchangedSchedule && (endTime >= "24:00" || endTime <= startTime)) throw new Error("End Time must be after Start Time on the same day. Choose an earlier start or end.");
            if (!unchangedSchedule && (!timeOptions.includes(startTime) || !timeOptions.includes(endTime))) throw new Error("Choose start and end times in five-minute steps.");
            const plannedAt = (time: string) => Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timeZone).epochMilliseconds;
            if (!unchangedSchedule) assertPlanningRange(plannedAt(startTime), plannedAt(endTime), timeZone, planningHours);
            const input: CreateTaskInput = effectiveScheduleType === "one-time"
                ? { title, scheduleType: "one-time", scheduledStartAt: unchangedSchedule ? task!.scheduledStartAt : plannedAt(startTime), scheduledEndAt: unchangedSchedule ? task!.scheduledEndAt : plannedAt(endTime), timeZone, enabled }
                : { title, scheduleType: "recurring", enabled, recurrenceRule: unchangedSchedule ? originalRule! : { frequency, startDate: recurringSelection ? originalRule!.startDate : startDate, startTime, endTime, timeZone, weekdays: frequency === "weekly" ? days : [] } };
            if (input.scheduleType === "one-time" && !typeLocked && !unchangedSchedule && input.scheduledStartAt < Date.now()) throw new Error("A one-time task must start in the future.");
            input.category = category;
            await onSave(input, recurringSelection ? sync : undefined);
            savedVersion.current = version;
            succeeded = true;
            if (!task) setTitle("");
        } catch (error) { setError(errorMessage(error)); onSaveError?.(); }
        finally {
            pending.current = false;
            setBusy(false);
            if (autoSave && editVersion.current > version) saveTimer.current = window.setTimeout(() => form.current?.requestSubmit(), 0);
            else if (succeeded) onSaveIdle?.();
        }
    }
    const startOptions = timeOptions;
    const endOptions = timeOptions;
    const options = (value: string, allowed: string[]) => <>{!allowed.includes(value) && <option value={value}>{value === "" ? "Choose time" : <>{value}{task && (value === initialStartTime || value === initialEndTime) ? " (saved)" : ""}</>}</option>}{allowed.map((time) => <option key={time} value={time}>{time}</option>)}</>;

    if (readOnly && task) {
        const metadata = categoryMetadata(task.category), rule = task.recurrenceRule;
        const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return <div className="task-information-text">
            <h3>{task.title}</h3>
            <dl className="detail-facts">
                <div><dt><Icon name="tag" />Category</dt><dd><span className="detail-category-badge">{metadata.emoji} {metadata.label}</span></dd></div>
                <div><dt><Icon name="calendar" />Schedule</dt><dd>{rule ? `${rule.frequency === "daily" ? "Daily" : `Weekly · ${rule.weekdays.map(day => dayNames[day]).join(", ")}`} · ${rule.startTime}–${rule.endTime}` : "One-time"}</dd></div>
                <div><dt><Icon name="bell" />Notifications</dt><dd>{task.enabled ? "On" : "Off"}</dd></div>
                {timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <div><dt>Schedule zone</dt><dd>{timeZone}</dd></div>}
            </dl>
        </div>;
    }

    return (
        <form ref={form} id={formId} noValidate={autoSave} onSubmit={submit} className={`task-form${hideActions ? " inline-task-form" : ""}`} onChangeCapture={(event) => {
            if (!autoSave || (event.target instanceof HTMLInputElement && event.target.closest(".sync-occurrences-field"))) return;
            editVersion.current++;
            if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => form.current?.requestSubmit(), 400);
        }}>
            <fieldset disabled={disabled || (!autoSave && busy)}>
                <legend className="sr-only">{task ? "Edit Task" : "New Task"}</legend>
                <label>Title<input aria-label="Task title" data-initial-focus required placeholder="What would you like to do?" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label>Category<select aria-label="Category" value={category} onChange={(event) => setCategory(event.target.value as TaskCategory)}>{TASK_CATEGORIES.map((item) => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}</select></label>
                {recurringSelection && <label className="sync-occurrences-field"><input type="checkbox" checked={sync} onChange={(event) => setSync(event.target.checked)} /><span>Sync changes to other occurrences</span></label>}
                {hasActualHistory && <p className="form-hint">An independent edit creates a fresh one-time plan. Existing actual timing stays in the original task’s History and is not copied.</p>}
                <fieldset className="schedule-fields">
                    <legend className="sr-only">Schedule</legend>
                    {!recurringSelection && <label>Schedule type<select aria-label="Schedule type" disabled={typeLocked} value={scheduleType} onChange={(event) => setScheduleType(event.target.value as typeof scheduleType)}>
                        <option value="one-time">One-time</option><option value="recurring">Recurring</option>
                    </select></label>}
                    {effectiveScheduleType === "one-time" ? (
                        <label className="schedule-date">Date<input aria-label="Date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></label>
                    ) : (
                        <>
                            <label className="schedule-time-field">Recurrence<select aria-label="Repeat" value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}>
                                <option value="daily">Daily</option><option value="weekly">Weekly</option>
                            </select></label>
                            {!recurringSelection && <label>Start date<input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>}
                        </>
                    )}
                    <label className="schedule-time-field">Start Time<select aria-label="Start Time" required value={startTime} onChange={(event) => { const next = event.target.value; setEndTime(moveStartTime(startTime, endTime, next, manualEndEdit)); setStartTime(next); }}>{options(startTime, startOptions)}</select></label>
                    <label className="schedule-time-field">End Time<select aria-label="End Time" required value={endTime} onChange={(event) => { setEndTime(event.target.value); setManualEndEdit(true); }}>{options(endTime, endOptions)}</select></label>
                    {effectiveScheduleType === "recurring" && frequency === "weekly" && <fieldset className="weekday-fields">
                        <legend>Weekdays</legend>
                        {weekdays.map((day, index) => {
                            const value = (index + 1) % 7;
                            return <label key={day} className="weekday-option"><input aria-label={day} type="checkbox" checked={days.includes(value)} onChange={() => setDays((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} /><span>{day.slice(0, 3)}</span></label>;
                        })}
                    </fieldset>}
                </fieldset>
                {typeLocked && <p className="form-hint">You can correct planned times without changing actual records. A started or finished task stays one-time.</p>}
                {task && !typeLocked && <p className="form-hint">Schedule changes apply going forward. Existing history is kept.</p>}
                {timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <p className="form-hint">Schedule time uses {timeZone}. The week displays local time.</p>}
                <label className="notification-field"><span>Notifications enabled</span><input className="switch-input" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span className="switch-track" aria-hidden="true" /></label>
                {error && <p role="alert" className="notice error">{error}</p>}
                {autoSave && busy && <p role="status" className="form-hint">Saving changes…</p>}
                {!hideActions && <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">{busy ? "Saving…" : task ? "Save Task" : "Create Task"}</button></div>}
            </fieldset>
        </form>
    );
}
