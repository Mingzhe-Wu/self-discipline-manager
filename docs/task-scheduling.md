# Task schedules and occurrence history

A Task is the only top-level item. Each scheduled occurrence has its own Planned → In Progress → Finished lifecycle, or becomes Missed after its planned end without an actual start. Notifications belong to that occurrence's schedule.

## Stored model and actual activity

`tasks` stores the title, schedule, effective boundary, notification preference, provenance, generation cursor and soft-deletion time. A one-time task has `scheduledStartAt`, `scheduledEndAt` and a saved `timeZone` (defaulting to the computer zone at creation). A recurring task has a daily/weekly rule with local `startDate`, `startTime`, `endTime`, IANA `timeZone` and selected weekdays (Sunday 0 through Saturday 6). The task also stores that rule zone. `enabled` controls alerts without erasing expectations. Soft deletion retains history; reporting must exclude expectations at/after deletion.

`task_occurrences` has a unique `(taskId, scheduledStartAt, scheduledEndAt)` key:

| Field | Meaning |
| --- | --- |
| `scheduledStartAt`, `scheduledEndAt` | Immutable planned range for this record. Actual activity may happen earlier or later; duration and card geometry do not alter this range. |
| `startedAt`, `endedAt` | Nullable actual start/end instants, in Unix milliseconds. Editable through history. |
| `recordedAt` | First lifecycle entry time; preserved through corrections and clearing actual times. Its presence does **not** imply completion. |
| `updatedAt` | Last lifecycle write. Reminder attempts have their own timestamps. |
| `progressSource` | `normal` for Start/End, `backfill` for a first manual entry, `corrected` for a manual edit of an entered record, or imported `legacy`; initially null. |
| `legacyCompleted` | Imported completion whose actual start and end are both unknown. New manual writes clear this flag. |
| `remindersSuppressed` | Preserves imported alert suppression independently of progress. |
| `createdAt` | Row materialization time, not activity time. |

`shared/occurrenceLifecycle.ts` is authoritative: `endedAt != null` or `legacyCompleted` means completed; otherwise a known start means in-progress; otherwise `now > scheduledEndAt` means missed, and all remaining records are planned. `occurrenceDuration` derives `endedAt - startedAt` only when both exist. Unknown start/end means unknown duration; duration is never stored or fabricated.

Start records now, End requires a start and records now. Repeated Start or End preserves existing times. Changes affect only the selected occurrence. History accepts nullable actual start/end, rejects an end without a start and rejects end before start. Clearing both actual times preserves first `recordedAt` and derives Planned or Missed from the current clock. An already-Missed record cannot use the normal reset path. A later Start still preserves that first entry. These are editable current records, not an immutable audit log.

The bridge exposes `startTaskOccurrence`, `endTaskOccurrence`, `updateTaskOccurrenceTimes`, `getMissedTasks` and `lateStartTaskOccurrence`. Targets contain `taskId` plus either `occurrenceId` or both `scheduledStartAt` and `scheduledEndAt`; time updates add nullable `startedAt` and `endedAt`. There is no completion toggle API.

## Calendar recurrence and weekly projection

`shared/scheduling/recurrence.ts` uses the pinned Temporal polyfill to generate calendar dates in the saved zone. DST uses `compatible`: nonexistent start times move forward by the gap and shift the whole planned range by that gap; repeated times choose the earlier instant. Resolved ranges must remain positive and end on the same saved-zone date. Each selected date yields one occurrence. A later computer-zone change does not alter the saved rule.

The service catches up missing dates and pre-generates about 14 days ahead, or through the first occurrence of a farther-future rule. Creation and initial rows are atomic; unique keys make generation idempotent. Deletion first catches up through deletion time. Reopening preserves earlier lifecycle entries. History queries are half-open `[from, to)`, at most 366 days and no more than one year ahead; older history can be browsed in successive ranges.

