import { useEffect, useState } from "react";
import type { WeekSchedule } from "../../shared/types/task";
import { TASK_CATEGORIES, categoryMetadata, type TaskCategory } from "../../shared/taskCategories";
import { occurrenceState } from "../../shared/occurrenceLifecycle";
import { errorMessage } from "../taskFormatting";
import { filterTaskCenterEntries, taskCenterEntries, toggleTaskCenterFilter } from "../taskCenter";
import type { TaskCenterEntry, TaskCenterFilter } from "../taskCenter";

export default function TaskCenter({ now, onSelect }: { now: number; onSelect: (entry: TaskCenterEntry) => void }) {
    const [filter, setFilter] = useState<TaskCenterFilter>("all");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<TaskCategory | "all">("all");
    const [data, setData] = useState<WeekSchedule | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        window.electronAPI.getMissedTasks().then(data => { if (active) { setData(data); setError(""); } }).catch(error => { if (active) setError(errorMessage(error)); });
        return () => { active = false; };
    }, [now]);
    const entries = data ? filterTaskCenterEntries(taskCenterEntries(data), filter, query, category) : [];
    return <section className="task-center" aria-label="Task Center list">
        <div className="task-center-search">
            <label><span className="sr-only">Search task names</span><input type="search" placeholder="Search task names…" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <label><span className="sr-only">Task category</span><select value={category} onChange={event => setCategory(event.target.value as TaskCategory | "all")}>
                <option value="all">All categories</option>
                {TASK_CATEGORIES.map(item => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}
            </select></label>
        </div>
        <div className="task-center-filters" role="group" aria-label="Task Center filters">
            {(["recurring", "missed"] as const).map(tag => <button key={tag} type="button" className="task-center-chip" aria-pressed={filter === tag} onClick={() => setFilter(current => toggleTaskCenterFilter(current, tag))}>{tag === "recurring" ? "Recurring" : "Missed"}</button>)}
        </div>
        <p className="form-hint">{filter === "all" ? "Browse tasks, recurring series and missed occurrences." : filter === "recurring" ? "Recurring series. Open one to edit its schedule." : "Missed occurrences, most recent first. Open one for Details."}</p>
        {error && <p className="notice error" role="alert">{error}</p>}
        {!data && !error && <p role="status">Loading tasks…</p>}
        {data && !entries.length && <p className="empty-list">{query.trim() || category !== "all" ? "No tasks match your search and filters." : filter === "all" ? "No tasks yet." : filter === "recurring" ? "No recurring tasks." : "No missed tasks."}</p>}
        <ul>{entries.map(entry => {
            const { task, occurrence, kind } = entry;
            const state = kind === "missed" ? "missed" : occurrenceState(task.currentOccurrence, now, task.scheduledEndAt);
            const label = kind === "recurring" ? "Recurring series" : state === "completed" ? "Finished" : state === "in-progress" ? "In Progress" : state === "missed" ? "Missed" : "Planned";
            return <li key={entry.key} data-task-id={task.id} data-entry-kind={kind} data-occurrence-id={occurrence?.record?.id}><button type="button" onClick={() => onSelect(entry)}>
                <span><strong>{categoryMetadata(task.category).emoji} {task.title}</strong><small>{kind === "recurring" ? `${task.recurrenceRule?.frequency === "weekly" ? "Weekly" : "Daily"} · ${task.recurrenceRule?.startTime}–${task.recurrenceRule?.endTime}` : `${new Date(occurrence?.scheduledStartAt ?? task.scheduledStartAt).toLocaleString()} – ${new Date(occurrence?.scheduledEndAt ?? task.scheduledEndAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}</small></span><span className={kind === "missed" ? "missed-state-label" : "task-center-kind"}>{label}</span>
            </button></li>;
        })}</ul>
    </section>;
}
