# Missed occurrences and Late Start

## State and original records

`shared/occurrenceLifecycle.ts` derives state without adding a database column:

1. A recorded end means Finished (internal key `completed`). Imported `legacyCompleted` records also remain Finished when actual timestamps are unknown.
2. A recorded start without an end means In Progress.
3. Without either actual timestamp, `now > scheduledEndAt` means Missed; equality still means Planned.
4. Otherwise the occurrence is Planned.

The renderer updates its clock every 30 seconds. Missed cards retain planned geometry, category/title identification and a low-saturation red state hook. Both expanded card regions open Details; they never Start, Finish or Reset a missed occurrence. Ctrl edge resizing is disabled for Missed; corrections use Details. Main-process validation also rejects normal Start and empty reset requests on Missed records.

Missed is derived, not an immutable audit flag. A user may enter historical actual start/end through the existing Details editor, changing the derived state normally. Clearing a previously finished record after its planned end makes it Missed rather than Planned. No actual timestamps are fabricated.

## Explicit Late Start

Only a Missed occurrence whose planned start falls on today's **system-local date** offers **Start late** in Details. Main process rechecks both conditions at invocation, including date rollover. Older missed records remain inspectable and correctable.

`taskService.lateStartOccurrence` rounds the current system-local zoned time to the nearest five minutes, retaining the current offset during a repeated DST hour. It preserves the original elapsed planned duration and sets the new end to rounded start plus that duration. Actual start is the precise invocation time, with a new first-entry timestamp and normal progress source.

`taskRepository.createStartedTask` atomically inserts a fresh one-time Task and its already-running occurrence. Title, category and notification preference are copied; the new Task has user origin and the current local time zone. Original Task, occurrence, recurrence, exclusions, actual records and reminder slots remain untouched. No source-link field or old slot state is copied. Failed insertion rolls back the whole new attempt. The UI prevents duplicate in-flight submissions; a later deliberate Late Start is a separate independent attempt.

The new Task appears immediately and Details follows it. The toast explicitly describes a **new** late-started Task. A refresh failure after a successful insert is reported as a refresh problem rather than inviting a repeat of the creation action.

Near midnight, preserving duration can cross into the next date, and nearest-five-minute rounding can put the new planned start on the next date. This special creation path permits that result instead of shortening duration. Standard Add/Edit still uses existing same-day validation; an unchanged cross-midnight late-start plan can retain its exact timestamps on metadata saves.

## Missed entry and notifications

The toolbar’s **Task Center** entry defaults to all tasks. Its **Missed** chip filters current-schedule missed occurrences across dates, newest planned start first (stable descending ID tie-break). Recurring and Missed chips are mutually exclusive; selecting the active chip again clears the filter. It excludes deleted tasks, finished/in-progress records, exclusions and obsolete recurrence ranges. Clicking an entry opens the selected occurrence's existing Details, not a separate backfill editor.

Narrow APIs `getMissedTasks` and `lateStartTaskOccurrence` pass through preload and sender-validated task IPC. Repository queries remain DB-only; service owns state/date checks and copy policy.

Reminder candidate selection and pre-delivery relevance checks reject an occurrence after its planned end. Successfully recorded slots remain intact, and no missed slots are replayed. The regular 30-second polling and latest-slot policy are unchanged. A new late-start occurrence has no slot history and is immediately running, so it is ineligible for start reminders.

## Wake/Sleep display preferences

Wake/Sleep defines preferred visible bounds and form defaults only. Settings, service validation, planned-time selectors and Ctrl quick-create do not require tasks to fit that window. Five-minute planned input and positive/same-day validation for ordinary plans remain. No saved times are rounded, truncated or rewritten when display settings change.

WeekSchedule expands the rendered range to include displayed task segments before Wake or after Sleep while retaining one linear scale. In Progress still uses actual start and the later of planned end/current time; Finished uses actual range; Planned and Missed use planned range. Existing overlap and recurrence projection rules remain unchanged.

## Verification

- `tests/missed.cjs`: precedence/boundaries, lifecycle restrictions, local rounding/DST, late creation and transaction rollback, original/history/slots preservation, recurring independence, manual correction, list order, display expansion and Details/card markup.
- `tests/windows-missed.cjs`: isolated Electron profile, recent-first list, old/today Details, explicit late action, new running card, original red card, toast and expansion beyond preferred Sleep.
- Existing planning-settings and quick-add tests now assert display-only preferences; recurrence/history fixtures use explicit historical correction instead of normally starting expired occurrences.

No schema migration, real-profile QA or installer rebuild is involved.
