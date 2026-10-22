import { useCallback, useEffect, useRef, useState } from "react";
import type { MiniToday, MiniWindowState } from "../../shared/types/mini";
import type { ScheduledOccurrence, Task } from "../../shared/types/task";
import { categoryMetadata } from "../../shared/taskCategories";
import { miniSections } from "../../shared/scheduling/miniSchedule";
import { occurrenceDisplayRange } from "../../shared/scheduling/occurrenceDisplay";
import { errorMessage } from "../taskFormatting";
import Icon from "./Icon";
import MiniResizeGrips from "./MiniResizeGrips";
import MiniDayTimetable from "./MiniDayTimetable";

export default function MiniView() {
    const [dayView, setDayView] = useState(false);
    const [windowState, setWindowState] = useState<MiniWindowState>({ mode: "ball", edge: null });
    const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const cancelPeek = () => { if (peekTimer.current) clearTimeout(peekTimer.current); peekTimer.current = null; };
    const cancelLeave = () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); leaveTimer.current = null; };
    useEffect(() => () => { if (peekTimer.current) clearTimeout(peekTimer.current); if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);
    const gesture = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    useEffect(() => {
        let active = true;
        const unsubscribe = window.miniAPI.onWindowStateChanged(state => { if (active) setWindowState(state); });
        void window.miniAPI.getWindowState().then(state => { if (active) setWindowState(state); }).catch(console.error);
        return () => { active = false; unsubscribe(); };
    }, []);
    const [data, setData] = useState<MiniToday | null>(null);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const pending = useRef(false), version = useRef(0), mounted = useRef(false);
    const refresh = useCallback(async () => {
        const request = ++version.current;
        const today = await window.miniAPI.getToday();
        if (mounted.current && request === version.current) { setData(today); setError(""); }
    }, []);
    useEffect(() => {
        mounted.current = true;
        const update = () => { void refresh().catch(error => { if (mounted.current) setError(errorMessage(error)); }); };
        update();
        const unsubscribe = window.miniAPI.onDataChanged(update);
        const timer = window.setInterval(update, 30_000);
        window.addEventListener("focus", update);
        return () => { mounted.current = false; unsubscribe(); window.clearInterval(timer); window.removeEventListener("focus", update); };
    }, [refresh]);
    useEffect(() => { if (!message) return; const timer = window.setTimeout(() => setMessage(""), 3000); return () => window.clearTimeout(timer); }, [message]);
    async function act(row: ScheduledOccurrence, task: Task, finish: boolean) {
        if (pending.current) return;
        pending.current = true; setBusy(true); setError("");
        try {
            const target = row.record ? { taskId: task.id, occurrenceId: row.record.id } : { taskId: task.id, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt };
            await (finish ? window.miniAPI.finish(target) : window.miniAPI.start(target));
            setMessage(`${finish ? "Finished" : "Started"} ${task.title}`);
            await refresh();
        } catch (error) { setError(errorMessage(error)); }
        finally { pending.current = false; if (mounted.current) setBusy(false); }
    }
    async function control(action: () => Promise<void>) {
        try { await action(); } catch (error) { setError(errorMessage(error)); }
    }
    const sections = miniSections(data?.occurrences ?? [], data?.now ?? 0);
    const tasks = new Map(data?.tasks.map(task => [task.id, task]));
    function openTask(row: ScheduledOccurrence) {
        return window.miniAPI.openTask(row.record ? { taskId: row.taskId, occurrenceId: row.record.id } : { taskId: row.taskId, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt });
    }
    const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: data?.timeZone });
    function card(row: ScheduledOccurrence, kind: "running" | "planned" | "missed" | "completed") {
        const task = tasks.get(row.taskId);
        if (!task) return null;
        const category = categoryMetadata(task.category), range = occurrenceDisplayRange(row, data!.now);
        return <article key={`${row.taskId}:${row.scheduledStartAt}:${row.scheduledEndAt}`} className={`mini-task is-${kind}`} data-task-id={task.id} data-state={kind} aria-label={`${task.title}, ${category.label}, ${kind === "running" ? "In Progress" : kind === "missed" ? "Missed" : kind === "completed" ? "Finished" : "Planned"}`}>
            <button type="button" className="mini-task-open" aria-label={`Open details for ${task.title}`} onClick={() => void control(() => openTask(row))}><span className="mini-task-copy"><span className="mini-task-title" title={task.title}><span aria-hidden="true">{category.emoji}</span><span>{task.title}</span></span>
                <span className="mini-task-time">{kind === "running" ? `Started ${clock(row.record!.startedAt!)}` : `${clock(range.startAt)}–${clock(range.endAt)}`}</span>
                {kind === "running" && <small>Planned until {clock(row.scheduledEndAt)}</small>}
            </span>{kind === "missed" && <span className="mini-missed-label">Missed</span>}{kind === "completed" && <span className="mini-completed-label">Finished</span>}</button>
            {(kind === "running" || kind === "planned") && <button className="mini-action" type="button" disabled={busy} aria-label={`${kind === "running" ? "Finish" : "Start"} ${task.title}`} onClick={event => { event.stopPropagation(); void act(row, task, kind === "running"); }}>{kind === "running" ? "Finish" : "Start"}</button>}
        </article>;
    }
    const ballRow = sections.running[0] ?? sections.upcoming[0], ballTask = ballRow && tasks.get(ballRow.taskId);
    const ball = <button type="button" className={`mini-orb ${windowState.mode === "docked" ? `is-docked dock-${windowState.edge}` : ""} ${sections.running.length ? "is-running" : ""}`}
            aria-label="Expand Today mini view" title={ballTask ? `${ballTask.title} — click to expand; drag to dock` : "Today — click to expand; drag to dock"}
            onPointerEnter={() => {
                cancelLeave(); cancelPeek();
                if (windowState.mode !== "expanded" && !gesture.current) peekTimer.current = setTimeout(() => { peekTimer.current = null; void control(window.miniAPI.preview); }, 250);
            }}
            onPointerLeave={cancelPeek}
            onContextMenu={event => { cancelPeek(); event.preventDefault(); void control(window.miniAPI.showBallMenu); }}
            onPointerDown={event => {
                if (event.button !== 0) return;
                cancelPeek();
                if (windowState.mode !== "ball") { gesture.current = null; return; }
                event.currentTarget.setPointerCapture(event.pointerId);
                gesture.current = { x: event.screenX, y: event.screenY, moved: false };
                void control(window.miniAPI.beginDrag);
            }}
            onPointerMove={event => {
                const current = gesture.current;
                if (!current) return;
                if (Math.hypot(event.screenX - current.x, event.screenY - current.y) > 5) current.moved = true;
                if (current.moved) void control(window.miniAPI.moveDrag);
            }}
            onPointerUp={event => {
                if (event.button !== 0) return;
                void control(window.miniAPI.endDrag);
                // Keep the gesture until click so dragging never expands the ball.
            }}
            onPointerCancel={() => { gesture.current = null; void control(window.miniAPI.endDrag); }}
            onClick={() => {
                const dragged = gesture.current?.moved; gesture.current = null;
                if (!dragged) void control(window.miniAPI.expand);
            }}>
            <span aria-hidden="true">{windowState.mode === "docked" ? (windowState.edge === "left" ? "›" : "‹") : ballTask ? categoryMetadata(ballTask.category).emoji : "◷"}</span>
        </button>;
    if (windowState.mode !== "expanded") return ball;
    return <div className={windowState.preview ? `mini-preview${windowState.edge === "left" ? " is-left" : ""}` : "mini-expanded"}
        onPointerEnter={cancelLeave}
        onPointerLeave={() => { cancelLeave(); if (windowState.preview) leaveTimer.current = setTimeout(() => { leaveTimer.current = null; void control(window.miniAPI.endPreview); }, 200); }}>
        <main className="mini-shell" onPointerDownCapture={() => { if (windowState.preview) { cancelLeave(); void control(window.miniAPI.expand); } }}>
        <MiniResizeGrips onError={error => setError(errorMessage(error))} />
        <header className="mini-header"><div><h1>Today</h1><p>{data ? new Date(data.now).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: data.timeZone }) : "Your day at a glance"}</p></div>
            <div className="mini-window-actions"><button type="button" aria-label="Open main app" title="Open main app" onClick={() => void control(window.miniAPI.openMain)}><Icon name="open-details" /></button><button type="button" aria-label="Hide panel" title="Hide panel" onClick={() => void control(window.miniAPI.collapse)}><span aria-hidden="true">−</span></button></div>
        </header>
        <nav className="mini-view-switch" aria-label="Mini view mode"><button type="button" aria-pressed={!dayView} onClick={() => setDayView(false)}>Now &amp; Next</button><button type="button" aria-pressed={dayView} onClick={() => setDayView(true)}>Today timetable</button></nav>
        {dayView && data ? <MiniDayTimetable data={data} onOpenTask={row => void control(() => openTask(row))} /> : <div className="mini-body">
            {error && <div className="mini-error" role="alert"><p>{error}</p><button type="button" onClick={() => void control(refresh)}>Try again</button></div>}
            {!data && !error && <p className="mini-empty" role="status">Loading today…</p>}
            {!!sections.running.length && <section aria-label="Now"><h2>Now <span>In Progress</span></h2>{sections.running.map(row => card(row, "running"))}</section>}
            {!!sections.upcoming.length && <section aria-label="Next"><h2>Next <span>Planned</span></h2>{card(sections.upcoming[0], "planned")}</section>}
            {sections.upcoming.length > 1 && <section aria-label="Later"><h2>Later today</h2>{sections.upcoming.slice(1).map(row => card(row, "planned"))}</section>}
            {data && !sections.running.length && !sections.upcoming.length && <div className="mini-empty"><Icon name="calendar" /><p>No more upcoming tasks today.</p><button type="button" onClick={() => void control(window.miniAPI.openMain)}>Open your schedule</button></div>}
            {!!sections.missed.length && <details className="mini-missed"><summary>Missed today <span>{sections.missed.length}</span></summary>{sections.missed.map(row => card(row, "missed"))}</details>}
            {!!sections.completed.length && <details className="mini-completed"><summary>Completed today <span>{sections.completed.length}</span></summary>{sections.completed.map(row => card(row, "completed"))}</details>}
        </div>}
        <footer className="mini-footer"><span role="status">{message || "Self Discipline Manager"}</span><span className="mini-resize-hint" title="Drag window edges to resize" aria-hidden="true">◢</span></footer>
    </main>{windowState.preview && <div className="mini-preview-ball">{ball}</div>}</div>;
}
