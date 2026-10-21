CREATE TABLE `local_profiles` (
	`id` integer PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT 'Local User' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "local_profiles_singleton" CHECK("local_profiles"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`wake_time` text DEFAULT '00:00' NOT NULL,
	`sleep_time` text DEFAULT '24:00' NOT NULL,
	`default_task_duration_minutes` integer DEFAULT 60 NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`notifications_enabled` integer DEFAULT true NOT NULL,
	`tray_mini_enabled` integer DEFAULT false NOT NULL,
	`close_to_tray` integer DEFAULT true NOT NULL,
	`notifications_resume_at` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_settings_singleton" CHECK("user_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO user_settings (id, wake_time, sleep_time)
SELECT id, wake_time, sleep_time FROM planning_settings WHERE id = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO user_settings (id) VALUES (1);
--> statement-breakpoint
INSERT INTO local_profiles (id, display_name, created_at, updated_at)
VALUES (1, 'Local User', unixepoch() * 1000, unixepoch() * 1000);
--> statement-breakpoint
DROP TABLE planning_settings;
