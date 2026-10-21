# Task notifications

Notifications are local behavior of a Task occurrence. There is no separate Reminder product entity or renderer API. See [Task schedules and occurrence history](task-scheduling.md) for progress, recurrence and migration.

## Windows and eligibility

For planned start `T = scheduledStartAt`, each occurrence has seven logical slots:

| Slot (minutes) | Eligible polling window |
| --- | --- |
| -5 | `[T-5, T)` |
| 0 | `[T, T+3)` |
| +3 | `[T+3, T+6)` |
| +6 | `[T+6, T+9)` |
| +9 | `[T+9, T+12)` |
| +12 | `[T+12, T+15)` |
| +15 | `[T+15, T+15:30)` (minutes:seconds) |

The scheduler polls once on startup and every 30 seconds. It selects only the latest current slot per occurrence; missed slots are skipped, including after downtime. The final slot allows thirty seconds of polling delay and expires exactly thirty seconds after `T+15` (15.5 minutes after the planned start). Planned end changes do not move reminder slots, but identify a different occurrence range. Old overdue occurrences do not produce a backlog campaign.

Starting stops further reminders. Ended/imported-complete occurrences, suppressed alerts, disabled/deleted tasks and ranges that do not match both endpoints of the current rule/effective boundary are excluded. Disabling alerts preserves expectations. Native notification events never start or complete an occurrence.

## Durable delivery

`occurrence_reminder_slots` has a unique `(occurrenceId, slot)` key, `state` (`sending`, `sent`, `failed`, `unknown`), `attemptCount`, `lastAttemptAt` and nullable `sentAt`.

Before invoking native show, the service durably claims the slot as `sending`. The scheduler's pending map prevents overlapping in-process attempts. A native `show` event acknowledges `sent`; explicit failure or a thrown native call marks `failed`. Failed slots may retry only while that same window remains current. Once the window advances, there is no fallback to an earlier failed slot. There are at most seven successful logical slots per occurrence; explicit failure retries can create more attempts.

On scheduler startup, interrupted `sending` rows become `unknown` and are never replayed. Delivery and SQLite acknowledgement cannot be transactional: a crash after OS delivery but before acknowledgement leaves uncertainty. Recovery favors avoiding a duplicate, so an uncertain slot may be skipped. `sent` and `unknown` slots cannot be reclaimed. Correcting or clearing actual times never resets slot history.

Pending notifications that become irrelevant are closed and marked unknown on the next check. Stop clears the timer, detaches listeners and closes pending notifications. Unsupported native notifications leave the schedule intact. A native `show` event is acknowledgement, not visual confirmation that Windows displayed a toast.

## Code path

- `electron/services/reminderPolicy.ts`: pure latest-window selection (`reminderSlotAt`, `SCHEDULER_POLL_MS`).
- `electron/services/reminderService.ts`: materializes tasks, checks current-rule eligibility, claims/rechecks reminders and records outcomes/recovery.
- `electron/db/reminderSlotRepository.ts`: candidate queries and durable slot claims, attempts, outcomes and interrupted-state recovery.
- `electron/scheduler/taskScheduler.ts`: one timer, pending native notifications, show/failure handling and shutdown cleanup.

The single-instance main process owns the scheduler. Window close hides to tray; quit stops delivery before closing SQLite. Renderer minute/focus refreshes only update the board.

Migration `0004_occurrence_lifecycle.sql` maps an old sent flag to all seven slots as sent, retaining a known old notification time or null. Old suppressed flags stay suppressed; pending flags are subject only to current windows. These delivery records never imply activity completion.

Migration `0005_planned_ranges.sql` preserves every reminder-slot row and its occurrence ID while adding planned ranges. End-only schedule edits preserve meaningful old-range history, and those retained old ranges are excluded from current-rule delivery.
