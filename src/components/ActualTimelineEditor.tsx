import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { ScheduledOccurrence, TaskOccurrence, UpdateOccurrenceTimesInput } from '../../shared/types/task';
import { ACTUAL_TIME_STEP, actualStatistics, clampActualEndpoint, draggedActualTime, snapActualTime, timelineBar, timelinePosition, timelineScale, validateActualTimes } from '../actualTimeline';
import type { ActualEndpoint, ActualTimes, TimelineScale } from '../actualTimeline';
import { errorMessage } from '../taskFormatting';
import './ActualTimelineEditor.css';
import ActualEndpointControl from './ActualEndpointControl';

interface Props {
    occurrence: ScheduledOccurrence;
    disabled?: boolean;
    onChange: () => Promise<void>;
    onBusyChange: (busy: boolean) => void;
    onSuccess?: (message: string) => void;
    onSave?: (input: UpdateOccurrenceTimesInput) => Promise<TaskOccurrence>;
    onDetached?: (taskId: number) => void;
    information?: ReactNode;
    beforeTiming?: ReactNode;
    hidePlannedSummary?: boolean;
}

interface Drag {
    endpoint: ActualEndpoint;
    pointerId: number;
    element: HTMLButtonElement;
    scale: TimelineScale;
    initial: ActualTimes;
    current: ActualTimes;
    initialX: number;
    anchorValue: number;
    lastX: number;
    pointerOffset: number;
    moved: boolean;
    timer: number;
    width: number;
}

interface SaveFocus {
    element: HTMLElement;
    moved: boolean;
    frame: number | null;
    removeListener: () => void;
}

function timestampLabel(value: number): string {
    return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function durationLabel(value: number): string {
    const milliseconds = Math.abs(value);
    if (milliseconds === 0) return '0 min';
    if (milliseconds < 1_000) return `${milliseconds} ms`;
    const seconds = milliseconds / 1_000;
    if (seconds < 60) return `${Number(seconds.toFixed(3))} sec`;
    const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), remainder = Number((seconds % 60).toFixed(3));
    return [hours ? `${hours} hr` : '', minutes ? `${minutes} min` : '', remainder ? `${remainder} sec` : ''].filter(Boolean).join(' ');
}

function deltaLabel(delta: number | null): string {
    return delta === null ? 'Not recorded' : delta === 0 ? 'On time' : `${durationLabel(delta)} ${delta < 0 ? 'early' : 'late'}`;
}

