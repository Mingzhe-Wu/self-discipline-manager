# Planning hours and occurrence editing

> Historical implementation notes below. Current policy: Wake/Sleep are display preferences, never save constraints; the timetable targets eight visible hours and uses lifecycle-based actual geometry. The current Missed/Late Start behavior and exceptions are documented in [Missed workflow](missed-workflow.md).

The existing renderer → preload → validated IPC → service → repository → Drizzle → SQLite boundary remains intact. No Missed/overdue workflow or cloud features were added.

## Planning hours

`planning_settings` is a singleton SQLite row(id1) with wake_time/sleep_time. The fallback00:00–24:00 deliberately preserves existing installations until the user narrows it in Planning hours. Input is five-minute wall time; sleep must follow wake on the same planning day. Settings remain local in the existing userData database.

New/changed plans must fit these hours in their task's saved IANA zone. Both rule clocks and realized DST ranges are checked across a seasonal cycle. Unchanged legacy plans retain exact timestamps; changing settings checks precise containment without rounding or requiring old data to match new five-minute rules. Disabled notifications do not disable recurrence. Saving an excluding window is blocked with conflicting task names. Elapsed/completed one-time history does not block it; infinite recurring rules still have future expectations. No historical time is rewritten.

The viewer uses the system local zone. Historical or foreign-zone blocks outside today's configured display bounds explicitly extend the visible range with a notice, rather than disappear silently.

## Viewport and visibility

The user chose roughly ten visible hours over retaining the former2px/min constant. `timetableViewport.ts` derives a single linear pixels-per-minute scale from scrollport height after the76px sticky headings. Planning windows longer than ten hours scroll, and all cards share the same scale. Position and height depend only on planned start/end; actual activity never changes geometry.

A muted red current-time line renders only on today's column, while the column has a subtle full-height outline/background. The clock updates every30seconds independently of data loading. Initial mounting and the narrow main→preload onWindowShown event recenter current local time, clamped to the nearest display boundary. Timer reloads, normal focus and browsing do not force scroll. Window geometry is centered and capped to the primary display workArea; the timetable owns scrolling.

Existing connected shared-start/shared-end grouping, deterministic columns/layers and reversible hover remain. Very short blocks keep their true minute geometry; a transparent native button offers at least24px of hit height. Hover/focus uses the existing64px preview, below the block if sticky headings would cover it. Tiny-but-readable blocks retain12px titles; only micro blocks use8px text until expanded. The primary card still starts/ends and confirms Finished resets. Details is a separate sibling native button. Hover state/action wording, normal-ink/red action cycle, reduced-motion fallback and press feedback remain.

## Recurring occurrence editing

Opening a rendered occurrence passes its exact planned range and persisted ID when present into details and the common edit form. Sync changes to other occurrences defaults ON. ON updates the parent recurrence through the existing forward cutover: meaningful older planned/actual facts remain History.

OFF requires a future one-time replacement. One repository transaction inserts `recurrence_exclusions(task_id,scheduled_start_at,scheduled_end_at,created_at)` and creates the independent task. The unique exact-range key suppresses the original from projection, materialization, Start and queued/due notifications across restarts. A later rule with a different range remains a new expectation; reverting to the original exact range retains its exclusion. No task is duplicated per weekday.

A pristine original row may be removed; meaningful actual history and delivery slots remain under the parent, with future reminders suppressed. Even a started/completed original can be replanned this way: its actual timestamps are neither copied into the new task nor rewritten. The replacement starts Planned with null actual times. Deleting the replacement does not restore the excluded original automatically.

Plan editing and History are separate. Details pairs Planned and Actual from the same selected/current occurrence; History supports precise actual-time correction/backfill and puts record-entry/source information behind Record details. Task deletion asks for confirmation and uses the existing soft deletion, retaining stored history.

## Forms and verification

New tasks default to one hour. Moving Start preserves the initial duration until End is manually edited; after that End stays user-controlled. Cross-midnight/out-of-window results show validation errors rather than silently wrapping or rounding actual history.

Migration0006 adds only planning_settings and recurrence_exclusions with a generated Drizzle snapshot/journal. Existing task, occurrence, actual time and delivery rows are unchanged by the migration. Runtime SQL uses no unregistered application functions.

Tests include planning-settings, occurrence-planning, timetable-viewport, task-form-times and the existing lifecycle/migration/security suite. `tests/windows-planning.cjs <unpacked.exe>` covers settings/error persistence, ten-hour density, show-only centering, sync modes, history, delete cancellation/confirmation and restart. `tests/windows-installed.cjs` retains lifecycle/overlap/tray/native scheduler regression checks. Both use isolated profiles, never the real user database.

Historical verification for the original planning extension:103 automated tests, TypeScript, ESLint and production build passed; final unpacked Electron evidence planning-ui-ITZrVz + installed-Scdnvz under ignored release/verification. Screenshots reviewed at desktop and760px; existing regression additionally checks1280/600/320px. Browser plugin unavailable, so both GUI suites use Playwright Electron. Native notification show succeeded once without failure.

UI files changed: App.tsx; components/WeekSchedule, TaskForm, TaskDetails, TaskHistory, Dialog; new components/PlanningSettings; index.css; new taskFormTimes.ts and timetableViewport.ts. Backend files: schema +0006SQL/snapshot/journal, taskRepository/taskService, reminderService, scheduling/week, new settings types/pure validators/repository/service/IPC, preload/electron.d.ts, main/windowSizing. New tests: planning-settings, occurrence-planning, task-form-times, timetable-viewport, windows-planning; existing security/lifecycle/migration and installed GUI tests updated.

Current follow-up verification: 114 automated tests, TypeScript, ESLint and production build, plus isolated category UI/restart checks. Task categories and migration0007 are documented in [task categories](task-categories.md). Timetable cards now use a fifteen-minute visual minimum, group width 1.05 / count and centered hover expansion; saved planned/actual times remain unchanged.

Current storage/UI: migration 0008 consolidates the singleton planning_settings row into user_settings with the Wake/Sleep values preserved. The top toolbar now opens Settings; its Schedule section replaces the old independent Planning hours form. See [Local Profile and Settings](local-profile-settings.md).
