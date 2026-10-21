import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { readFileSync } from "node:fs";
import path from "node:path";
import { legacyScheduleEnd } from "./migrationRanges";

/** Keep Drizzle's files/hashes/journal; make the failed range upgrade resumable and atomic. */
export function runRuntimeMigrations(sqlite: Database.Database, migrationsFolder: string): void {
    const migrations = readMigrationFiles({ migrationsFolder });
    const journal = JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
        entries: { tag: string; when: number }[];
    };
    const tags = new Map(journal.entries.map((entry) => [entry.when, entry.tag]));
    sqlite.transaction(() => {
        sqlite.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)");
        const last = sqlite.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined;
        for (const migration of migrations) {
            if (last && Number(last.created_at) >= migration.folderMillis) continue;
            const tag = tags.get(migration.folderMillis);
            try {
                if (tag === "0005_planned_ranges") upgradePlannedRanges(sqlite, migration.sql);
                else for (const statement of migration.sql) sqlite.exec(statement);
                sqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)").run(migration.hash, migration.folderMillis);
            } catch (error) {
                throw new Error(`Database migration ${tag ?? migration.folderMillis} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
            }
        }
    }).immediate();
}

function columns(sqlite: Database.Database, table: string): Set<string> {
    return new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((column) => column.name));
}

function upgradePlannedRanges(sqlite: Database.Database, statements: string[]): void {
    for (const statement of statements) {
        // A failed external/nontransactional attempt may already have committed some DDL.
        const rename = statement.match(/^\s*ALTER TABLE (tasks|task_occurrences) RENAME COLUMN scheduled_at TO scheduled_start_at/i);
        if (rename) {
            const present = columns(sqlite, rename[1]);
            if (present.has("scheduled_start_at") && !present.has("scheduled_at")) continue;
        }
        const add = statement.match(/^\s*ALTER TABLE (tasks|task_occurrences) ADD COLUMN (scheduled_end_at|time_zone)/i);
        if (add && columns(sqlite, add[1]).has(add[2])) continue;
        sqlite.exec(statement);
    }
    // SQLite cannot resolve saved IANA zones. Run explicit typed data conversion,
    // in this same transaction, rather than invoking application code from SQL.
    const tasks = sqlite.prepare("SELECT id, schedule_type, scheduled_start_at, recurrence_rule, time_zone FROM tasks").all() as {
        id: number; schedule_type: string; scheduled_start_at: number; recurrence_rule: string | null; time_zone: string;
    }[];
    const updateTask = sqlite.prepare("UPDATE tasks SET time_zone = ?, scheduled_end_at = ? WHERE id = ?");
    const updateOccurrence = sqlite.prepare("UPDATE task_occurrences SET scheduled_end_at = ? WHERE id = ?");
    const occurrences = sqlite.prepare("SELECT id, scheduled_start_at FROM task_occurrences WHERE task_id = ?");
    for (const task of tasks) {
        const zone = task.schedule_type === "one-time" ? Intl.DateTimeFormat().resolvedOptions().timeZone : task.time_zone;
        updateTask.run(zone, legacyScheduleEnd(task.scheduled_start_at, zone, task.recurrence_rule), task.id);
        for (const occurrence of occurrences.all(task.id) as { id: number; scheduled_start_at: number }[]) {
            updateOccurrence.run(legacyScheduleEnd(occurrence.scheduled_start_at, zone, task.recurrence_rule), occurrence.id);
        }
    }
    if (sqlite.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Foreign key validation failed after planned-range upgrade");
}
