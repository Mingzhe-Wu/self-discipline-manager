CREATE TABLE `reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`notified` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