The default board is a Monday–Sunday timetable in the viewer's local zone. Its compact toolbar contains week navigation, filter and Add Task. Each day displays the configured planning hours, extending when needed to show saved out-of-range tasks, with two-hour labels/grid lines and vertical scrolling. `src/timetableLayout.ts` maps local wall-clock minutes to top/height at viewport-dependent density targeting roughly eight visible hours. Geometry uses the planned range before Start; In Progress uses actual startedAt and the later of planned end/current time; Finished uses actual startedAt/endedAt. The renderer updates current time every thirty seconds. Missing imported actual starts fall back to planned geometry. Planned identity/timestamps remain unchanged. A range crossing viewer midnight splits into display segments while retaining one occurrence identity. The fixed grid shows a repeated DST fold once; a backward wall-clock range uses its positive elapsed length, capped at midnight.

All intersecting display intervals form transitive staggered-width groups, ordered deterministically by displayed start/end and stable IDs. Width is 1.05 / group size: two cards are 52.5% wide, three 35%; each retains an exposed selection strip. Short planned durations render at a minimum fifteen-minute height without changing stored timestamps. Grouped cards show truncated titles, with a small details arrow where space allows. Containment and partial overlaps also use staggered widths; later starts sit above earlier ones. Hover or keyboard focus expands the entire capsule vertically around its center and reveals the primary action while preserving the title; mouse leave restores exact compact columns and default layers. Overlap does not change vertical geometry; the fifteen-minute display floor is independent of grouping. After hover/focus expansion, the fixed 60px upper region opens Task Details/Edit and the lower region performs lifecycle actions (click/Enter/Space): Planned → In progress → Finished. Their native buttons stop propagation independently. The lower region fills all remaining height, has a full-width top divider and centers its Press to start/finish/reset label. Only the hovered region receives the muted background/shadow and local left accent. Clicking Finished opens a neutral reset confirmation, with Cancel initially focused. Confirm clears startedAt and endedAt while retaining the occurrence, planned range and Task relationship; Cancel changes nothing. Actual duration remains derived. The upper-right details arrow is decorative; the full upper information region opens details without advancing lifecycle. The two controls are not nested. Successful reminder slots remain preserved on reset. See [timetable overlap layout](timetable-overlap.md). History retains actual-time editing and audit metadata.

Add/Edit use five-minute Start Time and End Time selects. New or changed ranges require a strictly later end on the same calendar date in the saved zone; cross-midnight input is rejected. One-time dates/times are interpreted in the task's saved zone; recurring input uses the rule's saved zone. Unchanged legacy schedules may be saved exactly, including unaligned starts and capped ends. Actual-time history inputs remain precise: editing one field preserves untouched seconds/milliseconds. History labels planned ranges in the saved zone.

`shared/scheduling/week.ts` expands only the requested week from the current rule/effective boundary, then merges stored state by `(taskId, scheduledStartAt, scheduledEndAt)`. Browsing distant weeks does not persist them. A virtual card has `record=null`; starting or manually recording it validates the expected range and persists just that row. Regular catch-up remains independent of browsing.

## Editing a schedule

An actual schedule edit atomically catches up old expectations before the edit, replaces pristine future rows and sets `scheduleEffectiveAt`. Past rows and meaningful future rows survive: started/ended/imported-complete entries, first-entry metadata, suppression and reminder-slot records all prevent deletion. Old-rule rows remain editable history, and appear as active cards only when they match the current rule and effective boundary. Cleared records retain first-entry metadata and therefore remain meaningful history. Changing only the planned end creates a distinct expectation; preserved old-range state cannot mark the new range started or ended.

New recurring expectations begin at/after the edit instant. New one-time tasks and changed not-started one-time schedules must start at or after the current time. Started/completed one-time tasks may explicitly correct their planned date/start/end, including past planned times, while retaining the same occurrence ID, actual times, first-entry metadata and reminder slots. Their schedule type remains locked to one-time. This targeted planned correction is transactional and leaves other historical rows unchanged; a collision with an existing historical range is rejected and rolled back. Title/notification-only edits leave expectations and lifecycle metadata untouched. Converting recurring to one-time keeps historical recurring rows while projecting and reminding only the new expectation. Historical titles/rules are not separately versioned.

