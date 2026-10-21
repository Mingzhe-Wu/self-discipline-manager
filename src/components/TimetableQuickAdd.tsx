import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { PlanningHours } from "../../shared/types/settings";
import { quickAddDraft, quickAddSelection } from "../timetableQuickAdd";
import type { QuickAddDraft } from "../timetableQuickAdd";
import { pointerClockMinute } from "../timetableViewport";

interface QuickAddVisual {
    left: number; top: number; width: number; height: number;
    guide: { top: number; labelTop: number; time: string } | null;
    selection?: { left: number; top: number; width: number; height: number; label: string };
}

/** Keep pointer-following state separate from the timetable cards. */
export default function TimetableQuickAdd({ board, density, origin, hours, enabled, onCreate }: {
    board: RefObject<HTMLDivElement | null>; density: number; origin: number;
    hours: PlanningHours; enabled: boolean; onCreate: (draft: QuickAddDraft) => void;
}) {
    const [hint, setHint] = useState<{ x: number; y: number; text: string } | null>(null);
    const [visual, setVisual] = useState<QuickAddVisual | null>(null);
    const { wakeTime, sleepTime } = hours;
    useEffect(() => {
        const bounds = { wakeTime, sleepTime };
        const element = board.current;
        if (!element || !enabled) return;
        let ctrl = false;
        let opened = false;
        let pointer: { x: number; y: number } | null = null;
        let draggingEdge: string | null = null;
        let suppressContextMenu = false;
        let selection: { timeline: HTMLElement; initial: QuickAddDraft; draft: QuickAddDraft } | null = null;
        function timelineAt(x: number, y: number) {
            const target = document.elementFromPoint(x, y);
            if (!target?.matches(".day-timeline, .timeline-line, .empty-day") || !element!.contains(target)) return null;
            const clockLabel = element!.querySelector(".current-time-line span")?.getBoundingClientRect();
            if (clockLabel && x >= clockLabel.left && x <= clockLabel.right && y >= clockLabel.top && y <= clockLabel.bottom) return null;
            return target.closest<HTMLElement>(".day-timeline");
        }
        function draftAt(x: number, y: number) {
            const timeline = timelineAt(x, y);
            const date = timeline?.closest<HTMLElement>(".day-column")?.dataset.date;
            return timeline && date ? quickAddDraft(date, y - timeline.getBoundingClientRect().top, density, origin, bounds) : null;
        }
        function refreshHint() {
            if (selection && !selection.timeline.isConnected) selection = null;
            const draft = ctrl && !opened && pointer ? selection?.draft ?? draftAt(pointer.x, pointer.y) : null;
            const active = draft !== null;
            element!.classList.toggle("is-quick-add", active);
            if (ctrl && !opened) {
                const at = pointer ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                const target = document.elementFromPoint(at.x, at.y);
                const edge = target?.closest<HTMLButtonElement>(".timetable-resize-handle");
                const field = edge?.getAttribute("aria-label")?.replace(/^Drag /, "").split(" for ")[0];
                const text = draggingEdge ? `Release to save · Right-click to cancel`
                    : selection ? "Click to confirm end time · Right-click to cancel"
                    : field ? `Hold and drag to adjust task time`
                    : target?.closest(".occurrence-card") ? "Drag the top or bottom edge to adjust task time"
                    : draft ? "Click to set start time · Double-click for quick setup"
                    : "Move into the timetable to add or adjust a task";
                setHint({ x: Math.max(8, Math.min(at.x + 14, window.innerWidth - 350)), y: Math.max(8, Math.min(at.y + 16, window.innerHeight - 66)), text });
            } else setHint(null);
            if (!ctrl || opened) { setVisual(null); return; }
            const viewport = element!.getBoundingClientRect();
            const axis = element!.querySelector(".time-axis")?.getBoundingClientRect();
            const heading = element!.querySelector(".day-column h2")?.getBoundingClientRect();
            const left = Math.max(viewport.left + element!.clientLeft, axis?.right ?? viewport.left);
            const top = Math.max(viewport.top + element!.clientTop, heading?.bottom ?? viewport.top);
            const width = Math.max(0, viewport.left + element!.clientLeft + element!.clientWidth - left);
            const height = Math.max(0, viewport.top + element!.clientTop + element!.clientHeight - top);
            let guide: QuickAddVisual["guide"] = null;
            {
                // The clock guide is independent of empty-space hit testing and
                // selection/resize state. All day columns share this time scale.
                const timeline = element!.querySelector(".day-timeline");
                if (timeline) {
                    const minute = pointerClockMinute(pointer?.y ?? top + height / 2, timeline.getBoundingClientRect().top, density, origin, top, top + height);
                    const lineTop = timeline.getBoundingClientRect().top + (minute - origin) * density - top;
                    const time = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
                    guide = { top: Math.max(0, Math.min(height, lineTop)), labelTop: Math.max(4, Math.min(height - 24, lineTop - 25)), time };
                }
            }
            let rectangle: QuickAddVisual["selection"];
            if (selection) {
                const bounds = selection.timeline.getBoundingClientRect();
                const startMinute = Number(selection.draft.startTime.slice(0, 2)) * 60 + Number(selection.draft.startTime.slice(3));
                const endMinute = Number(selection.draft.endTime.slice(0, 2)) * 60 + Number(selection.draft.endTime.slice(3));
                rectangle = { left: bounds.left - left, top: bounds.top + (startMinute - origin) * density - top,
                    width: bounds.width, height: (endMinute - startMinute) * density,
                    label: `${selection.draft.startTime}–${selection.draft.endTime}` };
            }
            setVisual({ left, top, width, height, guide, selection: rectangle });
        }
        function key(event: KeyboardEvent) {
            ctrl = event.ctrlKey;
            if (!ctrl || event.key === "Escape") draggingEdge = null;
            if (selection && (!ctrl || event.key === "Escape")) { event.preventDefault(); selection = null; }
            refreshHint();
        }
        function move(event: PointerEvent) {
            pointer = { x: event.clientX, y: event.clientY };
            if (event.buttons & 2) draggingEdge = null;
            // Layout-generated pointer events can omit modifiers; keyup owns Ctrl release.
            if (event.ctrlKey) ctrl = true;
            if (selection) selection.draft = quickAddSelection(selection.initial, event.clientY - selection.timeline.getBoundingClientRect().top, density, origin, bounds);
            refreshHint();
        }
        function scroll() {
            if (selection && pointer) selection.draft = quickAddSelection(selection.initial, pointer.y - selection.timeline.getBoundingClientRect().top, density, origin, bounds);
            refreshHint();
        }
        function pointerDown(event: PointerEvent) {
            if (!ctrl) return;
            if (event.button === 2) draggingEdge = null;
            else if (event.button === 0) {
                const target = event.target instanceof Element ? event.target : null;
                draggingEdge = target?.closest(".timetable-resize-handle")?.getAttribute("aria-label")?.replace(/^Drag /, "").split(" for ")[0] ?? null;
            }
            refreshHint();
        }
        function pointerUp() { draggingEdge = null; refreshHint(); }
        function blur() { ctrl = false; selection = null; pointer = null; draggingEdge = null; refreshHint(); }
        function cancelSelection(event: MouseEvent) {
            if (!ctrl || !selection || event.button !== 2) return;
            event.preventDefault(); event.stopPropagation();
            suppressContextMenu = true; selection = null; refreshHint();
        }
        function contextMenu(event: MouseEvent) {
            if (!ctrl || (!selection && !suppressContextMenu)) return;
            event.preventDefault(); event.stopPropagation();
            suppressContextMenu = false; selection = null; refreshHint();
        }
        function click(event: MouseEvent) {
            if (event.button !== 0 || !event.ctrlKey || opened) return;
            const timeline = timelineAt(event.clientX, event.clientY);
            if (!timeline) return;
            event.preventDefault(); event.stopPropagation();
            ctrl = true; pointer = { x: event.clientX, y: event.clientY };
            if (!selection) {
                const draft = draftAt(event.clientX, event.clientY);
                if (!draft) return;
                selection = { timeline, initial: draft, draft: quickAddSelection(draft, event.clientY - timeline.getBoundingClientRect().top, density, origin, bounds) };
                refreshHint(); return;
            }
            if (timeline !== selection.timeline) return;
            const minute = Math.round((origin + (event.clientY - timeline.getBoundingClientRect().top) / density) / 5) * 5;
            const start = Number(selection.initial.startTime.slice(0, 2)) * 60 + Number(selection.initial.startTime.slice(3));
            if (minute < start) return;
            const draft = minute === start ? { ...selection.initial, endTime: "" }
                : quickAddSelection(selection.initial, event.clientY - timeline.getBoundingClientRect().top, density, origin, bounds);
            opened = true; blur(); onCreate(draft);
        }
        function doubleClick(event: MouseEvent) {
            if (!event.ctrlKey || event.button !== 0 || opened) return;
            const draft = draftAt(event.clientX, event.clientY);
            if (!draft) return;
            event.preventDefault(); event.stopPropagation();
            opened = true; blur(); onCreate({ ...draft, endTime: "" });
        }
        window.addEventListener("keydown", key);
        window.addEventListener("keyup", key);
        window.addEventListener("blur", blur);
        window.addEventListener("resize", refreshHint);
        window.addEventListener("pointermove", move, true);
        window.addEventListener("pointerdown", pointerDown, true);
        window.addEventListener("pointerup", pointerUp, true);
        element.addEventListener("click", click);
        element.addEventListener("mousedown", cancelSelection);
        element.addEventListener("contextmenu", contextMenu);
        element.addEventListener("pointercancel", blur);
        element.addEventListener("scroll", scroll);
        element.addEventListener("dblclick", doubleClick);
        return () => {
            window.removeEventListener("keydown", key);
            window.removeEventListener("keyup", key);
            window.removeEventListener("blur", blur);
            window.removeEventListener("resize", refreshHint);
            window.removeEventListener("pointermove", move, true);
            window.removeEventListener("pointerdown", pointerDown, true);
            window.removeEventListener("pointerup", pointerUp, true);
            element.removeEventListener("click", click);
            element.removeEventListener("mousedown", cancelSelection);
            element.removeEventListener("contextmenu", contextMenu);
            element.removeEventListener("pointercancel", blur);
            element.removeEventListener("scroll", scroll);
            element.removeEventListener("dblclick", doubleClick);
            element.classList.remove("is-quick-add");
        };
    }, [board, density, origin, wakeTime, sleepTime, enabled, onCreate]);
    return enabled ? <>
        {visual && <div className="quick-add-visual" aria-hidden="true" style={{ left: visual.left, top: visual.top, width: visual.width, height: visual.height }}>
            {visual.guide && <>
                <div className="quick-add-guide" style={{ top: visual.guide.top }} />
                <span className="quick-add-guide-time" style={{ top: visual.guide.labelTop }}>{visual.guide.time}</span>
            </>}
            {visual.selection && <div className="quick-add-selection" style={{ left: visual.selection.left, top: visual.selection.top, width: visual.selection.width, height: visual.selection.height }}><span>{visual.selection.label}</span></div>}
            <div className="quick-add-mode-label">Ctrl mode active. See the instructions in the top-right corner.</div>
        </div>}
        {hint && <div className="quick-add-hint" aria-hidden="true" style={{ left: hint.x, top: hint.y }}><span className="quick-add-plus">+</span><span>{hint.text}</span></div>}
    </> : null;
}
