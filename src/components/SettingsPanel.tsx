import { useState } from "react";
import type { LocalPreferences, UpdateLocalPreferencesInput, UserSettings } from "../../shared/types/settings";
import { errorMessage } from "../taskFormatting";

const clocks = Array.from({ length: 289 }, (_, index) => `${String(Math.floor(index / 12)).padStart(2, "0")}:${String(index % 12 * 5).padStart(2, "0")}`);

export default function SettingsPanel({ preferences, onSave, onBusyChange }: {
    preferences: LocalPreferences; onSave: (input: UpdateLocalPreferencesInput) => Promise<LocalPreferences>; onBusyChange: (busy: boolean) => void;
}) {
    const [displayName, setDisplayName] = useState(preferences.profile.displayName);
    const [settings, setSettings] = useState(preferences.settings);
    const [duration, setDuration] = useState(String(preferences.settings.defaultTaskDurationMinutes));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    function change<K extends keyof UserSettings>(key: K, value: UserSettings[K]) { setSettings(current => ({ ...current, [key]: value })); }
    async function save(event: React.SubmitEvent<HTMLFormElement>) {
        event.preventDefault(); if (busy) return;
        setBusy(true); onBusyChange(true); setError("");
        try {
            const saved = await onSave({ displayName, settings: { ...settings, defaultTaskDurationMinutes: Number(duration) } });
            setDisplayName(saved.profile.displayName); setSettings(saved.settings); setDuration(String(saved.settings.defaultTaskDurationMinutes));
        } catch (error) { setError(errorMessage(error)); }
        finally { setBusy(false); onBusyChange(false); }
    }
    return <form className="settings-panel" onSubmit={event => void save(event)}>
        <p className="form-hint">Preferences for this device. Your profile stays local.</p>
        {error && <p role="alert" className="notice error">{error}</p>}
        <section className="settings-section"><fieldset disabled={busy}><legend>Profile</legend>
            <label>Display name<input data-initial-focus value={displayName} maxLength={80} required onChange={event => setDisplayName(event.target.value)} /></label>
        </fieldset></section>
        <section className="settings-section"><fieldset disabled={busy}><legend>Schedule</legend>
            <p className="form-hint">Wake/Sleep are preferred display hours. Tasks outside them remain allowed and visible.</p>
            <div className="settings-fields"><label>Wake time<select aria-label="Wake time" value={settings.wakeTime} onChange={event => change("wakeTime", event.target.value)}>{clocks.slice(0, -1).map(time => <option key={time}>{time}</option>)}</select></label>
            <label>Sleep time<select aria-label="Sleep time" value={settings.sleepTime} onChange={event => change("sleepTime", event.target.value)}>{clocks.slice(1).map(time => <option key={time}>{time}</option>)}</select></label>
            <label>Default task duration (minutes)<input type="number" min={5} max={1435} step={5} required value={duration} onChange={event => setDuration(event.target.value)} /></label>
            <label>Week starts on<select aria-label="Week starts on" value={settings.weekStartsOn} onChange={event => change("weekStartsOn", Number(event.target.value) as 0 | 1)}><option value={1}>Monday</option><option value={0}>Sunday</option></select></label></div>
        </fieldset></section>
        <section className="settings-section"><fieldset disabled={busy}><legend>Notifications</legend>
            <label className="settings-checkbox"><input type="checkbox" checked={settings.notificationsEnabled} onChange={event => change("notificationsEnabled", event.target.checked)} />Enable notifications</label>
            <p className="form-hint">A master switch. Each task keeps its own notification preference.</p>
        </fieldset></section>
        <section className="settings-section"><fieldset disabled={busy}><legend>Desktop</legend>
            <label className="settings-checkbox"><input type="checkbox" checked={settings.closeToTray} onChange={event => change("closeToTray", event.target.checked)} />Close to tray</label>
            <p className="form-hint">* When disabled, closing the window quits the app instead of minimizing it to the Windows tray. Notifications are not sent while the app is closed.</p>
            <label className="settings-checkbox"><input type="checkbox" checked={settings.trayMiniEnabled} onChange={event => change("trayMiniEnabled", event.target.checked)} />Mini schedule enabled</label>
            <p className="form-hint">Mini schedule preference is saved for a future update; the mini view is not available yet.</p>
        </fieldset></section>
        <div className="settings-save-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
    </form>;
}
