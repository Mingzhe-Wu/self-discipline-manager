CREATE TABLE `planning_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`wake_time` text DEFAULT '00:00' NOT NULL,
	`sleep_time` text DEFAULT '24:00' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurrence_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_id` integer NOT NULL,
	`scheduled_start_at` integer NOT NULL,
	`scheduled_end_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurrence_exclusions_task_range_unique` ON `recurrence_exclusions` (`task_id`,`scheduled_start_at`,`scheduled_end_at`);