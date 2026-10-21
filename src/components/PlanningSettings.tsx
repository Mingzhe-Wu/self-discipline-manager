import { useState } from "react";
import type { PlanningHours } from "../../shared/types/settings";
import { validatePlanningHours } from "../../shared/scheduling/planningHours";
import { errorMessage } from "../taskFormatting";

const times = Array.from({ length: 289 }, (_, index) => `${String(Math.floor(index / 12)).padStart(2, "0")}:${String(index % 12 * 5).padStart(2, "0")}`);

export default function PlanningSettings({ settings, onSave, onCancel }: { settings: PlanningHours; onSave: (settings: PlanningHours) => Promise<void>; onCancel: () => void }) {
    const [wakeTime, setWakeTime] = useState(settings.wakeTime);
    const [sleepTime, setSleepTime] = useState(settings.sleepTime);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    async function save(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try { await onSave(validatePlanningHours({ wakeTime, sleepTime })); }
        catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); }
    }
    return <form className="task-form" onSubmit={save}>
        <fieldset disabled={busy}>
            <legend className="sr-only">Planning hours</legend>
            <p className="form-hint">Choose the hours available for planning each day. Existing history is kept.</p>
            <label>Wake Time<select data-initial-focus value={wakeTime} onChange={(event) => setWakeTime(event.target.value)}>{times.slice(0, -1).map((time) => <option key={time}>{time}</option>)}</select></label>
            <label>Sleep Time<select value={sleepTime} onChange={(event) => setSleepTime(event.target.value)}>{times.slice(1).map((time) => <option key={time}>{time}</option>)}</select></label>
            {error && <p role="alert" className="notice error">{error}</p>}
            <div className="form-actions"><button type="button" className="secondary-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">{busy ? "Saving…" : "Save planning hours"}</button></div>
        </fieldset>
    </form>;
}
