import { categoryMetadata } from "../../shared/taskCategories";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { OccurrenceTarget, ScheduledOccurrence, Task } from "../../shared/types/task";
import { dayKey, shiftWeek, weekDays, weekRange } from "../../shared/scheduling/week";
import { occurrenceDisplayRange } from "../../shared/scheduling/occurrenceDisplay";
import { lifecycleToast, useToast } from "../toast";
import { occurrenceState } from "../../shared/occurrenceLifecycle";
import { errorMessage } from "../taskFormatting";
import { layoutOverlaps, displayRangeGeometry, splitOccurrenceDisplaySegments, hoverExpansionOffset } from "../timetableLayout";
import type { DisplaySegment, OverlapLayout } from "../timetableLayout";

import ResetOccurrenceDialog from "./ResetOccurrenceDialog";
import Icon from "./Icon";
import TimetableQuickAdd from "./TimetableQuickAdd";
import type { QuickAddDraft } from "../timetableQuickAdd";
import { useOccurrenceResize } from "../useOccurrenceResize";

import type { PlanningHours } from "../../shared/types/settings";
import { DEFAULT_PLANNING_HOURS } from "../../shared/scheduling/planningHours";
import { centeredScrollTop, currentTimePosition, localMinute, timelineTicks, viewportDensity } from "../timetableViewport";

