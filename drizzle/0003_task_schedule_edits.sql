ALTER TABLE `tasks` ADD `schedule_effective_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `tasks` SET `schedule_effective_at` = `scheduled_at`;
