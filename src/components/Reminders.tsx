import { useEffect, useRef, useState } from "react";
import type { Reminder } from "../../shared/types/reminder";

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Unable to update reminders";
}

export default function Reminders() {
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [title, setTitle] = useState("");
    const [time, setTime] = useState("");
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const requestVersion = useRef(0);

    useEffect(() => {
        let active = true;
        async function refresh() {
            const version = ++requestVersion.current;
            try {
                const loaded = await window.electronAPI.listReminders();
                if (active && version === requestVersion.current) {
                    setReminders(loaded);
                    setError("");
                }
            } catch (error) {
                if (active && version === requestVersion.current) setError(errorMessage(error));
            } finally {
                if (active) setLoading(false);
            }
        }
        void refresh();
        // Refresh the notified status and refresh when returning from tray.
        const interval = window.setInterval(() => void refresh(), 60_000);
        window.addEventListener("focus", refresh);
        return () => {
            active = false;
            window.clearInterval(interval);
            window.removeEventListener("focus", refresh);
        };
    }, []);

    async function createReminder(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        const dueAt = new Date(time).getTime();
        if (!title.trim() || !Number.isFinite(dueAt)) {
            setError("Enter a title and a valid local date and time.");
            return;
        }
        setBusy(true);
        setError("");
        ++requestVersion.current;
        try {
            const created = await window.electronAPI.createReminder({ title, dueAt });
            ++requestVersion.current;
            setReminders((current) => [...current.filter((item) => item.id !== created.id), created]
                .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id));
            setTitle("");
            setTime("");
        } catch (error) {
            setError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    async function deleteReminder(id: number) {
        setBusy(true);
        setError("");
        ++requestVersion.current;
        try {
            await window.electronAPI.deleteReminder(id);
            ++requestVersion.current;
            setReminders((current) => current.filter((item) => item.id !== id));
        } catch (error) {
            setError(errorMessage(error));
        } finally {
            setBusy(false);
        }
    }

    return (
        <section aria-labelledby="reminders-heading">
            <h2 id="reminders-heading">Reminders</h2>
            <p>Use your local time. Reminders are checked every minute while the app is running.</p>
            <form onSubmit={createReminder}>
                <fieldset disabled={busy || loading}>
                    <legend>New reminder</legend>
                    <label>
                        Reminder title
                        <input required value={title} onChange={(event) => setTitle(event.target.value)} />
                    </label>
                    <label>
                        Remind me at
                        <input required type="datetime-local" value={time} onChange={(event) => setTime(event.target.value)} />
                    </label>
                    <button type="submit">Add Reminder</button>
                </fieldset>
            </form>
            {error && <p role="alert">{error}</p>}
            {loading ? <p>Loading reminders...</p> : reminders.length === 0 ? <p>No reminders yet.</p> : (
                <ul>
                    {reminders.map((reminder) => (
                        <li key={reminder.id}>
                            <span>{reminder.title} — {new Date(reminder.dueAt).toLocaleString()} — {reminder.notified ? "Notified" : "Pending"}</span>{" "}
                            <button type="button" disabled={busy} onClick={() => void deleteReminder(reminder.id)} aria-label={`Delete reminder: ${reminder.title}`}>Delete</button>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
