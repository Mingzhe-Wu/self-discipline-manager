import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { PlanningHours } from "../../shared/types/settings";
import { quickAddDraft } from "../timetableQuickAdd";
import type { QuickAddDraft } from "../timetableQuickAdd";

interface QuickAddVisual {
    left: number; top: number; width: number; height: number;
    guide: { top: number; labelTop: number; time: string } | null;
}

/** Keep pointer-following state separate from the timetable cards. */
export default function TimetableQuickAdd({ board, density, origin, hours, enabled, onCreate }: {
    board: RefObject<HTMLDivElement | null>; density: number; origin: number;
    hours: PlanningHours; enabled: boolean; onCreate: (draft: QuickAddDraft) => void;
}) {
    const [hint, setHint] = useState<{ x: number; y: number } | null>(null);
    const [visual, setVisual] = useState<QuickAddVisual | null>(null);
    useEffect(() => {
        const element = board.current;
        if (!element || !enabled) return;
        let ctrl = false;
        let opened = false;
        let pointer: { x: number; y: number } | null = null;
        function draftAt(x: number, y: number) {
            const target = document.elementFromPoint(x, y);
            if (!target?.matches(".day-timeline, .timeline-line, .empty-day") || !element!.contains(target)) return null;
            // The clock label ignores pointer events; still treat its visible area as a label.
            const clockLabel = element!.querySelector(".current-time-line span")?.getBoundingClientRect();
            if (clockLabel && x >= clockLabel.left && x <= clockLabel.right && y >= clockLabel.top && y <= clockLabel.bottom) return null;
            const timeline = target.closest<HTMLElement>(".day-timeline");
            const date = timeline?.closest<HTMLElement>(".day-column")?.dataset.date;
            return timeline && date ? quickAddDraft(date, y - timeline.getBoundingClientRect().top, density, origin, hours) : null;
        }
        function refreshHint() {
            const draft = ctrl && !opened && pointer ? draftAt(pointer.x, pointer.y) : null;
            const active = draft !== null;
            element!.classList.toggle("is-quick-add", active);
            setHint(active && pointer ? { x: Math.max(8, Math.min(pointer.x + 14, window.innerWidth - 300)), y: Math.min(pointer.y + 16, window.innerHeight - 42) } : null);
            if (!ctrl || opened) { setVisual(null); return; }
            const viewport = element!.getBoundingClientRect();
            const axis = element!.querySelector(".time-axis")?.getBoundingClientRect();
            const heading = element!.querySelector(".day-column h2")?.getBoundingClientRect();
            const left = Math.max(viewport.left + element!.clientLeft, axis?.right ?? viewport.left);
            const top = Math.max(viewport.top + element!.clientTop, heading?.bottom ?? viewport.top);
            const width = Math.max(0, viewport.left + element!.clientLeft + element!.clientWidth - left);
            const height = Math.max(0, viewport.top + element!.clientTop + element!.clientHeight - top);
            let guide: QuickAddVisual["guide"] = null;
            if (draft && pointer) {
                const timeline = document.elementFromPoint(pointer.x, pointer.y)?.closest(".day-timeline");
                if (timeline) {
                    // Reuse the prefill's selected clock; do not introduce another snap rule.
                    const minute = Number(draft.startTime.slice(0, 2)) * 60 + Number(draft.startTime.slice(3));
                    const lineTop = timeline.getBoundingClientRect().top + (minute - origin) * density - top;
                    guide = { top: Math.max(0, Math.min(height, lineTop)), labelTop: Math.max(4, Math.min(height - 24, lineTop - 25)), time: draft.startTime };
                }
            }
            setVisual({ left, top, width, height, guide });
        }
        function key(event: KeyboardEvent) {
            ctrl = event.ctrlKey;
            refreshHint();
        }
        function move(event: PointerEvent) {
            pointer = { x: event.clientX, y: event.clientY };
            ctrl = event.ctrlKey;
            refreshHint();
        }
        function leave() { pointer = null; refreshHint(); }
        function blur() { ctrl = false; leave(); }
        function doubleClick(event: MouseEvent) {
            if (!event.ctrlKey || event.button !== 0 || opened) return;
            const draft = draftAt(event.clientX, event.clientY);
            if (!draft) return;
            event.preventDefault();
            event.stopPropagation();
            opened = true;
            blur();
            onCreate(draft);
        }
        window.addEventListener("keydown", key);
        window.addEventListener("keyup", key);
        window.addEventListener("blur", blur);
        window.addEventListener("resize", refreshHint);
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerleave", leave);
        element.addEventListener("scroll", leave);
        element.addEventListener("dblclick", doubleClick);
        return () => {
            window.removeEventListener("keydown", key);
            window.removeEventListener("keyup", key);
            window.removeEventListener("blur", blur);
            window.removeEventListener("resize", refreshHint);
            element.removeEventListener("pointermove", move);
            element.removeEventListener("pointerleave", leave);
            element.removeEventListener("scroll", leave);
            element.removeEventListener("dblclick", doubleClick);
            element.classList.remove("is-quick-add");
        };
    }, [board, density, origin, hours, enabled, onCreate]);
    return enabled ? <>
        {visual && <div className="quick-add-visual" aria-hidden="true" style={{ left: visual.left, top: visual.top, width: visual.width, height: visual.height }}>
            {visual.guide && <>
                <div className="quick-add-guide" style={{ top: visual.guide.top }} />
                <span className="quick-add-guide-time" style={{ top: visual.guide.labelTop }}>{visual.guide.time}</span>
            </>}
            <div className="quick-add-mode-label">Hold ctrl to add a new task</div>
        </div>}
        {hint && <div className="quick-add-hint" aria-hidden="true" style={{ left: hint.x, top: hint.y }}><span className="quick-add-plus">+</span><span>Double-click to add a task at this time</span></div>}
    </> : null;
}
