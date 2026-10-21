const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Database = require('better-sqlite3');
require('./register-typescript.cjs');
const runtime = require('../electron/db/database.ts');
const settings = require('../electron/services/settingsService.ts');

(async () => {
    const source = process.argv[2];
    if (!source || !fs.existsSync(source)) throw Error('Pass the existing database path; no new user profile will be created');
    const evidence = fs.mkdtempSync(path.resolve('release/verification/profile-migration-'));
    const file = path.join(evidence, 'snapshot.db');
    // SQLite online backup includes committed WAL data. The source is read-only.
    const live = new Database(source, { readonly: true, fileMustExist: true });
    try { await live.backup(file); } finally { live.close(); }
    const copy = new Database(file);
    const hash = (db, table) => crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${table} ORDER BY id`).all())).digest('hex');
    const tables = ['tasks', 'task_occurrences', 'occurrence_reminder_slots', 'recurrence_exclusions'];
    const before = Object.fromEntries(tables.map(table => [table, { hash: hash(copy, table), count: copy.prepare(`SELECT count(*) n FROM ${table}`).get().n }]));
    const old = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planning_settings'").get();
    const hours = copy.prepare(`SELECT wake_time, sleep_time FROM ${old ? 'planning_settings' : 'user_settings'} WHERE id=1`).get();
    const beforeMigrations = copy.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at').all();
    copy.close();
    try {
        runtime.initializeDatabase(file, path.resolve('drizzle'));
        const sql = runtime.getDatabase().$client;
        for (const table of tables) assert.equal(hash(sql, table), before[table].hash, `${table} preserved byte-for-byte`);
        if (hours) assert.deepEqual(settings.getPlanningHours(), { wakeTime: hours.wake_time, sleepTime: hours.sleep_time });
        assert.equal(sql.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(sql.pragma('foreign_key_check'), []);
        const preferences = settings.getLocalPreferences();
        assert.ok(preferences.profile.displayName); assert.equal(preferences.profile.id, 1);
        const afterMigrations = sql.prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at').all();
        const result = { passed: true, beforeMigrations, afterMigrations, preserved: before, hoursPreserved: true, sourceOpenedReadOnly: true };
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ passed: true, evidence, migrationCountBefore: beforeMigrations.length, migrationCountAfter: afterMigrations.length, preservedCounts: Object.fromEntries(tables.map(table => [table, before[table].count])) }));
    } finally { runtime.closeDatabase(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
