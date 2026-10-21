-- Preserve legacy IDs/completion flags until their occurrence records are copied.
ALTER TABLE `tasks` RENAME TO `legacy_tasks`;
--> statement-breakpoint
CREATE TABLE `tasks` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `title` text NOT NULL,
    `schedule_type` text NOT NULL,
    `scheduled_at` integer NOT NULL,
    `recurrence_rule` text,
    `origin` text DEFAULT 'user' NOT NULL,
    `enabled` integer DEFAULT true NOT NULL,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL,
    `generated_through` integer,
    `deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `tasks` (`id`, `title`, `schedule_type`, `scheduled_at`, `enabled`, `created_at`, `updated_at`, `generated_through`, `origin`)
SELECT `id`, `title`, 'one-time', unixepoch() * 1000, false, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, 'legacy-task'
FROM `legacy_tasks`;
--> statement-breakpoint
-- No relationship existed between legacy tasks and reminders: never merge by title.
INSERT INTO `tasks` (`id`, `title`, `schedule_type`, `scheduled_at`, `enabled`, `created_at`, `updated_at`, `generated_through`, `origin`)
SELECT (SELECT COALESCE(MAX(`id`), 0) FROM `legacy_tasks`) + `id`, `title`, 'one-time', `due_at`, true, `created_at`, unixepoch() * 1000, `due_at`, 'legacy-reminder'
FROM `reminders`;
--> statement-breakpoint
CREATE TABLE `task_occurrences` (
    `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    `task_id` integer NOT NULL REFERENCES `tasks`(`id`),
    `scheduled_at` integer NOT NULL,
    `completed_at` integer,
    `recorded_at` integer,
    `completion_source` text,
    `notification_state` text DEFAULT 'pending' NOT NULL,
    `notified_at` integer,
    `created_at` integer NOT NULL,
    `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_occurrences_task_scheduled_unique` ON `task_occurrences` (`task_id`, `scheduled_at`);
--> statement-breakpoint
-- Completion time was never recorded in the old schema; keep it NULL.
INSERT INTO `task_occurrences` (`task_id`, `scheduled_at`, `recorded_at`, `completion_source`, `notification_state`, `created_at`, `updated_at`)
SELECT t.`id`, t.`scheduled_at`, CASE WHEN l.`completed` THEN unixepoch() * 1000 ELSE NULL END,
    CASE WHEN l.`completed` THEN 'legacy' ELSE NULL END, 'suppressed', t.`created_at`, unixepoch() * 1000
FROM `tasks` t INNER JOIN `legacy_tasks` l ON t.`id` = l.`id`;
--> statement-breakpoint
-- An old notification is not evidence of task completion; actual notification time is unknown.
INSERT INTO `task_occurrences` (`task_id`, `scheduled_at`, `notification_state`, `created_at`, `updated_at`)
SELECT (SELECT COALESCE(MAX(`id`), 0) FROM `legacy_tasks`) + `id`, `due_at`,
    CASE WHEN `notified` THEN 'sent' ELSE 'pending' END, `created_at`, unixepoch() * 1000
FROM `reminders`;
--> statement-breakpoint
DROP TABLE `reminders`;
--> statement-breakpoint
DROP TABLE `legacy_tasks`;
