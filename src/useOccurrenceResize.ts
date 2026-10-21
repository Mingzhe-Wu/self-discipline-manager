import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import type { ScheduledOccurrence, Task } from "../shared/types/task";
import { occurrenceState } from "../shared/occurrenceLifecycle";
import { resizeDragTime, resizeField, resizeOccurrenceRange } from "../shared/scheduling/occurrenceResize";
import type { ResizeEdge } from "../shared/scheduling/occurrenceResize";
import { errorMessage } from "./taskFormatting";
import { useToast } from "./toast";
import { localMinute, pointerClockMinute } from "./timetableViewport";

interface ResizeDrag {
    element: HTMLButtonElement; pointerId: number; edge: ResizeEdge; timer: number;
    y: number; scrollTop: number; board: HTMLElement; initial: number; at: number;
    occurrence: ScheduledOccurrence; active: boolean; moved: boolean; valid: boolean;
}

/** Ctrl edge editing owns only its pointer gesture; business rules stay in the service. */
export function useOccurrenceResize({ task, occurrence, enabled, density, origin, timeZone, onChange }: {
    task: Task; occurrence: ScheduledOccurrence; enabled: boolean; density: number;
    origin: number; timeZone: string; onChange: () => Promise<void>;
}) {
    const notify = useToast();
    const [preview, setPreview] = useState<ScheduledOccurrence | null>(null);
    const [activeEdge, setActiveEdge] = useState<ResizeEdge>("start");
    const [resizing, setResizing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const drag = useRef<ResizeDrag | null>(null);
    const pending = useRef(false);
    const mounted = useRef(true);
    const suppressContextMenu = useRef(false);

    function release() {
        const active = drag.current;
        drag.current = null;
        if (active) {
            window.clearTimeout(active.timer);
            if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
        }
        return active;
    }
    function cancel() { release(); setPreview(null); setResizing(false); }

    useEffect(() => {
        mounted.current = true;
        const cancelGesture = () => {
            const active = drag.current;
            drag.current = null;
            if (active) {
                window.clearTimeout(active.timer);
                if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
            }
            setPreview(null); setResizing(false);
        };
        const key = (event: KeyboardEvent) => {
            if (!event.ctrlKey || event.key === "Escape") cancelGesture();
        };
        const rightClick = (event: MouseEvent) => {
            if (event.button !== 2 || !drag.current) return;
            event.preventDefault(); event.stopPropagation();
            suppressContextMenu.current = true;
            cancelGesture();
        };
        // Pointer capture + preventDefault on left-down can suppress compatibility
        // mousedown events for a right-button chord. Its buttons bit still changes.
        const rightPointer = (event: PointerEvent) => {
            if (!(event.buttons & 2) || !drag.current) return;
            event.preventDefault(); event.stopPropagation();
            suppressContextMenu.current = true;
            cancelGesture();
        };
        const contextMenu = (event: MouseEvent) => {
            if (!suppressContextMenu.current && !drag.current) return;
            event.preventDefault(); event.stopPropagation();
            if (drag.current) cancelGesture();
            suppressContextMenu.current = false;
        };
        window.addEventListener("keyup", key);
        window.addEventListener("keydown", key);
        window.addEventListener("blur", cancelGesture);
        window.addEventListener("mousedown", rightClick, true);
        window.addEventListener("pointermove", rightPointer, true);
        window.addEventListener("contextmenu", contextMenu, true);
        return () => {
            mounted.current = false;
            const active = drag.current;
            drag.current = null;
            if (active) window.clearTimeout(active.timer);
            window.removeEventListener("keyup", key);
            window.removeEventListener("keydown", key);
            window.removeEventListener("blur", cancelGesture);
            window.removeEventListener("mousedown", rightClick, true);
            window.removeEventListener("pointermove", rightPointer, true);
            window.removeEventListener("contextmenu", contextMenu, true);
        };
    }, []);

    function begin(edge: ResizeEdge, event: ReactPointerEvent<HTMLButtonElement>) {
        if (!enabled || !event.ctrlKey || event.button !== 0 || pending.current || drag.current) return;
        const field = resizeField(occurrence, edge);
        const initial = field === "scheduledStartAt" || field === "scheduledEndAt" ? occurrence[field] : occurrence.record?.[field];
        if (initial == null) return;
        const board = event.currentTarget.closest<HTMLElement>(".week-scroll");
        if (!board) return;
        event.preventDefault(); event.stopPropagation();
        setActiveEdge(edge);
        event.currentTarget.setPointerCapture(event.pointerId);
        const active: ResizeDrag = { element: event.currentTarget, pointerId: event.pointerId, edge, y: event.clientY,
            scrollTop: board.scrollTop, board, initial, at: initial, occurrence, active: false, moved: false, valid: true, timer: 0 };
        drag.current = active;
        active.timer = window.setTimeout(() => {
            if (drag.current !== active) return;
            active.active = true; setError(""); setResizing(true);
        }, 150);
    }

    function move(event: ReactPointerEvent<HTMLButtonElement>) {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        if (!active.active) return;
        const pixels = event.clientY - active.y + active.board.scrollTop - active.scrollTop;
        if (!active.moved && pixels === 0) return;
        active.moved = true;
        const timeline = active.element.closest(".day-timeline");
        if (!timeline) return;
        const viewport = active.board.getBoundingClientRect();
        const heading = active.board.querySelector(".day-column h2")?.getBoundingClientRect();
        const top = Math.max(viewport.top + active.board.clientTop, heading?.bottom ?? viewport.top);
        const bottom = viewport.top + active.board.clientTop + active.board.clientHeight;
        const minute = pointerClockMinute(event.clientY, timeline.getBoundingClientRect().top, density, origin, top, bottom);
        const at = resizeDragTime(active.initial, minute - Math.floor(localMinute(active.initial, timeZone)), timeZone);
        try {
            const next = resizeOccurrenceRange(active.occurrence, active.edge, at);
            active.at = at; active.valid = true; setError("");
            setPreview({ ...active.occurrence, scheduledStartAt: next.scheduledStartAt, scheduledEndAt: next.scheduledEndAt,
                record: active.occurrence.record ? { ...active.occurrence.record, ...next } : null });
        } catch (failure) { active.valid = false; setError(errorMessage(failure)); }
    }

    async function finish(event: ReactPointerEvent<HTMLButtonElement>) {
        if (drag.current?.pointerId !== event.pointerId) return;
        event.preventDefault(); event.stopPropagation();
        move(event);
        const active = release();
        setResizing(false);
        if (!active?.active || !active.moved || !active.valid || active.at === active.initial) { setPreview(null); return; }
        pending.current = true; setSaving(true);
        let saved = false;
        try {
            const target = occurrence.record ? { taskId: task.id, occurrenceId: occurrence.record.id }
                : { taskId: task.id, scheduledStartAt: occurrence.scheduledStartAt, scheduledEndAt: occurrence.scheduledEndAt };
            await window.electronAPI.resizeTaskOccurrence({ target, edge: active.edge, at: active.at, expectedState: occurrenceState(active.occurrence.record) });
            saved = true;
            await onChange();
            notify("Task time updated.");
        } catch (failure) { if (mounted.current) setError(saved ? `Time saved, but refresh failed. ${errorMessage(failure)}` : errorMessage(failure)); }
        finally { pending.current = false; if (mounted.current) { setSaving(false); setPreview(null); } }
    }

    function handleProps(edge: ResizeEdge) {
        const field = resizeField(occurrence, edge);
        const labels = { scheduledStartAt: "planned start", scheduledEndAt: "planned end", startedAt: "actual start", endedAt: "actual end" };
        return {
            "aria-label": `Drag ${labels[field]} for ${task.title}`,
            title: `Ctrl + hold and drag to change ${labels[field]}`,
            tabIndex: -1,
            disabled: !enabled || saving || (field === "startedAt" || field === "endedAt") && occurrence.record?.[field] == null,
            onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => begin(edge, event),
            onPointerMove: move, onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void finish(event),
            onPointerCancel: cancel, onLostPointerCapture: () => { if (drag.current) cancel(); },
            onClick: (event: ReactMouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); },
            onDoubleClick: (event: ReactMouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); },
        };
    }
    const field = resizeField(occurrence, activeEdge);
    const previewTime = !preview ? null : field === "scheduledStartAt" || field === "scheduledEndAt" ? preview[field] : preview.record?.[field];
    const labels = { scheduledStartAt: "Planned start", scheduledEndAt: "Planned end", startedAt: "Actual start", endedAt: "Actual end" };
    const previewLabel = previewTime == null ? null : `${labels[field]} · ${new Date(previewTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone })}`;
    return { preview, previewLabel, resizing, saving, error, handleProps };
}