## Reminder campaign

Each occurrence has seven logical reminder slots: -5, 0, +3, +6, +9, +12 and +15 minutes relative to its immutable planned start. Only the latest current window is eligible; missed windows are never replayed. The pre-reminder window is `[T-5, T)`, start windows end at the next slot, and the final window is `[T+15, T+15:30)` (minutes:seconds) to allow thirty seconds of polling delay. The scheduler polls on startup and every thirty seconds; the final campaign expires exactly thirty seconds after the +15-minute slot. Starting the occurrence stops further reminders; ended/imported-complete, suppressed, disabled, deleted or off-current-rule occurrences are also excluded.

Delivery uses durable independent slot records, current-window retries and conservative recovery. See [Task notifications](reminders.md) for the exact policy and code path. Clearing/correcting actual times does not reset successful slots.

## Migration and unknown history

Migrations run against `userData/data.db` on startup without replacing the file. `0002_unified_tasks.sql` maps old Tasks and Reminders separately without merging titles: original task IDs remain, old reminders become one-time tasks at their exact due times, and imported unscheduled tasks receive explicitly inferred migration-time expectations with alerts suppressed. `0003_task_schedule_edits.sql` adds the effective schedule boundary.

`0004_occurrence_lifecycle.sql` preserves occurrence IDs, planned times and first-entry metadata while replacing old completion/delivery fields:

- A known old `completedAt` becomes `endedAt`, with `startedAt=null`. State is completed and duration remains unknown.
- An old completed record with no actual time becomes `legacyCompleted=true`, with both actual times null. No activity instant is invented.
- Old suppressed alerts become `remindersSuppressed=true`.
- Each old sent flag becomes all seven slots marked sent, preserving known notification time or null. This prevents replay of its campaign and never implies completion. Old pending flags create no sent slots; only a currently valid window may notify.

`0005_planned_ranges.sql` renames planned-start columns, adds planned ends and the saved task zone, converts recurrence JSON from `time` to `startTime`/`endTime`, and makes the occurrence unique key include both endpoints. It preserves all existing starts without rounding. One-time tasks receive the computer zone at migration; recurring tasks retain the rule zone. One-time ranges receive an elapsed thirty-minute end capped at the last millisecond before local midnight. Recurring rules receive a thirty-minute wall-clock end, similarly capped; existing recurring rows derive their ends from the converted rule so stored and projected ranges agree across DST. IDs, actual/audit timestamps, progress, suppression and reminder slots remain unchanged.

The migration SQL uses built-in SQLite operations only. `runtimeMigrations.ts` reads the Drizzle files/hashes/journal and executes pending SQL in one transaction, followed by explicit typed time-zone normalization from `migrationRanges.ts` before the journal commits. Historical old-rule rows derive ends from their own starts. No SQLite callbacks are registered. Application initialization also resumes unjournalled partial 0005 column changes. See [the compatibility repair](migration-compatibility-repair.md).

Imported unscheduled task expectations are placeholders, not evidence of when work was due. Identify those initial suppressed imported rows separately from later real expectations when reporting.

## Future weekly reports (not implemented)

Choose an explicit local-zone interval and materialize eligible expectations before calculating:

| Measure | Basis |
| --- | --- |
| Expected | `scheduledStartAt` within the interval, bounded by task start/deletion; distinguish inferred legacy placeholders. |
| Planned / in-progress / completed | Shared derived lifecycle state, never presence of `recordedAt` alone. |
| Missed as of report time | Past expected time with no completion; disclose whether started-but-unfinished work is counted separately. Future expectations are not missed. |
| Activity timing / duration | Actual start/end; unknown legacy times remain unknown. |
| On-time | Compare a known actual start or end with the planned start/end according to an explicit reporting definition/grace period. |
| Entry timing / backfill | `recordedAt` and current `progressSource`, independent of actual activity time. Corrections may replace a previous backfill source. |
| Completion rate | Completed eligible expectations divided by eligible expectations; zero denominator is N/A. State whether unfinished-week denominators include future expectations. |

