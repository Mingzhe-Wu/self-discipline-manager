const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
require('./register-typescript.cjs');
const runtime = require('../electron/db/database.ts');
const root = path.resolve('drizzle');
const sql = () => fs.readFileSync(path.join(root, '0005_planned_ranges.sql'), 'utf8').split('--> statement-breakpoint').map(s => s.trim()).filter(Boolean);
function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-compat-'));
    const oldFolder = path.join(dir, 'old');
    fs.mkdirSync(path.join(oldFolder, 'meta'), { recursive: true });
    const journal = JSON.parse(fs.readFileSync(path.join(root, 'meta/_journal.json')));
    journal.entries = journal.entries.slice(0, 5);
    fs.writeFileSync(path.join(oldFolder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
        fs.copyFileSync(path.join(root, entry.tag + '.sql'), path.join(oldFolder, entry.tag + '.sql'));
    const file = path.join(dir, 'data.db');
    runtime.initializeDatabase(file, oldFolder);
    const db = runtime.getDatabase().$client;
    const first = Date.parse('2026-10-20T01:45Z'), historical = Date.parse('2026-10-20T03:00Z');
    const rule = JSON.stringify({ frequency: 'daily', startDate: '2026-10-19', time: '18:45', timeZone: 'America/Los_Angeles', weekdays: [] });
    db.prepare("INSERT INTO tasks(id,title,schedule_type,scheduled_at,recurrence_rule,created_at,updated_at,schedule_effective_at,generated_through) VALUES(1,'Edited schedule','recurring',?,?,1,2,?,?)").run(first, rule, first, first + 14 * 86400000);
    db.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_at,started_at,ended_at,recorded_at,progress_source,created_at,updated_at) VALUES(1,1,?,?,?,?, 'corrected',1,2)").run(historical, historical + 123, historical + 1800456, historical + 86400000);
    db.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_at,created_at,updated_at) VALUES(2,1,?,1,2)").run(first);
    db.prepare("INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state,attempt_count,last_attempt_at,sent_at) VALUES(1,0,'sent',2,123,456)").run();
    const before = { tasks: db.prepare('SELECT * FROM tasks').all(), occurrences: db.prepare('SELECT * FROM task_occurrences').all(), slots: db.prepare('SELECT * FROM occurrence_reminder_slots').all() };
    runtime.closeDatabase();
    return { dir, file, before, historical, first };
}
function verify(f) {
    const db = runtime.getDatabase().$client;
    for (const [name, rows] of [['tasks', f.before.tasks], ['task_occurrences', f.before.occurrences]]) {
        const after = db.prepare('SELECT * FROM ' + name + ' ORDER BY id').all();
        assert.equal(after.length, rows.length);
        for (let i = 0; i < rows.length; i++)
            for (const [key, value] of Object.entries(rows[i]))
                if (key !== 'recurrence_rule')
                    assert.deepEqual(after[i][key === 'scheduled_at' ? 'scheduled_start_at' : key], value, key);
    }
    assert.deepEqual(db.prepare('SELECT * FROM occurrence_reminder_slots').all(), f.before.slots);
    assert.equal(db.prepare('SELECT scheduled_end_at n FROM task_occurrences WHERE id=1').get().n, f.historical + 1800000);
    assert.equal(db.prepare('SELECT count(*) n FROM __drizzle_migrations').get().n, JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"))).entries.length);
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
}
function cleanup(f) { runtime.closeDatabase(); fs.rmSync(f.dir, { recursive: true, force: true }); }
test('0005 SQL runs directly in SQLite with no application functions registered', () => { const f = fixture(); try {
    const db = new Database(f.file);
    try {
        db.transaction(() => { for (const statement of sql())
            db.exec(statement); })();
        assert.equal(db.prepare('SELECT count(*) n FROM task_occurrences').get().n, 2);
    }
    finally {
        db.close();
    }
}
finally {
    cleanup(f);
} });
test('edited historical occurrence migrates using its own preserved start and does not lose history or delivery state', () => { const f = fixture(); try {
    runtime.initializeDatabase(f.file, root);
    verify(f);
    runtime.closeDatabase();
    runtime.initializeDatabase(f.file, root);
    verify(f);
}
finally {
    cleanup(f);
} });
test('every unjournalled partial0005 stage resumes without duplicate columns or history changes', () => {
    const statements = sql();
    for (let done = 1; done <= statements.length; done++) {
        const f = fixture();
        try {
            const db = new Database(f.file);
            try {
                for (const statement of statements.slice(0, done))
                    db.exec(statement);
            }
            finally {
                db.close();
            }
            runtime.initializeDatabase(f.file, root);
            verify(f);
        }
        finally {
            cleanup(f);
        }
    }
});
test('a data-conversion failure rolls back DDL, values and migration journal together', () => {
    const f = fixture();
    try {
        const db = new Database(f.file);
        const invalid = { frequency: 'daily', startDate: '2026-10-19', time: '18:45', timeZone: 'Invalid/Saved-Zone', weekdays: [] };
        db.prepare('UPDATE tasks SET recurrence_rule=? WHERE id=1').run(JSON.stringify(invalid));
        db.close();
        assert.throws(() => runtime.initializeDatabase(f.file, root), /migration 0005_planned_ranges failed/);
        assert.throws(() => runtime.getDatabase(), /not been initialized/);
        const check = new Database(f.file);
        try {
            assert.equal(check.prepare('SELECT count(*) n FROM __drizzle_migrations').get().n, 5);
            assert.ok(check.prepare('PRAGMA table_info(task_occurrences)').all().some(c => c.name === 'scheduled_at'));
            assert.equal(check.prepare('SELECT recurrence_rule FROM tasks WHERE id=1').get().recurrence_rule, JSON.stringify(invalid));
            assert.deepEqual(check.prepare('SELECT * FROM occurrence_reminder_slots').all(), f.before.slots);
            check.prepare('UPDATE tasks SET recurrence_rule=? WHERE id=1').run(f.before.tasks[0].recurrence_rule);
        }
        finally {
            check.close();
        }
        runtime.initializeDatabase(f.file, root);
        verify(f);
    }
    finally {
        cleanup(f);
    }
});
