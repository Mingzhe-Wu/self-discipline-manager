import { useToast } from "./toast";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CreateTaskInput, ScheduledOccurrence, WeekSchedule as WeekData } from "../shared/types/task";
import { shiftWeek, weekRange } from "../shared/scheduling/week";
import TaskForm from "./components/TaskForm";
import WeekSchedule from "./components/WeekSchedule";
import TaskDetails from "./components/TaskDetails";
import Dialog from "./components/Dialog";
import Icon from "./components/Icon";
import { errorMessage } from "./taskFormatting";

import type { PlanningHours } from "../shared/types/settings";
import { DEFAULT_PLANNING_HOURS } from "../shared/scheduling/planningHours";
import PlanningSettings from "./components/PlanningSettings";
import type { QuickAddDraft } from "./timetableQuickAdd";

type View = { kind: "add"; draft?: QuickAddDraft } | { kind: "manage" | "settings" } | { kind: "details"; taskId: number; occurrence?: ScheduledOccurrence } | null;

export default function App() {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const [from, setFrom] = useState(() => weekRange(Date.now(), timeZone).from);
    const [data, setData] = useState<WeekData>({ tasks: [], occurrences: [] });
    const [loadedFrom, setLoadedFrom] = useState<number | null>(null);
    const [error, setError] = useState("");
    const notify = useToast();
    const [centerRevision, setCenterRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [view, setView] = useState<View>(null);
    const quickAdd = useCallback((draft: QuickAddDraft) => setView((current) => current ?? { kind: "add", draft }), []);
    const [planningHours, setPlanningHours] = useState<PlanningHours>(DEFAULT_PLANNING_HOURS);
    const [showRevision, setShowRevision] = useState(0);
    const [saving, setSaving] = useState(false);
    const addButton = useRef<HTMLButtonElement>(null);
    const [revision, setRevision] = useState(0);
    const [now, setNow] = useState(Date.now);
    useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
    const loadVersion = useRef(0);
    const pendingWindowCenter = useRef(false);
    const to = shiftWeek(from, 1, timeZone);
    const requestedRange = useRef({ from, to });
    const reload = useCallback(async () => {
        const version = ++loadVersion.current;
        const range = requestedRange.current;
        const [loaded, hours] = await Promise.all([window.electronAPI.getWeekSchedule(range.from, range.to), window.electronAPI.getPlanningHours()]);
        if (version === loadVersion.current) {
            setData(loaded); setPlanningHours(hours); setLoadedFrom(range.from); setNow(Date.now()); setError(""); setRevision((value) => value + 1);
            if (pendingWindowCenter.current) { pendingWindowCenter.current = false; setShowRevision((value) => value + 1); }
        }
    }, []);
    useEffect(() => {
        let active = true;
        async function refresh() {
            try { await reload(); }
            catch (error) { if (active) setError(errorMessage(error)); }
            finally { if (active) setLoading(false); }
        }
        void refresh();
        const timer = window.setInterval(() => void refresh(), 60_000);
        window.addEventListener("focus", refresh);
        return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
    }, [reload, from]);
    useEffect(() => window.electronAPI.onWindowShown(() => {
        pendingWindowCenter.current = true;
        setNow(Date.now());
        void reload().catch((error) => { pendingWindowCenter.current = false; setError(errorMessage(error)); });
    }), [reload]);
    function navigate(next: number) {
        if (next === from) return;
        ++loadVersion.current;
        requestedRange.current = { from: next, to: shiftWeek(next, 1, timeZone) };
        setFrom(next);
    }
    function thisWeek() {
        setCenterRevision((value) => value + 1);
        navigate(weekRange(Date.now(), timeZone).from);
    }
    async function create(input: CreateTaskInput) {
        setSaving(true);
        try {
            const task = await window.electronAPI.createTask(input);
            const target = weekRange(task.scheduleType === "one-time" ? task.scheduledStartAt : Math.max(Date.now(), task.scheduledStartAt), timeZone).from;
            if (target !== from) navigate(target);
            else { try { await reload(); } catch (error) { setError(errorMessage(error)); } }
            setView(null);
            notify("Task created.");
        } finally { setSaving(false); }
    }
    async function save(taskId: number, input: CreateTaskInput, sync?: boolean) {
        setSaving(true);
        try {
            const context = view && "occurrence" in view ? view.occurrence : undefined;
            const saved = context && sync !== undefined ? await window.electronAPI.updateTaskOccurrencePlan({
                target: context.record ? { taskId, occurrenceId: context.record.id } : { taskId, scheduledStartAt: context.scheduledStartAt, scheduledEndAt: context.scheduledEndAt },
                changes: input, sync,
            }) : await window.electronAPI.updateTask(taskId, input);
            await reload();
            const original = data.tasks.find(task => task.id === taskId);
            const scheduleChanged = original?.scheduleType !== saved.scheduleType || original?.scheduledStartAt !== saved.scheduledStartAt || original?.scheduledEndAt !== saved.scheduledEndAt || JSON.stringify(original?.recurrenceRule) !== JSON.stringify(saved.recurrenceRule);
            setView(current => !scheduleChanged && current?.kind === "details" && current.taskId === saved.id ? current : { kind: "details", taskId: saved.id });
        } finally { setSaving(false); }
    }
    async function savePlanningHours(hours: PlanningHours) {
        setSaving(true);
        try {
            setPlanningHours(await window.electronAPI.updatePlanningHours(hours));
            setView(null);
            notify("Planning hours saved.");
        } finally { setSaving(false); }
    }
    const selected = view && "taskId" in view ? data.tasks.find((task) => task.id === view.taskId) : undefined;
    const selectedContext = view && "occurrence" in view ? view.occurrence : undefined;
    const selectedOccurrence = selectedContext ? data.occurrences.find((row) => row.taskId === selectedContext.taskId && row.scheduledStartAt === selectedContext.scheduledStartAt && row.scheduledEndAt === selectedContext.scheduledEndAt) ?? selectedContext : undefined;
    const recurringTasks = data.tasks.filter(task => task.scheduleType === "recurring");
    const currentWeek = from === weekRange(now, timeZone).from;
    const dateLabel = `${new Date(from).toLocaleDateString([], { month: "long", day: "numeric" })} – ${new Date(to - 1).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    return (
        <main className="app-shell">
            <div className="workspace">
                <nav className="week-toolbar" aria-label="Week navigation">
                    <div className="week-caption"><h2>Weekly schedule</h2><p>{dateLabel}</p></div>
                    <div className="week-controls"><div className="week-navigation">
                        <button type="button" className="icon-button" aria-label="Previous week" title="Previous week" onClick={() => navigate(shiftWeek(from, -1, timeZone))}><Icon name="chevron-left" /></button>
                        <button type="button" className="secondary-button" aria-current={currentWeek ? "date" : undefined} onClick={thisWeek}>This week</button>
                        <button type="button" className="icon-button" aria-label="Next week" title="Next week" onClick={() => navigate(to)}><Icon name="chevron-right" /></button>
                    </div><select aria-label="Completion filter" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All tasks</option><option value="incomplete">Incomplete</option><option value="completed">Completed</option></select><button type="button" className="secondary-button" onClick={() => setView({ kind: "settings" })}>Planning hours</button><button ref={addButton} type="button" className="primary-button" onClick={() => setView({ kind: "add" })} aria-label="Add Task"><Icon name="plus" />Add Task</button></div>
                </nav>
                {error && <div role="alert" className="notice error app-notice"><div><strong>Couldn’t load your week.</strong><p>Try again in a moment.</p><details className="error-details"><summary>More information</summary><p>{error}</p></details></div><button type="button" onClick={() => { void reload().catch((error) => setError(errorMessage(error))); }}>Try again</button></div>}
                {loading ? <div className="loading-state" role="status"><Icon name="calendar" /><p>Loading your week…</p></div> : <>
                    <WeekSchedule from={from} tasks={data.tasks} occurrences={data.occurrences} now={now} timeZone={timeZone} filter={filter} planningHours={planningHours} showRevision={showRevision} centerRevision={centerRevision} dataReady={loadedFrom === from} onQuickAdd={quickAdd} quickAddEnabled={view === null} onChange={reload} onSelect={(taskId, occurrence) => setView({ kind: "details", taskId, occurrence })} />
                    {data.occurrences.length === 0 && <div className="empty-week"><p>{data.tasks.length === 0 ? "Your week starts here." : "Nothing scheduled this week."}</p><span>{data.tasks.length === 0 ? "Add a task to give your plans a place." : "Choose another week or add a task."}</span></div>}
                </>}
                <footer className="workspace-footer"><button type="button" className="text-button" onClick={() => setView({ kind: "manage" })}>Manage recurring tasks</button></footer>
            </div>
            {view?.kind === "add" && <Dialog key="add" title="Add Task" busy={saving} fallbackFocus={addButton} onClose={() => setView(null)}><TaskForm initialPlan={view.draft} planningHours={planningHours} onSave={create} onCancel={() => setView(null)} /></Dialog>}
            {view?.kind === "details" && selected && <Dialog key={`details:${selected.id}`} title="Task details" busy={saving} fallbackFocus={addButton} panel closeLabel="Close details" onClose={() => setView(null)}><TaskDetails task={selected} occurrence={selectedOccurrence} now={now} revision={revision} onChange={reload} onBusyChange={setSaving} onDetached={(taskId) => setView({ kind: "details", taskId })} onClose={(receipt) => {
                setView(null);
                notify("Task Deleted", { expiresAt: receipt.expiresAt, action: { label: "Undo", run: async () => {
                    await window.electronAPI.undoTaskDeletion(receipt.undoToken);
                    try { await reload(); } catch (error) { setError(errorMessage(error)); }
                    notify("Task restored.");
                } } });
                void reload().catch((error) => setError(errorMessage(error)));
            }} planningHours={planningHours} onSave={(input, sync) => save(selected.id, input, sync)} /></Dialog>}
            {view?.kind === "settings" && <Dialog title="Planning hours" busy={saving} fallbackFocus={addButton} onClose={() => setView(null)}><PlanningSettings settings={planningHours} onSave={savePlanningHours} onCancel={() => setView(null)} /></Dialog>}
            {view?.kind === "manage" && <Dialog key="manage" title="Manage recurring tasks" fallbackFocus={addButton} onClose={() => setView(null)}><div className="task-picker">{recurringTasks.length === 0 ? <div className="empty-list"><p>No recurring tasks yet.</p><button className="primary-button" type="button" onClick={() => setView({ kind: "add" })}>Add Task</button></div> : <><p className="form-hint">Recurring series, including those outside this week.</p><ul>{recurringTasks.map((task) => <li key={task.id}><button type="button" onClick={() => setView({ kind: "details", taskId: task.id })}><span>{task.title}</span><Icon name="chevron-right" /></button></li>)}</ul></>}</div></Dialog>}
        </main>
    );
}