Scheduled time measures expectations; actual times measure user-reported activity; entry/update times measure editing. Corrections may change later report results. No report service, report UI, cloud synchronization or independent activity verification is provided.

Planning-hours and occurrence-editing follow-up: see [planning hours and occurrence editing](planning-hours-occurrence-editing.md) for the singleton settings row, exact-range recurrence exclusions, Sync ON/OFF history preservation, DST validation and adaptive ten-hour viewport. These extend planning without adding Missed/overdue behavior.

Category is stable Task-level metadata, inherited by recurrence-derived cards and Sync OFF standalone replacements. Missing creation/legacy values use other; omitted update values preserve the parent value. It does not change lifecycle colors or occurrence history. See [task categories](task-categories.md).

## Actual correction and recurring detachment

The Planned / Actual visual editor is shared by one-time and selected recurring occurrences. It retains common-scale bars, derived differences/durations, local dates and five-minute options, draggable boundaries and live preview. Only the explicit correctTaskOccurrenceTimes IPC used by the recurring visual editor triggers detachment. Normal Start/Finish and Reset continue to update the occurrence without creating a separate Task. The History disclosure is currently hidden; stored history and its APIs are retained. Opening Details and unchanged saves do not detach.

A changed recurring Actual value atomically inserts an exact planned-range exclusion, creates a one-time Task with the parent title/category/notification preference/time zone/origin and original occurrence planned range, then moves the existing occurrence row to that Task with the corrected actual values. Its ID, createdAt, first recordedAt, suppression and linked reminder-slot rows survive. The source parent does not keep a duplicate history row. The parent recurrence, effective boundary and other occurrences remain unchanged. A failed transaction rolls back all three operations. Exclusions remain persistent through restart and later materialization, including initially virtual future occurrences. There is no schema migration.

Week queries include stored actual ranges intersecting the requested week even when their original planned dates lie elsewhere. These candidates still must match the current recurrence/effective boundary and exclusions; obsolete-rule history never becomes active cards. Renderer splitting is limited to the viewed week, so a long-running occurrence does not generate an unbounded off-screen set of segments. Details still displays both planned and actual, and the existing fifteen-minute minimum visible card height remains.

**Task Center** defaults to all Tasks and individual missed occurrences. Its exclusive Recurring/Missed chips filter the list; repeating the selected chip clears it. A recurring series row opens the shared TaskForm to edit the series itself, with Save Task / Cancel returning to Task Center. It does not open the first occurrence’s Details. Ordinary and detached one-time tasks open Details from their timetable cards. Per-occurrence statistics remain derived from four timestamps, with no new stored statistics or reports.

Task Details has an information card with Edit at its bottom right, a separate Timing summary card, then Planned vs Actual. The timeline card has two layers: a shared-scale, read-only Planned bar and draggable Actual endpoints above; exact Actual start/end selectors, help and Clear actual times below a light divider. Dragging updates temporary preview and selectors together, then saves on release. Selecting a time updates the timeline immediately. Held-edge extension stays within the endpoint’s local day, 00:00–23:55. The History disclosure is temporarily hidden without deleting historical data.

## Missed workflow and display preferences

See [Missed workflow](missed-workflow.md) for precedence, today-only explicit Late Start, preserved originals, reminder cutoff and the recent-first Missed entry. Wake/Sleep are display preferences only: creation/editing can fall outside them, and the timetable expands without rewriting times. No schema or linkage fields were added.

Planned Add/Edit and Actual endpoint controls use separate hour (00–23) and minute (five-minute) dropdowns. Opening them does not round existing records. Saved precise Actual times remain selectable as an explicit exception; repeated local DST minutes retain distinct timestamp/zone choices. Selecting a new ordinary minute produces an exact five-minute instant, updates the shared timeline, and uses existing validation/persistence.
