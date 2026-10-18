import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

let db: ReturnType<typeof drizzle> | undefined;
let connection: Database.Database | undefined;

export function initializeDatabase(
    dbPath: string,
    migrationsFolder: string,
) {
    if (connection?.open) {
        throw new Error("Database is already initialized");
    }
    const sqlite = new Database(dbPath);
    try {
        const initialized = drizzle(sqlite);
        migrate(initialized, { migrationsFolder });
        connection = sqlite;
        db = initialized;
    } catch (error) {
        sqlite.close();
        throw error;
    }
}

export function getDatabase() {
    if (!db) {
        throw new Error("Database has not been initialized");
    }
    return db;
}

export function closeDatabase(): void {
    if (connection?.open) connection.close();
    connection = undefined;
    db = undefined;
}
