# Planned ranges and weekly timetable

User scope: planned start/end ranges, five-minute planned input, thirty-second reminder polling, full-day time-positioned week, overlapping/clickable cards. Preserve lifecycle/history, architecture, notifications/tray/persistence. No installer rebuild, cloud, reports or drag editing.

Contracts: Task/TaskOccurrence/ScheduledOccurrence use scheduledStartAt and scheduledEndAt. Task has saved timeZone (one-time default computer zone, recurring rule zone). RecurrenceRule uses startTime/endTime. OccurrenceTarget uses scheduledStartAt. Shared helpers generate ranges in saved zone; both planned endpoints form occurrence identity. End-only schedule edits preserve meaningful old ranges in history and project current ranges without stale state matching.

Migration0005 renames planned-start columns and adds planned ends/time zone. Connection-local migration SQL functions derive a thirty-minute one-time elapsed or recurring wall-clock end capped before local midnight and migrate old rule JSON, preserving old unaligned starts and all actual/audit/slot data. Unchanged legacy schedules may be saved exactly; new/changed schedules require positive same-day five-minute ranges. Legacy ranges ending at last millisecond remain historical; edited schedules must be valid five-minute ranges.

Timetable: viewer-local wall-clock minutes map linearly to top/height over 1440 minutes, with visible two-hour labels/grid lines and vertical scrolling. Split display segments at viewer midnight if a saved-zone range crosses viewer dates, without changing occurrence identity. Overlap counts use intersecting half-open planned intervals. Deterministic modest horizontal offsets retain exposed card edges; background alpha1/.8/.65/.53, text opaque, hover/focus z-index elevation. Whole cards keyboard/click accessible; inner actions stop propagation.

Work:
- [x] Failing range/geometry/interval tests; shared contracts and generation.
- [x] Migration/schema/repository/service/range-state identity and reminders30seconds/final30seconds.
- [x] Add/Edit start/end five-minute inputs, detail/history ranges; timetable geometry/overlap/full-surface interactions.
- [x] Adapt existing regression tests/packaged QA to new contracts, preserving old SQL fixtures.
- [x] TypeScript, ESLint, full tests, production build; rendered Electron QA via existing Playwright workflow (Browser plugin absent); docs/review/final.

Work over existing authorized uncommitted tree; no reset/commit. Disjoint renderer/test tasks can run after shared contracts are written, per dispatching-parallel-agents skill. Main owns shared/backend/new tests/docs. Isolated userData only for QA.


## Files and validation

New: drizzle/0005_planned_ranges.sql, drizzle/meta/0005_snapshot.json, electron/db/migrationRanges.ts, src/timetableLayout.ts, tests/planned-ranges.cjs, this plan.

Updated: shared/types/task.ts; shared/scheduling/recurrence.ts and week.ts; electron/db/database.ts, schema.ts, taskRepository.ts, reminderSlotRepository.ts; electron/services/taskService.ts, reminderService.ts, reminderPolicy.ts; electron/scheduler/taskScheduler.ts; drizzle/meta/_journal.json; src/App.tsx, components/TaskForm.tsx, WeekSchedule.tsx, TaskDetails.tsx, TaskHistory.tsx, taskFormatting.ts, index.css; tests/tasks.cjs, weekly.cjs, occurrence-lifecycle.cjs, windows-installed.cjs, run.cjs; README and developer/scheduling/reminder/packaging/build docs. Preload and IPC signatures consume the shared DTO updates without widening methods. No files removed or dependencies added this iteration.

Verification:58/58 full tests, ESLint, TypeScript, production build, native verification and fresh Windows unpacked packaging passed. No NSIS rebuild. Existing Playwright Electron harness uses isolated profiles (Browser plugin absent); verifies migration6, narrow10semantic APIs, nativeSQLite/ASAR resources, input ranges, geometry, overlap hover/full-card/keyboard interaction, inner Start/End isolation, actual-time precision, history, tray/singleinstance/restart and real30second scheduler. Independent review found a DST migration mismatch; fixed by sharing recurring end calculation with projection and covered by a real old-schema fixture (record attachment and reminder eligibility). Reviewer confirmed the fix and no remaining concrete blocker.

Rendering uses2px/minute over1440minutes, two-hour ticks, short-card hover/focus content overlay while block geometry stays fixed. Peak simultaneous half-open overlap drives alpha1/.8/.65/.53 with opaque text and monotonically distinct bounded horizontal offsets. Exposed edges, hover and focus keep underlying cards reachable; full surface and Enter/Space open details, nested controls stop propagation. Fixed24hour grid uses viewer wall-clock positions; repeated-hour backward ranges use positive elapsed length for display only, while original timestamps remain unchanged. Viewer-midnight segments do not duplicate occurrence identities. New inputs reject backward local-clock ranges even on DSTfold dates.

Legacy rule/point starts are not rounded; grandfathered exact schedules can be renamed without revalidation. Legacy one-time zone is the computer zone at upgrade because no historical zone existed; recurring zone is preserved. Default ends can end at23:59:59.999 to avoid introducing overnight legacy ranges; edited schedules must use valid five-minute boundaries. No actual times or stored duration were fabricated. No product decision is blocking completion.

Final packaged QA: release/verification/installed-RtXJ4J/result.json, passed. Exact09:00–10:30 top1080px/height180px and14:15–16:00 top1710px/height210px verified in rendered DOM; five-minute block height10px persisted through Start/End, blank surface click opened details, and four-card exposed-edge hover elevated without moving geometry. Native scheduler:1attempt/1show/0failures. Six runtime migrations and all restart/security/tray checks passed. Desktop/afternoon/narrow screenshots inspected. Normal userData untouched. Actual Windows toast appearance remains a manual check.

## Compatibility correction (2026-10-20)

The original callback-based0005 migration failed on real retained old-rule history. That implementation is superseded by native SQLite SQL plus explicit typed zone conversion in one journal transaction, with partial-DDL recovery. See docs/migration-compatibility-repair.md for the actual cause and verified preservation of the real profile (6 Tasks,47 occurrences,17 reminder slots).
