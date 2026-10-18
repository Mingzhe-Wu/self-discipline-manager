import {
    sqliteTable,
    integer,
    text
} from "drizzle-orm/sqlite-core";

export const tasksTable = sqliteTable("tasks", {
    id: integer("id")
        .primaryKey({ autoIncrement: true }),

    title: text("title")
        .notNull(),

    completed: integer("completed", {
        mode: "boolean"
    })
        .notNull()
        .default(false)
});

export type Task =
    typeof tasksTable.$inferSelect;

export const remindersTable = sqliteTable("reminders", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    title: text("title").notNull(),
    dueAt: integer("due_at").notNull(),
    notified: integer("notified", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
});

export type Reminder = typeof remindersTable.$inferSelect;
