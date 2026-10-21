import { useRef, useState, type RefObject } from "react";
import type { OccurrenceTarget } from "../../shared/types/task";
import { errorMessage } from "../taskFormatting";
import Dialog from "./Dialog";
import { lifecycleToast, useToast } from "../toast";

export default function ResetOccurrenceDialog({ taskTitle, target, onChange, onClose, fallbackFocus }: {
    taskTitle: string; target: OccurrenceTarget; onChange: () => Promise<void>; onClose: () => void;
    fallbackFocus: RefObject<HTMLElement | null>;
}) {
    const notify = useToast();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const pending = useRef(false);
    async function reset() {
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        setError("");
        try {
            await window.electronAPI.updateTaskOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
            await onChange();
            notify(lifecycleToast("reset", taskTitle));
            onClose();
        } catch (error) { setError(errorMessage(error)); }
        finally { pending.current = false; setBusy(false); }
    }
    return (
        <Dialog title="Reset task?" onClose={onClose} busy={busy} fallbackFocus={fallbackFocus}>
            <div className="reset-confirmation">
                <strong>{taskTitle}</strong>
                <p>Are you sure you want to reset this task?</p>
                <p>The task timing records will also be reset.</p>
                {error && <p role="alert" className="notice error">{error}</p>}
                <div className="form-actions">
                    <button type="button" className="secondary-button" data-initial-focus disabled={busy} onClick={onClose}>Cancel</button>
                    <button type="button" className="primary-button" disabled={busy} onClick={() => void reset()}>{busy ? "Resetting…" : "Reset task"}</button>
                </div>
            </div>
        </Dialog>
    );
}
