# Weekly Schedule Implementation Plan

**Goal:** Replace the dense Task list with a Monday–Sunday occurrence board, structured creation/editing, and secondary details/history while preserving desktop behavior and existing records.

**Architecture:** Keep React → preload → IPC → service → repository → Drizzle → SQLite. Pure shared scheduling helpers derive bounded visible occurrences; a semantic week API merges stored state. Schedule edits snapshot expected history through the cutover and apply the new rule going forward without a separate product entity.

**Tech Stack:** Existing Electron/React/TypeScript/Drizzle/SQLite and pinned Temporal polyfill; no new dependencies.

## Decisions and constraints

- Display seven local-calendar days Monday first, navigate by calendar weeks (DST safe), highlight today; cards contain title/time/state/recurrence only.
- Move notification settings, migration explanations, editing and history to a selected-task panel. Keep all active tasks accessible through a secondary task picker even when none occur in the visible week.
- Add `scheduleEffectiveAt` to tasks. Initially equals the original first schedule instant; on a schedule change equals edit time. Persist all old expected occurrences through edit time before changing the rule. Keep past rows and future rows with completion/notification state; remove only untouched future rows. Use a transaction for the cutover.
- Completed one-time schedules stay fixed (title/notifications remain editable). A changed one-time schedule must be future-dated. Recurring rules may have an earlier start date but generate new expectations only from cutover onward.
- Week rendering generates only the requested seven-day range and merges stored records by task/time. Browsing future weeks does not advance the generation cursor or store future weeks. Preserve existing bounded scheduler/history materialization, not unlimited view-driven generation.
- Completion of a virtual occurrence uses task ID + scheduled instant; validate against the current rule/effective time or an existing preserved occurrence before persisting it. Existing occurrence-ID APIs remain compatible.
- No installer rebuild, no unrelated styling/features, no normal userData changes, no commits or checkout resets over existing uncommitted work.

## Tasks

- [x] 1. Tests first: pure week navigation/day placement/daily/weekly/state merging; edit preservation, invalid edits, future browsing without DB growth, virtual completion, legacy compatibility. Run red tests, then implement shared helpers/contracts, 0003 migration, repository/service and narrow bridge methods.
- [x] 2. UI: shared structured TaskForm for add/edit; WeekSchedule and selected TaskDetails with existing TaskHistory; replace obsolete list components; limited layout CSS only. Preserve loading/errors and guard stale async loads.
- [x] 3. Update packaged UI test for week navigation/cards/details/edit/backfill, legacy metadata hiding, restart/security/tray/native minute tick. Run typecheck/lint/tests/build and fresh unpacked Windows QA with isolated profiles. Browser plugin unavailable: use existing Playwright Electron harness.
- [x] 4. Independent final review; fix important findings with regression tests. Update model docs, developer walkthrough and packaging evidence; report outcomes and decisions.

## Review focus

- Changing recurrence preserves missed old dates and completed future occurrences; invalid edits are atomic.
- Cross-zone midnight/DST put cards in the viewer's correct local day with no duplicate instants.
- Far future navigation does not create persistent weeks; stale/edited virtual completion cannot create arbitrary dates.
- Completed one-time tasks remain completed; converting recurring schedules never deletes completion metadata.
- Existing migration history and packaged native dependencies/resources remain usable.

## Execution ledger

Implement inline in the existing workspace because the current unified-model changes are uncommitted and are the baseline for this request. Do not manufacture a clean checkout or commit unrelated work. The supplied request authorizes implementation; no additional design approval is needed under the session's autonomy instructions.

- Model/projection suite: eight new cases failed before implementation (19 passing baseline), then passed. Added markup isolation, schedule-conversion and old-unified-schema migration/restart coverage; 31 tests now pass.
- Independent review: no substantive model/projection/cutover findings. Its one-time conversion display edge was reproduced with a failing test and fixed: one-time projection now selects its own scheduled record, not older retained recurring history.
- Additional regression: recurring-to-one-time conversion must not turn missed recurring history into overdue one-time notifications. Reproduced RED, then fixed GREEN; historical rows remain intact.
- Ruling: keep the pre-existing bounded scheduler materialization rather than rewrite persistence in a UI iteration. Browsing a week is a pure rule projection plus DB-state merge; it never extends that horizon. Cost if later removed: current/next compatibility projections need nullable virtual DTOs throughout.
- Ruling: completed one-time schedules require explicit clearing before rescheduling. This keeps completion permanence and avoids silently changing a done task into new work; title/notification edits are allowed. Cost if changed later: define how the old completed occurrence relates to the new schedule.
- Visual QA: first unpacked run passed all interactions/native minute tick/restart. A narrow-toolbar heading squeeze was identified from screenshots and fixed with a wrapping flex basis; final harness asserts readable heading width at 600px.
- Final packaged QA passed: `release/verification/installed-zNVN2a/result.json`; desktop/narrow/form screenshots in that directory. One notification attempt, one native show acknowledgement, no failures. No renderer exceptions or relevant console warnings/errors. Full restart retained edited schedules and corrected backfill records. The Windows toast itself and physical tray menu were not visually inspected.
- TypeScript, ESLint, 31 tests, production build, native verification, `pack:win`, and migration snapshot consistency passed. The NSIS installer was not rebuilt; all QA profiles and screenshots remain ignored generated output.

## File map for this iteration

- Added: shared/scheduling/week.ts; src/components/WeekSchedule.tsx and TaskDetails.tsx; tests/weekly.cjs; drizzle/0003_task_schedule_edits.sql and meta/0003_snapshot.json; this plan.
- Moved: electron/services/taskRecurrence.ts → shared/scheduling/recurrence.ts (pure recurrence logic reused across service and view helpers).
- Removed: src/components/TaskList.tsx and TaskItem.tsx after weekly cards/details replaced their responsibilities.
- Updated: src/App.tsx, components/TaskForm.tsx, index.css, electron.d.ts; shared/types/task.ts; electron/db/schema.ts and taskRepository.ts; services/taskService.ts; ipc/taskIpc.ts and preload.ts; migration journal; tests/run.cjs, register-typescript.cjs and windows-installed.cjs; README and developer/model/packaging docs.
- Unchanged in this iteration: main lifecycle, scheduler timer/native notification implementation, native dependency policy, electron-vite/electron-builder config. Existing uncommitted unified-model changes were preserved.
