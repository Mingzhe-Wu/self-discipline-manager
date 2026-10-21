ALTER TABLE tasks RENAME COLUMN scheduled_at TO scheduled_start_at;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN scheduled_end_at integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
--> statement-breakpoint
UPDATE tasks SET time_zone = COALESCE(json_extract(recurrence_rule, '$.timeZone'), time_zone);
--> statement-breakpoint
UPDATE tasks SET scheduled_end_at = scheduled_start_at + 1800000 WHERE scheduled_end_at <= scheduled_start_at;
--> statement-breakpoint
UPDATE tasks SET recurrence_rule = json_set(json_remove(recurrence_rule, '$.time'),
 '$.startTime', json_extract(recurrence_rule, '$.time'),
 '$.endTime', CASE WHEN json_extract(recurrence_rule, '$.time') >= '23:30' THEN '23:59:59.999'
 ELSE strftime('%H:%M', '2000-01-01 ' || json_extract(recurrence_rule, '$.time'), '+30 minutes') END)
 WHERE json_type(recurrence_rule, '$.time') = 'text';
--> statement-breakpoint
ALTER TABLE task_occurrences RENAME COLUMN scheduled_at TO scheduled_start_at;
--> statement-breakpoint
ALTER TABLE task_occurrences ADD COLUMN scheduled_end_at integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE task_occurrences SET scheduled_end_at = scheduled_start_at + 1800000 WHERE scheduled_end_at <= scheduled_start_at;
--> statement-breakpoint
DROP INDEX IF EXISTS task_occurrences_task_scheduled_unique;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS task_occurrences_task_scheduled_unique ON task_occurrences(task_id, scheduled_start_at, scheduled_end_at);
