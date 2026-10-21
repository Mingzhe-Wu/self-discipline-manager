# Local Profile and Settings

This is one local identity and one set of preferences for this installation. There is no account, authentication, password, email, cloud service or user switching. Tasks have no user foreign key.

## Persistent model and migration

Migration `0008_local_profile_settings.sql` creates two singleton tables (primary key constrained to `1`):

- `local_profiles`: display name, created/updated timestamps. The default name is **Local User**. Missing defaults are automatically recreated without replacing existing preferences.
- `user_settings`: Wake/Sleep, default duration, week start, notification master switch, floating mini-view startup preference and close-to-tray. An internal `notifications_resume_at` watermark controls delivery resumption; it is not an editable UI field.

The migration copies existing `planning_settings.wake_time/sleep_time` into `user_settings` before dropping the old table. Fresh installations receive 00:00–24:00 display hours, 60-minute duration, Monday start, notifications on, mini schedule off and close-to-tray on. Existing per-task notification flags remain untouched; there was no pre-existing global notification switch or persisted default duration/week start to import.

All migration statements are SQLite-native and run inside the existing runtime migration transaction. Task, occurrence, category, actual timing, reminder-slot and recurrence-exclusion tables are not modified. `window-state.json` remains the sole owner of bounds/maximized state; it is deliberately separate from user-editable desktop preferences.

## Layers and important files

| File | Responsibility / callers | Read |
| --- | --- | --- |
| `shared/types/settings.ts` | LocalProfile/UserSettings/LocalPreferences DTOs, typed patches and defaults, shared by renderer/preload/service. | Deep |
| `electron/db/schema.ts` and migration/snapshot/journal | Singleton storage and safe consolidation from the old settings table. | Deep for schema changes |
| `electron/db/settingsRepository.ts` | Drizzle reads/writes and insert-if-missing defaults only. Called by Settings Service. | Role |
| `electron/services/settingsService.ts` | Profile/patch validation, one settings source, resume watermark policy. Display name is trimmed (1–80 chars); duration is 5–1435 minutes in steps of five. | Deep |
| `electron/ipc/settingsIpc.ts`, preload, `src/electron.d.ts` | Sender-validated getLocalPreferences/updateLocalProfile/updateUserSettings methods. No raw IPC exposure. Existing planning-hours methods remain compatibility facades over the same row. | Role |
| `src/components/SettingsPanel.tsx` | Profile, Schedule, Notifications and Desktop section forms. A single bottom Save validates and atomically persists every section. Replaces the unused PlanningSettings component. | Role |
| `src/App.tsx` | Loads preferences, applies saves/toasts immediately, anchors week navigation to the selected start day, supplies new-task defaults. | Deep for week navigation |
| `shared/scheduling/week.ts` | Pure week boundaries with optional Monday/Sunday start (Monday default); does not modify recurrence weekday numbering or Task dates. | Deep |
| `src/taskFormTimes.ts`, TaskForm, timetable quick-add | Configured creation duration; ordinary planned validation and deliberate start-only quick-create remain intact. | Role |
| `electron/services/reminderService.ts` | Master switch and delivery watermark checked both when selecting and claiming/rechecking reminders. | Deep |
| `electron/main.ts` | Initializes local preferences after migrations; reads close-to-tray at window close. Quit still saves geometry and stops scheduler before closing SQLite. | Role |

## Runtime behavior

Settings opens from the top toolbar. One **Save** button at the bottom saves Profile and all settings together and shows **Settings saved**. Changes need no restart. All fields remain drafts until Save; invalid input or a database failure leaves the entire previous profile/settings unchanged.

Wake/Sleep remains display-only. Out-of-window tasks expand the timetable and remain schedulable. Settings changes never rewrite existing tasks or history. Default duration affects future creation only; moving a new Task's start preserves that duration until its end is manually edited. Existing same-day Add/Edit validation remains, and start-only Ctrl quick-create still deliberately leaves End blank.

Week start supports Monday/Sunday, changes column order/navigation boundaries and preserves the intended browsed week (current-week views remain current). Recurrence rules keep their original dates, zones and weekday keys. The normal density and scroll/recenter rules remain.

Turning notifications off suppresses future native delivery globally without changing task flags or durable slots. Turning them back on stores a resume timestamp: only slots whose target is at/after that timestamp are eligible. An unsent slot that elapsed while disabled is not replayed, even after restart. Upcoming future slots follow the existing latest-slot/idempotency policy.

Close-to-tray defaults to the previous hide behavior. Turning it off uses normal application quit and cleanup when closing the main window. The mini-schedule flag now opens a floating Today ball on startup; the tray can show/hide it independently. See [Desktop mini view](desktop-mini-view.md) for docking, fullscreen visibility and synchronization.

## Verification and intentional deferrals

`tests/local-settings.cjs` covers defaults, validation, singleton/restart persistence, watermark recovery, creation duration, week ordering, old settings migration and unchanged history. Lifecycle tests cover close-to-tray behavior. `tests/windows-local-settings.cjs` uses an isolated profile for unified saving, Sunday ordering, duration defaults, out-of-Wake creation and restart recovery.

`tests/verify-profile-settings-copy.cjs` opens the existing database read-only, uses SQLite's online backup to include committed WAL data, and upgrades only the workspace copy. Verified real snapshot: migration count **8 → 9**; **17 Tasks, 73 occurrences, 31 reminder slots and 2 exclusions** preserved with identical row hashes; Wake/Sleep preserved; integrity and foreign keys passed. Evidence: `release/verification/profile-migration-0idaw0/result.json` (ignored generated output). The live database was not migrated by this check.

Drizzle generation reports no remaining schema diff. That settings-only verification did not rebuild NSIS or launch the real profile. The subsequent mini implementation is documented separately in [Desktop mini view](desktop-mini-view.md).

Unified saving uses the narrow updateLocalPreferences IPC operation. Settings Service validates profile and settings before Settings Repository commits both rows in one transaction; earlier narrow update methods remain compatible for internal callers.
