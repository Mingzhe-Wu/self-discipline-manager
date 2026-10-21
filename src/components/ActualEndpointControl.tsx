import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActualEndpoint } from '../actualTimeline';
import { localTimeOptions, snapActualTime } from '../actualTimeline';
import { localDateInput } from '../taskFormatting';

interface Props {
    endpoint: ActualEndpoint; value: number | null; fallback: number; disabled: boolean; selectingDisabled: boolean;
    onChange: (value: number | null) => void;
}

export default function ActualEndpointControl({ endpoint, value, fallback, disabled, selectingDisabled, onChange }: Props) {
    const id = useId();
    const label = endpoint === 'startedAt' ? 'Actual start' : 'Actual end';
    const [emptyDate, setEmptyDate] = useState(() => localDateInput(fallback));
    const date = value === null ? emptyDate : localDateInput(value);
    const options = useMemo(() => localTimeOptions(date, value), [date, value]);
    const [open, setOpen] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const positionPanel = useCallback(() => {
        const node = panel.current, bounds = button.current?.getBoundingClientRect();
        if (!node || !bounds) return;
        node.style.left = `${Math.max(12, Math.min(window.innerWidth - 232, bounds.left))}px`;
        node.style.top = `${Math.max(12, Math.min(window.innerHeight - 170, bounds.bottom + 8))}px`;
    }, []);
    useLayoutEffect(() => { if (open) positionPanel(); }, [open, value, positionPanel]);
    function changeDate(next: string) {
        setEmptyDate(next);
        if (value === null || !next) return;
        const original = new Date(value), updated = new Date(`${next}T00:00:00`);
        updated.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds());
        onChange(snapActualTime(updated.getTime()));
    }
    return <div className="actual-endpoint-control">
        <span className="actual-endpoint-label">{label}</span>
        <button ref={button} type="button" className="actual-endpoint-button" disabled={disabled} aria-label={`Choose ${label.toLowerCase()} time`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} title="Choose an exact time" onClick={() => {
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
