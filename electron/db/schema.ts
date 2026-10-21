import { TASK_CATEGORY_KEYS } from "../../shared/taskCategories";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { RecurrenceRule } from "../../shared/types/task";

export const tasksTable = sqliteTable("tasks", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    category: text("category", { enum: TASK_CATEGORY_KEYS }).notNull().default("other"),
    scheduleType: text("schedule_type", { enum: ["one-time", "recurring"] }).notNull(),
    scheduledStartAt: integer("scheduled_start_at").notNull(),
    scheduledEndAt: integer("scheduled_end_at").notNull().default(0),
    timeZone: text("time_zone").notNull().default("UTC"),
    scheduleEffectiveAt: integer("schedule_effective_at").notNull().default(0),
    recurrenceRule: text("recurrence_rule", { mode: "json" }).$type<RecurrenceRule>(),
    origin: text("origin", { enum: ["user", "legacy-task", "legacy-reminder"] }).notNull().default("user"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    generatedThrough: integer("generated_through"),
    deletedAt: integer("deleted_at"),
});

export const taskOccurrencesTable = sqliteTable("task_occurrences", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull().references(() => tasksTable.id),
    scheduledStartAt: integer("scheduled_start_at").notNull(),
    scheduledEndAt: integer("scheduled_end_at").notNull().default(0),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    recordedAt: integer("recorded_at"),
    progressSource: text("progress_source", { enum: ["normal", "backfill", "corrected", "legacy"] }),
    legacyCompleted: integer("legacy_completed", { mode: "boolean" }).notNull().default(false),
    remindersSuppressed: integer("reminders_suppressed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("task_occurrences_task_scheduled_unique").on(table.taskId, table.scheduledStartAt, table.scheduledEndAt)]);

export type TaskRecord = typeof tasksTable.$inferSelect & { excludedOccurrences?: { scheduledStartAt: number; scheduledEndAt: number }[] };
export type OccurrenceRecord = typeof taskOccurrencesTable.$inferSelect;

export const occurrenceReminderSlotsTable = sqliteTable("occurrence_reminder_slots", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurrenceId: integer("occurrence_id").notNull().references(() => taskOccurrencesTable.id),
    slot: integer("slot").notNull(),
    state: text("state", { enum: ["sending", "sent", "failed", "unknown"] }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(1),
    lastAttemptAt: integer("last_attempt_at"),
    sentAt: integer("sent_at"),
}, (table) => [uniqueIndex("occurrence_reminder_slot_unique").on(table.occurrenceId, table.slot)]);

export const recurrenceExclusionsTable = sqliteTable("recurrence_exclusions", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taskId: integer("task_id").notNull().references(() => tasksTable.id),
    scheduledStartAt: integer("scheduled_start_at").notNull(),
    scheduledEndAt: integer("scheduled_end_at").notNull(),
    createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("recurrence_exclusions_task_range_unique").on(table.taskId, table.scheduledStartAt, table.scheduledEndAt)]);

export const userSettingsTable = sqliteTable("user_settings", {
    id: integer("id").primaryKey(),
    wakeTime: text("wake_time").notNull().default("00:00"),
    sleepTime: text("sleep_time").notNull().default("24:00"),
    defaultTaskDurationMinutes: integer("default_task_duration_minutes").notNull().default(60),
    weekStartsOn: integer("week_starts_on").$type<0 | 1>().notNull().default(1),
    notificationsEnabled: integer("notifications_enabled", { mode: "boolean" }).notNull().default(true),
    trayMiniEnabled: integer("tray_mini_enabled", { mode: "boolean" }).notNull().default(false),
    closeToTray: integer("close_to_tray", { mode: "boolean" }).notNull().default(true),
    /** Delivery watermark, internal only: never replay slots that elapsed while disabled. */
    notificationsResumeAt: integer("notifications_resume_at").notNull().default(0),
}, table => [check("user_settings_singleton", sql`${table.id} = 1`)]);

export const localProfilesTable = sqliteTable("local_profiles", {
    id: integer("id").primaryKey(),
    displayName: text("display_name").notNull().default("Local User"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
}, table => [check("local_profiles_singleton", sql`${table.id} = 1`)]);
