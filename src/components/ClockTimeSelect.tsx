import { CLOCK_HOURS, CLOCK_MINUTES } from "../clockTime";
import "./ClockTimeSelect.css";

interface Choice { value: string; label: string; disabled?: boolean }

export default function ClockTimeSelect({ label, hour, minute, onHourChange, onMinuteChange, hours, minutes, required = false, disabled = false, minuteDisabled = false, emptyHour = "Hour" }: {
    label: string; hour: string; minute: string;
    onHourChange: (value: string) => void; onMinuteChange: (value: string) => void;
    hours?: Choice[]; minutes?: Choice[]; required?: boolean; disabled?: boolean; minuteDisabled?: boolean; emptyHour?: string;
}) {
    const hourChoices: Choice[] = hours ?? CLOCK_HOURS.map(value => ({ value, label: value }));
    const minuteChoices: Choice[] = minutes ?? CLOCK_MINUTES.map(value => ({ value, label: value }));
    return <div className="clock-time-select" role="group" aria-label={label}>
        <label><span className="sr-only">{label} hour</span><select aria-label={`${label} hour`} required={required} disabled={disabled} value={hour} onChange={event => onHourChange(event.target.value)}>
            <option value="">{emptyHour}</option>
            {hour && !hourChoices.some(choice => choice.value === hour) && <option value={hour} disabled>{hour} (saved)</option>}
            {hourChoices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>)}
        </select></label>
        <span aria-hidden="true" className="clock-time-colon">:</span>
        <label><span className="sr-only">{label} minute</span><select aria-label={`${label} minute`} required={required} disabled={disabled || minuteDisabled} value={minute} onChange={event => onMinuteChange(event.target.value)}>
            <option value="">Minute</option>
            {minute && !minuteChoices.some(choice => choice.value === minute) && <option value={minute} disabled>{minute} (saved)</option>}
            {minuteChoices.map(choice => <option key={choice.value} value={choice.value} disabled={choice.disabled}>{choice.label}</option>)}
        </select></label>
    </div>;
}
