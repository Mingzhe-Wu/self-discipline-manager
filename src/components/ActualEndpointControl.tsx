import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ActualEndpoint } from '../actualTimeline';
import { localTimeOptions, snapActualTime } from '../actualTimeline';
import { localDateInput } from '../taskFormatting';

export interface ActualHoldPointer { element: HTMLButtonElement; pointerId: number; clientX: number }
interface Props {
    endpoint: ActualEndpoint; value: number | null; fallback: number; disabled: boolean; selectingDisabled: boolean;
    onChange: (value: number | null) => void;
    onHold: (pointer: ActualHoldPointer) => boolean;
    onMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onRelease: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onCancel: () => void;
    onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => void;
}

export default function ActualEndpointControl({ endpoint, value, fallback, disabled, selectingDisabled, onChange, onHold, onMove, onRelease, onCancel, onKeyDown }: Props) {
    const id = useId();
    const label = endpoint === 'startedAt' ? 'Actual start' : 'Actual end';
    const [emptyDate, setEmptyDate] = useState(() => localDateInput(fallback));
    const date = value === null ? emptyDate : localDateInput(value);
    const options = useMemo(() => localTimeOptions(date, value), [date, value]);
    const [open, setOpen] = useState(false);
    const [dragging, setDragging] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const suppressClick = useRef(false);
    const hold = useRef<{ pointer: ActualHoldPointer; y: number; timer: number; active: boolean } | null>(null);
    const cancelRef = useRef(onCancel);
    const holdAction = useRef({ onHold, disabled, value });
    const positionPanel = useCallback(() => {
        const node = panel.current, bounds = button.current?.getBoundingClientRect();
        if (!node || !bounds) return;
        node.style.left = `${Math.max(12, Math.min(window.innerWidth - 232, bounds.left))}px`;
        node.style.top = `${Math.max(12, Math.min(window.innerHeight - 170, bounds.bottom + 8))}px`;
    }, []);
    useLayoutEffect(() => { if (open) positionPanel(); }, [open, value, positionPanel]);
    useEffect(() => { cancelRef.current = onCancel; }, [onCancel]);
    useEffect(() => { holdAction.current = { onHold, disabled, value }; }, [onHold, disabled, value]);
    useEffect(() => {
        const cancel = () => {
            const candidate = hold.current;
            hold.current = null;
            if (!candidate) return;
            window.clearTimeout(candidate.timer);
            suppressClick.current = true;
            if (candidate.active) cancelRef.current();
            if (candidate.pointer.element.hasPointerCapture(candidate.pointer.pointerId)) candidate.pointer.element.releasePointerCapture(candidate.pointer.pointerId);
            setDragging(false);
        };
        window.addEventListener('blur', cancel);
        return () => { window.removeEventListener('blur', cancel); if (hold.current) window.clearTimeout(hold.current.timer); };
    }, []);

    function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
        if (event.button !== 0 || disabled) return;
        suppressClick.current = false;
        if (value === null) return;
        const element = event.currentTarget;
        element.setPointerCapture(event.pointerId);
        const candidate = { pointer: { element, pointerId: event.pointerId, clientX: event.clientX }, y: event.clientY, timer: 0, active: false };
        hold.current = candidate;
        candidate.timer = window.setTimeout(() => {
            if (hold.current !== candidate || holdAction.current.disabled || holdAction.current.value === null) return;
            panel.current?.hidePopover();
            candidate.active = holdAction.current.onHold(candidate.pointer);
            if (candidate.active) { suppressClick.current = true; setDragging(true); }
        }, 200);
    }
    function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
        const candidate = hold.current;
        if (!candidate || candidate.pointer.pointerId !== event.pointerId) return;
        if (candidate.active) { onMove(event); return; }
        if (Math.hypot(event.clientX - candidate.pointer.clientX, event.clientY - candidate.y) > 8) {
            window.clearTimeout(candidate.timer);
            suppressClick.current = true;
        }
    }
    function finish(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
        const candidate = hold.current;
        if (!candidate || candidate.pointer.pointerId !== event.pointerId) return;
        hold.current = null;
        window.clearTimeout(candidate.timer);
        if (candidate.active) {
            if (cancelled) onCancel(); else onRelease(event);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setDragging(false);
    }
    function changeDate(next: string) {
        setEmptyDate(next);
        if (value === null || !next) return;
        const original = new Date(value), updated = new Date(`${next}T00:00:00`);
        updated.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
        onChange(snapActualTime(updated.getTime()));
    }
    return <div className="actual-endpoint-control">
        <span className="actual-endpoint-label">{label}</span>
        <button ref={button} type="button" className={`actual-endpoint-button${dragging ? ' is-dragging' : ''}`} disabled={disabled} aria-label={`Choose ${label.toLowerCase()} time`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} title="Click to choose a time. Hold, then drag to adjust." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onKeyDown={onKeyDown} onClick={event => {
            if (event.detail > 0 && suppressClick.current) { suppressClick.current = false; return; }
            const node = panel.current;
            if (!node) return;
            if (node.matches(':popover-open')) { node.hidePopover(); return; }
            positionPanel();
            node.showPopover();
        }}><span>{value === null ? 'Not recorded' : new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span><span aria-hidden="true">▾</span></button>
        <div ref={panel} id={id} popover="auto" role="dialog" aria-label={`${label} selection`} className="actual-endpoint-popover" onToggle={event => setOpen(event.newState === 'open')}>
            <fieldset className="actual-endpoint" disabled={selectingDisabled}>
                <legend>{label}</legend>
                <div className="actual-endpoint-inputs">
                    <label><span className="sr-only">{label} date (local)</span><input aria-label={`${label} date (local)`} type="date" value={date} onChange={event => changeDate(event.target.value)} /></label>
                    <label><span className="sr-only">{label} time (local)</span><select aria-label={`${label} time (local)`} value={value ?? ''} onChange={event => onChange(event.target.value === '' ? null : Number(event.target.value))}>
                        <option value="">Not recorded</option>
                        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select></label>
                </div>
            </fieldset>
        </div>
    </div>;
}