export default function ActualTimelineEditor({ occurrence, disabled = false, onChange, onBusyChange, onSuccess, onSave, onDetached, information, beforeTiming, hidePlannedSummary = false }: Props) {
    const incoming = { startedAt: occurrence.record?.startedAt ?? null, endedAt: occurrence.record?.endedAt ?? null };
    const [actual, setActual] = useState<ActualTimes>(incoming);
    const [legacyCompleted, setLegacyCompleted] = useState(occurrence.record?.legacyCompleted ?? false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [frozenScale, setFrozenScale] = useState<TimelineScale | null>(null);
    const pending = useRef(false);
    const mounted = useRef(true);
    const drag = useRef<Drag | null>(null);
    const track = useRef<HTMLDivElement>(null);
    const editor = useRef<HTMLElement>(null);
    const saveFocus = useRef<SaveFocus | null>(null);
    const sourceVersion = useRef(0);
    const callbacks = useRef({ onBusyChange, onChange, onSuccess, onSave, onDetached });
    useEffect(() => { callbacks.current = { onBusyChange, onChange, onSuccess, onSave, onDetached }; }, [onBusyChange, onChange, onSuccess, onSave, onDetached]);

    const clearSaveFocus = useCallback(() => {
        const restore = saveFocus.current;
        saveFocus.current = null;
        if (!restore) return;
        restore.removeListener();
        if (restore.frame !== null) cancelAnimationFrame(restore.frame);
    }, []);

    function captureSaveFocus() {
        clearSaveFocus();
        const element = document.activeElement;
        if (!(element instanceof HTMLElement) || !editor.current?.contains(element) || !element.matches('select, input[type="date"], [role="slider"], .actual-endpoint-button')) return;
        const restore: SaveFocus = { element, moved: false, frame: null, removeListener: () => document.removeEventListener('focusin', moved) };
        function moved(event: FocusEvent) {
            if (event.target instanceof HTMLElement && event.target !== element && event.target !== document.body && !event.target.matches(':disabled')) restore.moved = true;
        }
        document.addEventListener('focusin', moved);
        saveFocus.current = restore;
    }

    function restoreSaveFocus() {
        const restore = saveFocus.current;
        if (!restore) return;
        // Disabled controls blur in Chromium. Wait for the React commit that enables them.
        restore.frame = requestAnimationFrame(() => {
            if (saveFocus.current !== restore) return;
            clearSaveFocus();
            if (!mounted.current || pending.current || restore.moved || !restore.element.isConnected || restore.element.matches(':disabled')) return;
            const focused = document.activeElement;
            if (focused === document.body || focused === null || focused === restore.element) restore.element.focus({ preventScroll: true });
        });
    }

    const releaseDrag = useCallback(() => {
        const active = drag.current;
        drag.current = null;
        if (active) window.clearInterval(active.timer);
        if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
        return active;
    }, []);

    const cancelDrag = useCallback(() => {
        const active = releaseDrag();
        if (active) { setActual(active.initial); setFrozenScale(null); }
    }, [releaseDrag]);

    // History corrections arrive through props, including changes to nullable endpoints.
    useEffect(() => {
        sourceVersion.current += 1;
        releaseDrag();
        // The prop is an external source of truth, not a derived render value.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActual({ startedAt: occurrence.record?.startedAt ?? null, endedAt: occurrence.record?.endedAt ?? null });
        setLegacyCompleted(occurrence.record?.legacyCompleted ?? false);
        setFrozenScale(null);
    }, [occurrence.taskId, occurrence.scheduledStartAt, occurrence.scheduledEndAt, occurrence.record?.id, occurrence.record?.updatedAt, occurrence.record?.startedAt, occurrence.record?.endedAt, occurrence.record?.legacyCompleted, releaseDrag]);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            releaseDrag();
            clearSaveFocus();
            if (pending.current) callbacks.current.onBusyChange(false);
        };
    }, [releaseDrag, clearSaveFocus]);

    useEffect(() => {
        if (!frozenScale) return;
        const cancel = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                cancelDrag();
            }
        };
        document.addEventListener('keydown', cancel, true);
        return () => document.removeEventListener('keydown', cancel, true);
    }, [frozenScale, cancelDrag]);

    const scale = frozenScale ?? timelineScale(occurrence.scheduledStartAt, occurrence.scheduledEndAt, actual.startedAt, actual.endedAt);
    const plannedBar = timelineBar(occurrence.scheduledStartAt, occurrence.scheduledEndAt, scale);
    const actualBar = actual.startedAt !== null && actual.endedAt !== null ? timelineBar(actual.startedAt, actual.endedAt, scale) : null;
    const statistics = actualStatistics(occurrence.scheduledStartAt, occurrence.scheduledEndAt, actual);
    const unknown = legacyCompleted && actual.startedAt === null && actual.endedAt === null;
    const missingLabel = unknown ? 'Unknown (imported record)' : 'Not recorded';
    const locked = disabled || busy;

    async function save(next: ActualTimes, previous: ActualTimes = actual) {
        if (pending.current || disabled) return;
        const invalid = validateActualTimes(next);
        if (invalid) { setError(invalid); setActual(previous); return; }
        if (next.startedAt === previous.startedAt && next.endedAt === previous.endedAt && !legacyCompleted) return;
        const originalSourceVersion = sourceVersion.current;
        const previousLegacy = legacyCompleted;
        captureSaveFocus();
        pending.current = true;
        setBusy(true);
        setError('');
        setActual(next);
        setLegacyCompleted(false);
        callbacks.current.onBusyChange(true);
        let saved = false;
        try {
            const target = occurrence.record ? { taskId: occurrence.taskId, occurrenceId: occurrence.record.id } : { taskId: occurrence.taskId, scheduledStartAt: occurrence.scheduledStartAt, scheduledEndAt: occurrence.scheduledEndAt };
            const result = await (callbacks.current.onSave ?? window.electronAPI.updateTaskOccurrenceTimes)({ ...target, ...next });
            saved = true;
            if (mounted.current) { setActual({ startedAt: result.startedAt, endedAt: result.endedAt }); setLegacyCompleted(result.legacyCompleted); }
            await callbacks.current.onChange();
            if (mounted.current) {
                callbacks.current.onSuccess?.('Actual time updated');
                if (result.taskId !== occurrence.taskId) callbacks.current.onDetached?.(result.taskId);
            }
        } catch (failure) {
            if (mounted.current) {
                if (!saved && sourceVersion.current === originalSourceVersion) { setActual(previous); setLegacyCompleted(previousLegacy); }
                setError(saved ? `Actual time saved, but refresh failed. ${errorMessage(failure)}` : `Actual time was not saved. ${errorMessage(failure)}`);
            }
        } finally {
            pending.current = false;
            if (mounted.current) { setBusy(false); callbacks.current.onBusyChange(false); restoreSaveFocus(); }
        }
    }

    function beginDrag(endpoint: ActualEndpoint, event: ReactPointerEvent<HTMLButtonElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        beginDragAt(endpoint, event.currentTarget, event.pointerId, event.clientX);
    }

    function beginDragAt(endpoint: ActualEndpoint, element: HTMLButtonElement, pointerId: number, clientX: number): boolean {
        if (locked || pending.current || drag.current || actual[endpoint] === null || !track.current) return false;
        const bounds = track.current.getBoundingClientRect(), width = bounds.width;
        if (width <= 0) return false;
        element.setPointerCapture(pointerId);
        // Side buttons sit outside the track. Translate their pointer into the
        // endpoint's track position so holding one does not immediately hit an edge.
        const pointerOffset = bounds.left + timelinePosition(actual[endpoint]!, scale) / 100 * width - clientX;
        const active: Drag = { endpoint, pointerId, element, scale, initial: actual, current: actual, initialX: clientX, anchorValue: actual[endpoint]!, lastX: clientX, pointerOffset, moved: false, width, timer: 0 };
        drag.current = active;
        active.timer = window.setInterval(() => {
            if (drag.current !== active || !track.current || !active.moved) return;
            const bounds = track.current.getBoundingClientRect();
            const pointerX = active.lastX + active.pointerOffset;
            const direction = pointerX <= bounds.left + 8 ? -1 : pointerX >= bounds.right - 8 ? 1 : 0;
            if (!direction) return;
            const current = active.current[endpoint]!;
            const next = clampActualEndpoint(endpoint, snapActualTime(current + direction * ACTUAL_TIME_STEP), active.initial);
            if (next === current) return;
            active.current = { ...active.current, [endpoint]: next };
            const extended = timelineScale(occurrence.scheduledStartAt, occurrence.scheduledEndAt, active.current.startedAt, active.current.endedAt);
            active.scale = { start: Math.min(active.scale.start, extended.start), end: Math.max(active.scale.end, extended.end) };
            // Re-anchor after rescaling so moving away from the edge is smooth,
            // and pointer release does not undo the latest automatic step.
            active.initialX = active.lastX;
            active.anchorValue = next;
            active.width = bounds.width;
            setActual(active.current);
            setFrozenScale(active.scale);
        }, 150);
        setError('');
        setFrozenScale(scale);
        return true;
    }

    function previewDrag(event: ReactPointerEvent<HTMLButtonElement>) {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        if (event.clientX === active.lastX) return;
        active.moved = true;
        active.lastX = event.clientX;
        const origin = active.anchorValue;
        const fraction = (origin - active.scale.start) / (active.scale.end - active.scale.start) + (event.clientX - active.initialX) / active.width;
        active.current = { ...active.initial, [active.endpoint]: draggedActualTime(active.endpoint, fraction, active.scale, active.initial) };
        setActual(active.current);
    }

    function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
        if (drag.current?.pointerId !== event.pointerId) return;
        previewDrag(event);
        const active = releaseDrag();
        setFrozenScale(null);
        if (active) void save(active.current, active.initial);
    }

    function adjustEndpoint(endpoint: ActualEndpoint, event: ReactKeyboardEvent<HTMLButtonElement>) {
        const value = actual[endpoint];
        if (value === null || locked || drag.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1;
        void save({ ...actual, [endpoint]: clampActualEndpoint(endpoint, snapActualTime(value + direction * ACTUAL_TIME_STEP), actual) });
    }

    function endpointControl(endpoint: ActualEndpoint) {
        return <ActualEndpointControl endpoint={endpoint} value={actual[endpoint]} fallback={endpoint === 'startedAt' ? occurrence.scheduledStartAt : actual.startedAt ?? occurrence.scheduledEndAt} disabled={locked} selectingDisabled={locked || !!frozenScale} onChange={value => void save({ ...actual, [endpoint]: value })} onHold={({ element, pointerId, clientX }) => beginDragAt(endpoint, element, pointerId, clientX)} onMove={previewDrag} onRelease={endDrag} onCancel={cancelDrag} onKeyDown={event => adjustEndpoint(endpoint, event)} />;
    }

    function handle(endpoint: ActualEndpoint) {
        const value = actual[endpoint];
        if (value === null) return null;
        const label = endpoint === 'startedAt' ? 'Actual start' : 'Actual end';
        return <button key={endpoint} type="button" className={`actual-drag-handle ${endpoint === 'startedAt' ? 'is-start' : 'is-end'}`} role="slider" aria-label={`${label} drag handle`} aria-valuemin={Math.min(scale.start, value)} aria-valuemax={Math.max(scale.end, value)} aria-valuenow={value} aria-valuetext={timestampLabel(value)} title={`Drag ${label.toLowerCase()} · ${timestampLabel(value)}`} disabled={locked} style={{ left: `${timelinePosition(value, scale)}%` }} onPointerDown={event => beginDrag(endpoint, event)} onPointerMove={previewDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={event => adjustEndpoint(endpoint, event)}><span className="sr-only">{label}</span></button>;
    }

    return <section ref={editor} className={`actual-timeline-editor${information ? ' is-integrated' : ''}`} aria-label="Planned versus actual time" aria-busy={busy}>
        {information ?? <div className="actual-timeline-heading"><h4>Planned &amp; actual</h4><span>Same time scale · local time</span></div>}
        {beforeTiming}
        <div className="actual-time-summary">
            {!hidePlannedSummary && <p className="actual-range-label"><strong>Planned</strong> {timestampLabel(occurrence.scheduledStartAt)} – {timestampLabel(occurrence.scheduledEndAt)}</p>}
            <p className="actual-range-label" aria-live="polite"><strong>Actual</strong> {actual.startedAt === null ? missingLabel : timestampLabel(actual.startedAt)}{actual.startedAt !== null && <> – {actual.endedAt === null ? 'Unfinished · end not recorded' : timestampLabel(actual.endedAt)}</>}</p>
        </div>
        <dl className="actual-timeline-statistics">
            <div><dt>Start</dt><dd>{statistics.startDelta === null ? missingLabel : deltaLabel(statistics.startDelta)}</dd></div>
            <div><dt>End</dt><dd>{statistics.endDelta === null ? actual.startedAt === null ? missingLabel : 'Unfinished' : deltaLabel(statistics.endDelta)}</dd></div>
            <div><dt>Planned duration</dt><dd>{durationLabel(statistics.plannedDuration)}</dd></div>
            <div><dt>Actual duration</dt><dd>{statistics.actualDuration === null ? unknown ? 'Unknown' : actual.startedAt === null ? 'Not recorded' : 'Unfinished' : durationLabel(statistics.actualDuration)}</dd></div>
            {statistics.durationDelta !== null && <div className="actual-duration-difference"><dt>Difference</dt><dd>{statistics.durationDelta === 0 ? 'Same duration' : `${durationLabel(statistics.durationDelta)} ${statistics.durationDelta > 0 ? 'longer' : 'shorter'}`}</dd></div>}
        </dl>
        <div className="actual-timeline-chart">
            <div className="actual-range-controls">
                <div className="actual-planned-endpoint"><span className="actual-endpoint-label">Planned start</span><time className="actual-planned-time" aria-label="Planned start" dateTime={new Date(occurrence.scheduledStartAt).toISOString()} title={timestampLabel(occurrence.scheduledStartAt)}>{new Date(occurrence.scheduledStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>
                <div className="actual-center-control"><span className="actual-row-label">Planned</span><div className="actual-timeline-track actual-plan-track" role="img" aria-label={`Planned time range: ${timestampLabel(occurrence.scheduledStartAt)} – ${timestampLabel(occurrence.scheduledEndAt)}`}><div className="actual-planned-bar" style={{ left: `${plannedBar.left}%`, width: `${plannedBar.width}%` }} /></div></div>
                <div className="actual-planned-endpoint"><span className="actual-endpoint-label">Planned end</span><time className="actual-planned-time" aria-label="Planned end" dateTime={new Date(occurrence.scheduledEndAt).toISOString()} title={timestampLabel(occurrence.scheduledEndAt)}>{new Date(occurrence.scheduledEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time></div>
                <span aria-hidden="true" />
                <div className="actual-center-control actual-interactive-track"><span className="actual-row-label">Actual</span><div className="actual-timeline-track" ref={track}>
                    {actualBar && <div className="actual-recorded-bar" style={{ left: `${actualBar.left}%`, width: `${actualBar.width}%` }} />}
                    {actual.startedAt === null && actual.endedAt === null && <span className="actual-empty-label">{missingLabel}</span>}
                    {handle('startedAt')}{handle('endedAt')}
                    <div className="actual-attached-endpoint is-start" style={{ left: `${timelinePosition(actual.startedAt ?? occurrence.scheduledStartAt, scale)}%` }}>{endpointControl('startedAt')}</div>
                    <div className="actual-attached-endpoint is-end" style={{ left: `${timelinePosition(actual.endedAt ?? Math.max(actual.startedAt ?? occurrence.scheduledStartAt, occurrence.scheduledEndAt), scale)}%` }}>{endpointControl('endedAt')}</div>
                </div></div>
                <span aria-hidden="true" />
            </div>
        </div>
        <div className="actual-editor-footer"><p className="form-hint">Set dates and times to backfill. Drag either recorded endpoint or use arrow keys in 5-minute steps. Escape cancels a drag.</p>{(actual.startedAt !== null || actual.endedAt !== null || unknown) && <button type="button" className="text-button" disabled={locked || !!frozenScale} onClick={() => void save({ startedAt: null, endedAt: null })}>Clear actual times</button>}</div>
        {busy && <p role="status" className="actual-save-status">Saving actual time…</p>}
        {error && <p role="alert" className="actual-timeline-error">{error}</p>}
    </section>;
}
