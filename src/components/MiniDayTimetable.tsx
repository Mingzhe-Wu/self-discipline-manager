import { useEffect, useRef, type CSSProperties } from "react";
import type { ScheduledOccurrence } from "../../shared/types/task";
import type { MiniToday } from "../../shared/types/mini";
import { categoryMetadata } from "../../shared/taskCategories";
import { occurrenceState } from "../../shared/occurrenceLifecycle";
import { displayRangeGeometry, layoutOverlaps, splitOccurrenceDisplaySegments } from "../timetableLayout";
import Icon from "./Icon";

import { currentTimeScrollTop } from "../timetableViewport";

const DENSITY = 1.2;

export default function MiniDayTimetable({ data, onOpenTask }: { data: MiniToday; onOpenTask: (row: ScheduledOccurrence) => void }) {
    const viewport = useRef<HTMLDivElement>(null);
    const tasks = new Map(data.tasks.map(task => [task.id, task]));
    const rows = data.occurrences.flatMap(row => splitOccurrenceDisplaySegments(row, data.timeZone, data.now)
        .filter(segment => segment.date === data.date).map(segment => ({ ...segment, row })));
    const layouts = layoutOverlaps(rows.map(({ row, ...segment }) => ({ ...segment, taskId: row.taskId, occurrenceId: row.record?.id })), 15);
    const local = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: data.timeZone });
    const [hour, minute] = local.format(data.now).split(":").map(Number);
    const currentMinute = hour * 60 + minute;
    useEffect(() => {
        const node = viewport.current;
        if (node) node.scrollTop = currentTimeScrollTop(currentMinute, 0, 1440, DENSITY, node.clientHeight, 0);
        // Position now one third down only on opening this view/date, not on every refresh or resize.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.date]);
    return <div className="mini-day-viewport" ref={viewport} role="region" aria-label="Today's timetable">
        <div className="mini-day-grid" style={{ height: 1440 * DENSITY, "--mini-short-expanded-height": `${40 * DENSITY}px` } as CSSProperties}>
            {Array.from({ length: 25 }, (_, hour) => <div key={hour} className="mini-day-tick" style={{ top: hour * 60 * DENSITY }}><span>{`${String(hour).padStart(2, "0")}:00`}</span></div>)}
            <div className="mini-day-column">
                {rows.map(({ row, startMinute, endMinute }, index) => {
                    const task = tasks.get(row.taskId);
                    if (!task) return null;
                    const state = occurrenceState(row.record, data.now, row.scheduledEndAt);
                    const label = state === "completed" ? "Finished" : state === "in-progress" ? "In Progress" : state === "missed" ? "Missed" : "Planned";
                    const category = categoryMetadata(task.category), layout = layouts[index];
                    const geometry = displayRangeGeometry(startMinute, endMinute, DENSITY);
                    const range = `${local.format(row.scheduledStartAt)}–${local.format(row.scheduledEndAt)}`;
                    return <button type="button" key={`${row.taskId}:${row.scheduledStartAt}:${index}`} className={`mini-day-task is-${state}${endMinute - startMinute < 40 ? " is-short" : ""}`} data-task-id={task.id}
                        style={{ top: geometry.top, height: geometry.height, left: `${layout.offsetFraction * 100}%`, width: `${layout.widthFraction * 100}%`, zIndex: layout.zIndex }}
                        aria-label={`${task.title}, ${category.label}, ${label}, ${range}. Open details`} title={`${task.title} · ${label} · Planned ${range} — open details`}
                        onClick={() => onOpenTask(row)}>
                        <Icon name="open-details" className="mini-day-details-hint" />
                        <strong><span aria-hidden="true">{category.emoji}</span> {task.title}</strong>
                        <span className={geometry.height < 32 ? "is-collapsed" : undefined}>{range}</span>
                        <small className={geometry.height < 48 ? "is-collapsed" : undefined}>{label}</small>
                    </button>;
                })}
            </div>
            <div className="mini-day-now" style={{ top: currentMinute * DENSITY }}><span>NOW</span></div>
        </div>
    </div>;
}
