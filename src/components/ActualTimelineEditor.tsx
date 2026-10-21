import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import type { ScheduledOccurrence, TaskOccurrence, UpdateOccurrenceTimesInput } from '../../shared/types/task';
import { ACTUAL_TIME_STEP, actualStatistics, clampActualEndpoint, draggedActualTime, snapActualTime, timelineBar, timelinePosition, timelineScale, validateActualTimes } from '../actualTimeline';
import type { ActualEndpoint, ActualTimes, TimelineScale } from '../actualTimeline';
import { errorMessage } from '../taskFormatting';
import './ActualTimelineEditor.css';
import ActualEndpointControl from './ActualEndpointControl';
import Icon from './Icon';

interface Props {
    occurrence: ScheduledOccurrence;
    disabled?: boolean;
    onChange: () => Promise<void>;
    onBusyChange: (busy: boolean) => void;
    onSuccess?: (message: string) => void;
    onSave?: (input: UpdateOccurrenceTimesInput) => Promise<TaskOccurrence>;
    onDetached?: (taskId: number) => void;
    information?: ReactNode;
    informationActions?: ReactNode;
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

export default function ActualTimelineEditor({ occurrence, disabled = false, onChange, onBusyChange, onSuccess, onSave, onDetached, information, informationActions }: Props) {
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
        window.addEventListener('blur', cancelDrag);
        return () => {
            document.removeEventListener('keydown', cancel, true);
            window.removeEventListener('blur', cancelDrag);
        };
    }, [frozenScale, cancelDrag]);

    const scale = frozenScale ?? timelineScale(occurrence.scheduledStartAt, occurrence.scheduledEndAt, actual.startedAt, actual.endedAt);
    const plannedBar = timelineBar(occurrence.scheduledStartAt, occurrence.scheduledEndAt, scale);
    const actualBar = actual.startedAt !== null && actual.endedAt !== null ? timelineBar(actual.startedAt, actual.endedAt, scale) : null;
    const statistics = actualStatistics(occurrence.scheduledStartAt, occurrence.scheduledEndAt, actual);
    const tickStep = ([5, 15, 30, 60, 120, 240, 360, 720].find(minutes => minutes * 60_000 >= (scale.end - scale.start) / 5) ?? 1440) * 60_000;
    const ticks: number[] = [];
    for (let value = Math.ceil(scale.start / tickStep) * tickStep; value <= scale.end; value += tickStep) ticks.push(value);
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
        // Anchor the pointer to the endpoint even when grabbing a handle off-center.
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
        return <ActualEndpointControl endpoint={endpoint} value={actual[endpoint]} fallback={endpoint === 'startedAt' ? occurrence.scheduledStartAt : actual.startedAt ?? occurrence.scheduledEndAt} disabled={locked} selectingDisabled={locked || !!frozenScale} onChange={value => void save({ ...actual, [endpoint]: value })} />;
    }

    function handle(endpoint: ActualEndpoint) {
        const value = actual[endpoint];
        if (value === null) return null;
        const label = endpoint === 'startedAt' ? 'Actual start' : 'Actual end';
        return <button key={endpoint} type="button" className={`actual-drag-handle ${endpoint === 'startedAt' ? 'is-start' : 'is-end'}`} role="slider" aria-label={`${label} drag handle`} aria-valuemin={Math.min(scale.start, value)} aria-valuemax={Math.max(scale.end, value)} aria-valuenow={value} aria-valuetext={timestampLabel(value)} title={`Drag ${label.toLowerCase()} · ${timestampLabel(value)}`} disabled={locked} style={{ left: `${timelinePosition(value, scale)}%` }} onPointerDown={event => beginDrag(endpoint, event)} onPointerMove={previewDrag} onPointerUp={endDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} onKeyDown={event => adjustEndpoint(endpoint, event)}><span className="sr-only">{label}</span></button>;
    }

    function timeMarker(label: string, value: number | null) {
        if (value === null) return null;
        return <span className="timeline-time-marker" style={{ left: `clamp(22px, ${timelinePosition(value, scale)}%, calc(100% - 22px))` }}><span className="sr-only">{label}</span><time dateTime={new Date(value).toISOString()} title={`${label} · ${timestampLabel(value)}`}>{new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</time></span>;
    }

    return <section ref={editor} className={`actual-timeline-editor${information ? ' is-integrated' : ''}`} aria-label="Planned versus actual time" aria-busy={busy}>
        <section className="task-information-card" aria-label="Task information">
        {information && <div className="task-information-fields">{information}</div>}
        <div className="actual-time-summary">
            <p className="actual-range-label"><strong><Icon name="calendar" />Planned</strong><span>{timestampLabel(occurrence.scheduledStartAt)} – {timestampLabel(occurrence.scheduledEndAt)}</span></p>
            <p className="actual-range-label" aria-live="polite"><strong><Icon name="clock" />Actual</strong><span>{actual.startedAt === null ? missingLabel : timestampLabel(actual.startedAt)}{actual.startedAt !== null && <> – {actual.endedAt === null ? 'Unfinished · end not recorded' : timestampLabel(actual.endedAt)}</>}</span></p>
        </div>
        {informationActions}
        </section>
        <section className="timing-summary-card" aria-label="Timing summary">
        <h4 className="timing-summary-heading">Timing summary</h4>
        <dl className="actual-timeline-statistics">
            <div className="timing-stat timing-stat-start"><dt><Icon name="clock" />Start</dt><dd>{statistics.startDelta === null ? missingLabel : deltaLabel(statistics.startDelta)}</dd></div>
            <div className="timing-stat timing-stat-end"><dt><Icon name="check" />End</dt><dd>{statistics.endDelta === null ? actual.startedAt === null ? missingLabel : 'Unfinished' : deltaLabel(statistics.endDelta)}</dd></div>
            <div className="timing-stat"><dt><Icon name="hourglass" />Planned duration</dt><dd>{durationLabel(statistics.plannedDuration)}</dd></div>
            <div className="timing-stat"><dt><Icon name="clock" />Actual duration</dt><dd>{statistics.actualDuration === null ? unknown ? 'Unknown' : actual.startedAt === null ? 'Not recorded' : 'Unfinished' : durationLabel(statistics.actualDuration)}</dd></div>
            <div className="timing-stat actual-duration-difference"><dt><Icon name="activity" />Difference</dt><dd>{statistics.durationDelta === null ? missingLabel : statistics.durationDelta === 0 ? 'Same duration' : `${durationLabel(statistics.durationDelta)} ${statistics.durationDelta > 0 ? 'longer' : 'shorter'}`}</dd></div>
        </dl>
        </section>
        <section className="actual-comparison-card" aria-label="Planned and actual timeline">
        <div className="actual-timeline-heading"><h4>Planned vs actual</h4><div className="timeline-legend"><span><i />Planned</span><span><i />Actual</span></div></div>
        <section className="actual-timeline-chart" aria-label="Drag to adjust">
            <h5 className="sr-only">Drag to adjust</h5>
            <div className="timeline-time-axis" aria-hidden="true">{ticks.map(value => <span key={value} style={{ left: `${timelinePosition(value, scale)}%` }}>{new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</span>)}</div>
            <div className="actual-range-controls">
                <div className="actual-center-control"><span className="sr-only">Planned</span><div className="actual-timeline-track actual-plan-track" role="img" aria-label={`Planned time range: ${timestampLabel(occurrence.scheduledStartAt)} – ${timestampLabel(occurrence.scheduledEndAt)}`}><div className="actual-planned-bar" style={{ left: `${plannedBar.left}%`, width: `${plannedBar.width}%` }} /></div></div>
                <div className="timeline-range-markers">{timeMarker('Planned start', occurrence.scheduledStartAt)}{timeMarker('Planned end', occurrence.scheduledEndAt)}</div>
                <div className="actual-center-control actual-interactive-track"><span className="sr-only">Actual</span><div className="actual-timeline-track" ref={track}>
                    {actualBar && <div className="actual-recorded-bar" style={{ left: `${actualBar.left}%`, width: `${actualBar.width}%` }} />}
                    {actual.startedAt === null && actual.endedAt === null && <span className="actual-empty-label">{missingLabel}</span>}
                    {handle('startedAt')}{handle('endedAt')}
                </div></div>
                <div className="timeline-range-markers" aria-live="polite">{timeMarker('Actual start', actual.startedAt)}{timeMarker('Actual end', actual.endedAt)}</div>
            </div>
        </section>
        <section className="actual-exact-input-area" aria-label="Exact time input">
        <h5 className="actual-layer-heading">Exact time input</h5>
        <div className="actual-time-selectors">{endpointControl('startedAt')}{endpointControl('endedAt')}</div>
        <div className="actual-editor-footer"><p className="form-hint">Set dates and times to backfill. Drag either recorded endpoint or use the selectors above. Times change in 5-minute steps. Arrow keys adjust focused handles; Escape cancels a drag.</p>{(actual.startedAt !== null || actual.endedAt !== null || unknown) && <button type="button" className="text-button" disabled={locked || !!frozenScale} onClick={() => void save({ startedAt: null, endedAt: null })}>Clear actual times</button>}</div>
        {busy && <p role="status" className="actual-save-status">Saving actual time…</p>}
        {error && <p role="alert" className="actual-timeline-error">{error}</p>}
        </section>
        </section>
    </section>;
}
