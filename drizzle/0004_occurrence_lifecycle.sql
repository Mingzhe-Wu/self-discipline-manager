ALTER TABLE task_occurrences RENAME TO legacy_occurrences;
--> statement-breakpoint
CREATE TABLE task_occurrences (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 task_id integer NOT NULL REFERENCES tasks(id), scheduled_at integer NOT NULL,
 started_at integer, ended_at integer, recorded_at integer, progress_source text,
 legacy_completed integer DEFAULT 0 NOT NULL, reminders_suppressed integer DEFAULT 0 NOT NULL,
 created_at integer NOT NULL, updated_at integer NOT NULL
);
--> statement-breakpoint
INSERT INTO task_occurrences SELECT id, task_id, scheduled_at, NULL, completed_at, recorded_at, completion_source,
 CASE WHEN recorded_at IS NOT NULL AND completed_at IS NULL THEN 1 ELSE 0 END,
 CASE WHEN notification_state = 'suppressed' THEN 1 ELSE 0 END, created_at, updated_at FROM legacy_occurrences;
--> statement-breakpoint
CREATE TABLE occurrence_reminder_slots (
 id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 occurrence_id integer NOT NULL REFERENCES task_occurrences(id), slot integer NOT NULL,
 state text NOT NULL, attempt_count integer DEFAULT 1 NOT NULL, last_attempt_at integer, sent_at integer
);
--> statement-breakpoint
INSERT INTO occurrence_reminder_slots (occurrence_id,slot,state,attempt_count,last_attempt_at,sent_at)
 SELECT legacy_occurrences.id, slots.slot, 'sent', 1, notified_at, notified_at FROM legacy_occurrences
 CROSS JOIN (SELECT -5 AS slot UNION ALL SELECT 0 UNION ALL SELECT 3 UNION ALL SELECT 6 UNION ALL SELECT 9 UNION ALL SELECT 12 UNION ALL SELECT 15) slots
 WHERE notification_state = 'sent';
--> statement-breakpoint
DROP TABLE legacy_occurrences;
--> statement-breakpoint
CREATE UNIQUE INDEX task_occurrences_task_scheduled_unique ON task_occurrences(task_id,scheduled_at);
--> statement-breakpoint
CREATE UNIQUE INDEX occurrence_reminder_slot_unique ON occurrence_reminder_slots(occurrence_id,slot);