const clockMinute = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
type DisplayOccurrence = DisplaySegment & { occurrence: ScheduledOccurrence };
type ResetRequest = { taskTitle: string; target: OccurrenceTarget };
function minuteLabel(minute: number) { return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`; }

function OccurrenceCard({ task, segment, overlap, onChange, onSelect, onRequestReset, density, origin, suppressHover, timeZone, now }: { task: Task; segment: DisplayOccurrence; overlap: OverlapLayout; onChange: () => Promise<void>; onSelect: (id: number, occurrence: ScheduledOccurrence) => void; density: number; origin: number; suppressHover: boolean; timeZone: string; now: number; onRequestReset: (request: ResetRequest) => void }) {
    const notify = useToast();
    const [busy, setBusy] = useState(false);
    const container = useRef<HTMLLIElement>(null);
    const [expandUp, setExpandUp] = useState(false);
    const [hovered, setExpanded] = useState(false);
    const expanded = hovered && !suppressHover;
    const [error, setError] = useState("");
    const descriptionId = useId();
    const pending = useRef(false);
    const expansionReady = useRef(false);
    const card = useRef<HTMLButtonElement>(null);
    const category = categoryMetadata(task.category);
    const categoryDescription = `${category.label} category, ${task.title}`;
    const occurrence = segment.occurrence;
    const state = occurrenceState(occurrence.record, now, occurrence.scheduledEndAt);
    const missed = state === "missed";
    const resize = useOccurrenceResize({ task, occurrence, enabled: suppressHover && !busy && !missed, density, origin, timeZone, onChange });
    const displayedSegment = resize.preview ? splitOccurrenceDisplaySegments(resize.preview, timeZone, now).find(row => row.date === segment.date) ?? segment : segment;
    const completed = state === "completed";
    const geometry = displayRangeGeometry(displayedSegment.startMinute - origin, displayedSegment.endMinute - origin, density);
    const rangeLabel = `${minuteLabel(displayedSegment.startMinute)}–${minuteLabel(displayedSegment.endMinute)}`;
    const expandedHeight = Math.max(120, geometry.height);
    const expandedTop = expandUp ? geometry.height - expandedHeight : 0;
    useLayoutEffect(() => { expansionReady.current = false; }, [expanded]);
    function expand() {
        if (suppressHover) return;
        const element = container.current;
        if (element) {
            const bounds = element.getBoundingClientRect();
            const viewport = element.closest(".week-scroll")?.getBoundingClientRect();
            const timeline = element.parentElement?.getBoundingClientRect();
            const bottom = Math.min(viewport?.bottom ?? window.innerHeight, timeline?.bottom ?? Infinity, window.innerHeight) - 4;
            setExpandUp(hoverExpansionOffset(bounds.top, geometry.height, expandedHeight, bottom) < 0);
        }
        setExpanded(true);
    }
    async function advance() {
        if (!expanded || !expansionReady.current || suppressHover || pending.current || resize.saving) return;
        if (missed) { onSelect(task.id, occurrence); return; }
        const target: OccurrenceTarget = occurrence.record ? { taskId: task.id, occurrenceId: occurrence.record.id } : { taskId: task.id, scheduledStartAt: occurrence.scheduledStartAt, scheduledEndAt: occurrence.scheduledEndAt };
        if (completed) { card.current?.focus(); onRequestReset({ taskTitle: task.title, target }); return; }
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            const saved = state === "planned" ? await window.electronAPI.startTaskOccurrence(target) : await window.electronAPI.endTaskOccurrence(target);
            await onChange();
            notify(lifecycleToast(state === "planned" ? "start" : "finish", task.title, saved));
        }
        catch (error) { setError(errorMessage(error)); }
        finally { pending.current = false; setBusy(false); }
    }
    const status = missed ? "Missed" : state === "planned" ? "Planned" : state === "in-progress" ? "In Progress" : "Finished";
    const action = missed ? "Open details" : state === "planned" ? "Start" : state === "in-progress" ? "Finish" : "Reset";
    const actionText = missed ? "Open details" : state === "planned" ? "▶ Press to start" : state === "in-progress" ? "■ Press to finish" : "↺ Press to reset";
    return (
        <li ref={container} className={`occurrence-card${completed ? " is-completed" : ""}${expanded ? " is-expanded" : ""}${resize.resizing ? " is-resizing" : ""}${overlap.groupSize > 1 ? " is-grouped" : ""}${geometry.height < 60 ? " is-short" : ""}${geometry.height < 44 ? " is-tiny" : ""}${geometry.height < 18 ? " is-micro" : ""}`} data-state={state} data-task-id={task.id} data-scheduled-at={occurrence.scheduledStartAt} data-scheduled-start-at={occurrence.scheduledStartAt} data-scheduled-end-at={occurrence.scheduledEndAt} data-overlap-count={overlap.groupSize} data-group-size={overlap.groupSize} data-group-column={overlap.column} data-planned-height={geometry.plannedHeight}
            style={{ top: geometry.top, height: Math.max(geometry.height, 1), "--card-column": overlap.column, "--card-columns": overlap.groupSize, "--card-width": overlap.widthFraction, "--card-offset": overlap.offsetFraction, "--card-layer": overlap.zIndex, "--expanded-top": `${expandedTop}px`, "--expand-origin-y": expandUp ? "100%" : "0%", "--expanded-height": `${expandedHeight}px`, "--expand-scale-x": overlap.widthFraction, "--expand-scale-y": Math.min(1, geometry.height / expandedHeight), "--expand-origin-x": `${overlap.groupSize > 1 ? 100 * overlap.offsetFraction / Math.max(0.000001, 1 - overlap.widthFraction) : 50}%` } as CSSProperties}
            onMouseEnter={(event) => { if (!event.ctrlKey) expand(); }} onMouseLeave={() => setExpanded(false)}
            onFocusCapture={(event) => { if (event.target.matches(":focus-visible")) expand(); }}
            onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(":hover")) setExpanded(false); }}
            onKeyDownCapture={(event) => { if (["Tab", "Enter", " "].includes(event.key)) expand(); }}
            aria-busy={busy || resize.saving} aria-label={`${action} ${task.title}`} aria-description={categoryDescription} >
            <div className="card-content" onAnimationEnd={(event) => { if (event.target === event.currentTarget && event.animationName === "task-card-expand" && expanded && !suppressHover) expansionReady.current = true; }}>
                <div className="card-info-region">
                    <button type="button" className="card-details-region-button" disabled={busy || suppressHover} aria-label={`Details for ${task.title}`} aria-description={categoryDescription} onClick={(event) => { event.stopPropagation(); if (!event.ctrlKey && expanded && expansionReady.current && event.detail < 2) onSelect(task.id, occurrence); }} onKeyDown={(event) => event.stopPropagation()} />
                    <Icon name="open-details" className="card-details-indicator" />
                    <h3 aria-label={task.title} aria-description={`${category.label} category`} title={categoryDescription}><span className="task-category-emoji" aria-hidden="true">{category.emoji}</span><span className="task-card-title">{task.title}</span></h3>
                    <small id={`${descriptionId}-status`} className="lifecycle-status">{status}<span className="card-category-name"> · {category.label}</span></small>
                    <time dateTime={new Date(occurrence.scheduledStartAt).toISOString()}>{rangeLabel}</time>
                </div>
                <button ref={card} type="button" className="card-primary-button card-action-hint" aria-describedby={`${descriptionId}-status ${descriptionId}-action`} disabled={suppressHover} aria-disabled={busy} aria-label={`${action} ${task.title}`} aria-description={categoryDescription} onClick={(event) => { event.stopPropagation(); if (!event.ctrlKey && expanded && event.detail < 2) void advance(); }} onKeyDown={(event) => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}><span id={`${descriptionId}-action`} className="card-action-label">{busy ? "Saving…" : actionText}</span></button>
            </div>
            <button type="button" className="timetable-resize-handle is-start" {...resize.handleProps("start")}><span /></button>
            <button type="button" className="timetable-resize-handle is-end" {...resize.handleProps("end")}><span /></button>
            {resize.preview && <span className="timetable-resize-preview" role="status">{resize.previewLabel ?? rangeLabel}</span>}
            {(error || resize.error) && <p role="alert" className="notice error card-error">{error || resize.error}</p>}
        </li>
    );
}

export default function WeekSchedule({ from, tasks, occurrences, now, timeZone, filter, onChange, onSelect, onQuickAdd, quickAddEnabled = true, planningHours = DEFAULT_PLANNING_HOURS, weekStartsOn = 1, defaultDurationMinutes = 60, showRevision = 0, centerRevision = 0, dataReady = true }: {
    from: number; tasks: Task[]; occurrences: ScheduledOccurrence[]; now: number; timeZone: string;
    filter: string; onChange: () => Promise<void>; onSelect: (id: number, occurrence: ScheduledOccurrence) => void; onQuickAdd?: (draft: QuickAddDraft) => void; quickAddEnabled?: boolean; planningHours?: PlanningHours; weekStartsOn?: 0 | 1; defaultDurationMinutes?: number; showRevision?: number; centerRevision?: number; dataReady?: boolean;
}) {
    const [reset, setReset] = useState<ResetRequest | null>(null);
    const [ctrlHeld, setCtrlHeld] = useState(false);
    useEffect(() => {
        const update = (event: KeyboardEvent) => setCtrlHeld(event.ctrlKey);
        const clear = () => setCtrlHeld(false);
        window.addEventListener("keydown", update);
        window.addEventListener("keyup", update);
        window.addEventListener("blur", clear);
        return () => {
            window.removeEventListener("keydown", update);
            window.removeEventListener("keyup", update);
            window.removeEventListener("blur", clear);
        };
    }, []);
    const board = useRef<HTMLDivElement>(null);
    const [viewportHeight, setViewportHeight] = useState<number | null>(null);
    const lastCenter = useRef("");
    useEffect(() => {
        const element = board.current;
        if (!element) return;
        const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
        observer.observe(element);
        setViewportHeight(element.clientHeight);
        return () => observer.disconnect();
    }, []);
    const density = viewportHeight ? viewportDensity(viewportHeight) : 1;
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const byDay = new Map<string, DisplayOccurrence[]>();
    for (const occurrence of occurrences) {
        const completed = occurrenceState(occurrence.record, now, occurrence.scheduledEndAt) === "completed";
        if ((filter === "completed" && !completed) || (filter === "incomplete" && completed)) continue;
        for (const segment of splitOccurrenceDisplaySegments(occurrence, timeZone, now, { from, to: shiftWeek(from, 1, timeZone) })) {
            const rows = byDay.get(segment.date) ?? [];
            rows.push({ ...segment, occurrence });
            byDay.set(segment.date, rows);
        }
    }
    const configuredStart = clockMinute(planningHours.wakeTime);
    const configuredEnd = clockMinute(planningHours.sleepTime);
    const segments = [...byDay.values()].flat();
    const start = Math.min(configuredStart, ...segments.map((row) => row.startMinute));
    const end = Math.max(configuredEnd, ...segments.map((row) => row.endMinute));
    const ticks = timelineTicks(start, end);
    const minorTicks: number[] = [];
    for (let minute = Math.ceil(start / 30) * 30; minute < end; minute += 30) {
        if (minute > start && !ticks.includes(minute)) minorTicks.push(minute);
    }
    const height = (end - start) * density;
    const timePosition = currentTimePosition(now, timeZone, start, end, density);
    useLayoutEffect(() => {
        if (!board.current || !viewportHeight || !dataReady || viewportHeight !== board.current.clientHeight) return;
        const request = [from, showRevision, centerRevision].join(":");
        if (lastCenter.current === request) return;
        lastCenter.current = request;
        board.current.scrollTop = from === weekRange(Date.now(), timeZone, weekStartsOn).from
            ? centeredScrollTop(localMinute(Date.now(), timeZone), start, end, density, viewportHeight)
            : 0;
    }, [showRevision, centerRevision, dataReady, from, start, end, density, viewportHeight, timeZone, weekStartsOn]);
    return (
        <>
        {(start < configuredStart || end > configuredEnd) && <p className="planning-range-note">This view includes saved tasks outside current planning hours.</p>}
        <div ref={board} className={`week-scroll${ctrlHeld ? " is-ctrl-held" : ""}`} onPointerMoveCapture={(event) => { if (event.ctrlKey) setCtrlHeld(true); }} tabIndex={0} role="region" aria-label="Weekly schedule" data-planning-start={start} data-planning-end={end} data-density={density}>
            <div className="week-grid">
                <div className="time-axis" aria-label="Time of day"><div className="time-axis-heading" /><div className="time-axis-track" style={{ height: height }}>{ticks.map((minute) => <span key={minute} style={{ top: (minute - start) * density }}>{minuteLabel(minute)}</span>)}</div></div>
                {weekDays(from, timeZone).map((day) => {
                    const rows = byDay.get(day.date) ?? [];
                    const overlaps = layoutOverlaps(rows.map((segment) => { const display = occurrenceDisplayRange(segment.occurrence, now); return { ...segment, scheduledStartAt: display.startAt, scheduledEndAt: display.endAt, taskId: segment.occurrence.taskId, occurrenceId: segment.occurrence.record?.id }; }), 15);
                    return <section key={day.date} className="day-column" data-date={day.date} aria-label={day.date} aria-current={day.date === dayKey(now, timeZone) ? "date" : undefined}>
                        <h2><span className="weekday-name">{new Date(day.at).toLocaleDateString([], { weekday: "short", timeZone })}</span><span className="day-number">{Number(day.date.slice(-2)).toLocaleString()}</span><small className="today-label">{day.date === dayKey(now, timeZone) ? "Today" : "\u00a0"}</small></h2>
                        <ul className="day-timeline" style={{ height: height }}>
                            {day.date === dayKey(now, timeZone) && timePosition.visible && <li className="current-time-line" aria-label={`Current time ${minuteLabel(localMinute(now, timeZone))}`} style={{ top: timePosition.top }}><span>NOW: {minuteLabel(localMinute(now, timeZone))}</span></li>}
                            {ticks.map((minute) => <li key={`tick:${minute}`} className="timeline-line" aria-hidden="true" style={{ top: (minute - start) * density }} />)}
                            {minorTicks.map((minute) => <li key={`minor:${minute}`} className="timeline-line is-minor" aria-hidden="true" style={{ top: (minute - start) * density }} />)}
                            {rows.map((segment, index) => {
                                const task = byId.get(segment.occurrence.taskId);
                                return task && <OccurrenceCard key={`${task.id}:${segment.occurrence.scheduledStartAt}:${segment.occurrence.scheduledEndAt}:${segment.date}`} task={task} segment={segment} overlap={overlaps[index]} density={density} origin={start} suppressHover={ctrlHeld} timeZone={timeZone} now={now} onChange={onChange} onSelect={onSelect} onRequestReset={setReset} />;
                            })}
                            {!rows.length && <li className="empty-day">No tasks</li>}
                        </ul>
                    </section>;
                })}
            </div>
        </div>
        {onQuickAdd && quickAddEnabled && !reset && <TimetableQuickAdd board={board} density={density} origin={start} hours={planningHours} defaultDurationMinutes={defaultDurationMinutes} enabled onCreate={onQuickAdd} />}
        {reset && <ResetOccurrenceDialog taskTitle={reset.taskTitle} target={reset.target} onChange={onChange} onClose={() => setReset(null)} fallbackFocus={board} />}
        </>
    );
}

