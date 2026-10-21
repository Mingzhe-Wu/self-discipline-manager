# Unified scheduled tasks implementation plan

Goal: one Task product concept with one-time/daily/weekly schedules and editable per-occurrence completion history. Preserve the Electron layers, existing data, security/lifecycle, and Windows build configuration.

## Decisions

- Tasks carry schedule type, anchor instant, recurrence JSON (local start date/time, IANA zone, frequency, weekdays), notification enablement, creation/update timestamps, a generation cursor, and soft-deletion time.
- Unique `(taskId, scheduledAt)` occurrence rows persist expected work, completion time, first completion-entry time, last edit time, source, and notification delivery state. Completion is per occurrence, never a recurring-task flag.
- Materialize missed dates on restart and a small upcoming horizon, incrementally and transactionally. Calendar recurrence uses the saved zone, including DST, rather than adding 24-hour durations.
- Complete now, edit/backfill actual completion time, and clear a completion through semantic APIs. Preserve first record-entry time on corrections. Legacy completion times remain unknown rather than fabricated.
- Notification enablement does not erase expected history. Notify overdue one-time occurrences and today's due recurring occurrences, not an offline backlog of old recurring dates. Delete removes a task from the UI but retains historical rows for future reporting.
- Migrate old tasks to one-time items at migration time with notifications disabled; preserve completed status with unknown actual completion time. Old reminders become separate one-time tasks at their original due time; notification flags never imply completion. Never merge by matching titles.

## Execution

- [x] Write failing tests for recurrence/time zones, one-time/recurring creation, independent occurrences, editable/backfilled history, notifications, restart, and old-schema migration.
- [x] Add shared Task/Occurrence contracts, schema and data-preserving Drizzle migration; repository persistence and pure calendar scheduling logic.
- [x] Implement Task service rules, narrow Task IPC/preload types, and occurrence notification scheduler. Preserve main-process lifecycle/security and remove obsolete Reminder runtime after equivalents work.
- [x] Replace separate Task/Reminder screens with a simple scheduled Task form/list, occurrence completion/history editor, and filters.
- [x] Update lifecycle/native/installed tests, docs/walkthrough, and packaging notes; run typecheck, lint, full tests, production build, and real Electron UI QA with isolated data.
- [x] Obtain focused final review and fix substantive findings.

No production userData was modified. No cloud reports, new backend, calendar UI, or styling redesign.

## Verification

- TypeScript, ESLint, and all 19 tests pass; production build and `pack:win` succeed, including native verification.
- Independent review identified a before-due-time projection bug: a daily task showed yesterday rather than today's occurrence. A failing regression test now covers the corrected selection.
- Fresh unpacked Windows app passes real Electron UI QA for creation, completion, backfill/correction, filters, narrow bridge/security, tray/single instance, one-minute native notification and full restart persistence.
- Evidence: `release/verification/installed-cELT8d/result.json` and `installed-app.png` (ignored generated files). Native notification evidence: one attempt, one show event, no failures; Windows toast appearance was not visually verified.
- Existing NSIS installer was not rebuilt during this refactor. Current unpacked output is verified separately; rebuild/install before testing an installed copy of the new model.
