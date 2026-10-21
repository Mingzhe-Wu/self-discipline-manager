# Occurrence lifecycle and reminder slots

Goal: planned → started → ended occurrences with immutable planned time, editable actual times, durable independent reminders and compact desktop chrome. Preserve existing layers, rules/history projection, native lifecycle and packaging.

## Decisions / contracts

- TaskOccurrence replaces completedAt/completionSource/notificationState with startedAt/endedAt (nullable Unix ms), progressSource (normal/backfill/corrected/legacy|null), recordedAt (first lifecycle entry), legacyCompleted (only unknown-time imported completion), remindersSuppressed (legacy compatibility), plus existing id/taskId/scheduledAt/createdAt/updatedAt. State precedence: endedAt or legacyCompleted → completed; else startedAt → in-progress; else planned. Imported known end/unknown start is completed with unknown duration; imported entirely unknown completion retains legacyCompleted instead of fabricated times.
- Shared lifecycle helper occurrenceState(record), occurrenceDuration(record) derive state/duration. No stored duration. New writes require a start when an end exists, end >= start. Corrections may clear both fields deliberately; recordedAt preserves the first entry, source records manual changes. Start and End are idempotent and cannot overwrite existing times.
- IPC/preload: replace completeTaskOccurrence/clearTaskCompletion with startTaskOccurrence(OccurrenceTarget), endTaskOccurrence(OccurrenceTarget), updateTaskOccurrenceTimes(UpdateOccurrenceTimesInput). Target = taskId plus occurrenceId OR scheduledAt; update target adds startedAt/endedAt nullable fields. Services startOccurrence/endOccurrence/updateOccurrenceTimes. Existing other semantic APIs unchanged.
- Reminder slots offsets in minutes: -5, 0, 3, 6, 9, 12, 15. Pre valid [T-5,T). Each start slot valid until next slot; +15 expires at T+16. User explicitly chose allowing up to one minute polling delay for the final slot. At most latest relevant slot per occurrence per poll; no fallback to older slots. Started/ended/imported-complete/disabled/deleted/off-current-rule occurrences excluded.
- New occurrence_reminder_slots unique (occurrenceId,slot), state sending/sent/failed/unknown, attemptCount, lastAttemptAt, sentAt. Reserve persistently before native show. Successful show acknowledged as sent. Explicit failed/throw can retry same slot within its window. Pending in-process map prevents overlap. On scheduler startup, ambiguous sending rows become unknown and are not replayed (favor no duplicate over uncertain delivery). Crash between OS delivery and DB acknowledgement cannot be solved transactionally; this policy preserves at-most-once uncertain submissions. Stop closes pending notifications and detaches listeners. Successful slots never reset when times are corrected/cleared.
- Old single sent flags map to all seven slots sent (known sentAt where available); legacy suppressed flag remains suppressed. This avoids replaying old notification campaigns. Pending flags permit new policy only inside current active window; old overdue tasks do not spam.
- UI preserves existing polished dialogs. Compact one-row toolbar: week caption/nav/filter/Add Task; remove redundant app-brand header. Cards use Start, End or completed summary; history has actual start/end inputs, backfill/correction, clear times; metadata secondary. No cloud/report/theme changes.

## Work

- [x] Write failing lifecycle/reminder slot tests; add 0004 migration/schema, shared contracts/helpers and DB/service rules.
- [x] Wire narrow IPC and scheduler reservations/recovery/native retries, preserving single instance/shutdown.
- [x] Renderer lifecycle/history + compact chrome, updated real Electron QA. Separate UI worker owns renderer and installed harness once shared contracts are fixed.
- [x] Adapt existing Task/weekly tests without dropping recurrence, migration, offline, history, security coverage. Separate test worker owns old Task/weekly modules; new lifecycle/reminder tests owned by primary.
- [x] Typecheck/lint/tests/build; real Electron QA and fresh unpacked packaging; code review, docs/report.

Implement over existing uncommitted authorized work without resets/commits. Database migration tests use isolated profiles; never launch normal userData for QA.

## Completion ledger (2026-10-19)

Before the usage-limit interruption: lifecycle schema/migration0004 and snapshot, shared contracts/helpers, Task service/repository, semantic IPC/preload, durable reminder policy/service/repository, native scheduler, lifecycle cards/history and compact toolbar were implemented. The initial 45 tests, TypeScript and ESLint passed. Documentation updates were partially written; packaged verification was outstanding.

After resuming: inspected the existing working tree, corrected the one-time form schedule lock for in-progress occurrences to match the service, added three regression cases (48 total), asserted native reminder wording, finished current documentation, reviewed the code and verified fresh production/package output. The requested independent review worker hit the usage limit and produced no review; primary-agent review was completed instead. No existing changes were reset or committed.

Validation: npm test (48/48), npm run lint, npm run pack:win (native verification, TypeScript, production build, electron-builder unpacked package), and npm run test:installed -- "release/win-unpacked/Self Discipline Manager.exe" all passed. Packaged QA report: release/verification/installed-PM39cN/result.json; latest.json points to it. Five migrations, ten semantic APIs, isolated userData, native SQLite/ASAR resources, Start/End/correction/clear, focus/save guards, narrow layouts, security, tray/single-instance and restart verified. Native notification: one attempt, one show, zero failures. Desktop/history screenshots inspected. Actual Windows toast appearance and physical tray menus remain manual; the prior NSIS installer was not rebuilt.

Files in this lifecycle iteration:
- New: electron/db/reminderSlotRepository.ts, electron/services/reminderPolicy.ts, shared/occurrenceLifecycle.ts, drizzle/0004_occurrence_lifecycle.sql, drizzle/meta/0004_snapshot.json, tests/occurrence-lifecycle.cjs, this plan.
- Updated backend/contracts: electron/db/schema.ts, electron/db/taskRepository.ts, electron/services/taskService.ts, electron/services/reminderService.ts (now an internal task-notification service), electron/scheduler/taskScheduler.ts, electron/ipc/taskIpc.ts, electron/preload.ts, shared/types/task.ts, drizzle/meta/_journal.json.
- Updated renderer: src/App.tsx, src/components/TaskForm.tsx, src/components/WeekSchedule.tsx, src/components/TaskDetails.tsx, src/components/TaskHistory.tsx, src/taskFormatting.ts, src/electron.d.ts, src/index.css.
- Updated tests/docs: tests/tasks.cjs, tests/weekly.cjs, tests/run.cjs, tests/windows-installed.cjs, README.md, docs/developer-walkthrough.md, docs/task-scheduling.md, docs/reminders.md, docs/packaging-readiness.md, docs/windows-build.md.
- No files removed in this lifecycle iteration. Existing Git deletions belong to the earlier unified-Task refactor and were preserved.
