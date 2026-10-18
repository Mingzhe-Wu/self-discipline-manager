const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

// Load application TypeScript under Electron's Node runtime (matching SQLite's ABI).
require('./register-typescript.cjs');

test('reminder persistence, validation, and notification lifecycle', () => {
    const { initializeDatabase } = require('../electron/db/database.ts');
    initializeDatabase(':memory:', 'drizzle');
    const tasks = require('../electron/services/taskService.ts');
    assert.throws(() => tasks.createTask(null), /Task title cannot be empty/);
    assert.throws(() => tasks.createTask('  '), /Task title cannot be empty/);
    const task = tasks.createTask('Existing task');
    assert.throws(() => tasks.updateTaskCompleted(task.id, 'false'), /must be a boolean/);
    assert.throws(() => tasks.updateTaskCompleted(0, true), /Invalid task ID/);
    assert.throws(() => tasks.deleteTask('1'), /Invalid task ID/);
    assert.equal(tasks.updateTaskCompleted(task.id, true).completed, true);

    const service = require('../electron/services/reminderService.ts');
    const repo = require('../electron/db/reminderRepository.ts');
    assert.throws(() => service.createReminder({ title: ' ', dueAt: Date.now() }));
    assert.throws(() => service.createReminder({ title: 'Bad date', dueAt: NaN }));
    assert.throws(() => service.createReminder({ title: 'Bad date', dueAt: 'tomorrow' }));
    assert.throws(() => service.createReminder(null));
    assert.throws(() => service.deleteReminder(-1));
    const due = service.createReminder({ title: '  Due reminder  ', dueAt: Date.now() - 1000 });
    const future = service.createReminder({ title: 'Future reminder', dueAt: Date.now() + 600000 });
    assert.equal(due.title, 'Due reminder');
    assert.equal(due.notified, false);
    assert.equal(typeof due.createdAt, 'number');
    assert.deepEqual(repo.findDueReminders(due.dueAt).map(r => r.id), [due.id]);

    const shown = [];
    let supported = true;
    let throwOnShow = false;
    class Notification extends EventEmitter {
        static isSupported() { return supported; }
        constructor(options) { super(); this.options = options; }
        show() {
            if (throwOnShow) throw new Error('OS rejected notification');
            shown.push(this);
        }
        close() {}
    }
    require.cache[require.resolve('electron')] = { exports: { Notification } };
    const scheduler = require('../electron/scheduler/reminderScheduler.ts');
    const originalSetInterval = global.setInterval;
    const originalClearInterval = global.clearInterval;
    const originalError = console.error;
    let tick;
    let starts = 0;
    let stops = 0;
    global.setInterval = (callback, delay) => {
        assert.equal(delay, 60000);
        tick = callback;
        starts++;
        return 1;
    };
    global.clearInterval = () => { stops++; };
    console.error = () => {};
    try {
        supported = false;
        scheduler.startReminderScheduler();
        scheduler.startReminderScheduler();
        assert.equal(starts, 1);
        assert.equal(shown.length, 0);
        supported = true;
        throwOnShow = true;
        tick();
        assert.equal(service.getAllReminders()[0].notified, false);
        throwOnShow = false;
        tick();
        assert.equal(shown.length, 1);
        assert.equal(shown[0].options.body, 'Due reminder');
        tick();
        assert.equal(shown.length, 1, 'in-flight notifications must not duplicate');
        shown[0].emit('failed', {}, 'Delivery failed');
        tick();
        assert.equal(shown.length, 2, 'failed notifications are retried');
        shown[0].emit('show');
        assert.equal(service.getAllReminders()[0].notified, false, 'late callbacks from failed attempts must not mark a retry notified');
        tick();
        assert.equal(shown.length, 2, 'late callbacks must not remove the active retry');
        assert.equal(service.getAllReminders()[0].notified, false);
        shown[1].emit('show');
        assert.equal(service.getAllReminders()[0].notified, true);
        tick();
        assert.equal(shown.length, 2);
        scheduler.stopReminderScheduler();
        scheduler.stopReminderScheduler();
        assert.equal(stops, 1);
        scheduler.startReminderScheduler();
        assert.equal(starts, 2);
        assert.equal(shown.length, 2, 'persisted notified flag prevents replay');
    } finally {
        scheduler.stopReminderScheduler();
        global.setInterval = originalSetInterval;
        global.clearInterval = originalClearInterval;
        console.error = originalError;
    }
    service.deleteReminder(due.id);
    service.deleteReminder(future.id);
    assert.deepEqual(service.getAllReminders(), []);
    assert.equal(tasks.getAllTasks()[0].title, 'Existing task');
    tasks.deleteTask(task.id);
    assert.deepEqual(tasks.getAllTasks(), []);
    require('../electron/db/database.ts').closeDatabase();
});

test('existing task database upgrades without data loss and migrations are not replayed', () => {
    const Database = require('better-sqlite3');
    const { drizzle } = require('drizzle-orm/better-sqlite3');
    const { migrate } = require('drizzle-orm/better-sqlite3/migrator');
    const { initializeDatabase, getDatabase, closeDatabase } = require('../electron/db/database.ts');
    const tasks = require('../electron/services/taskService.ts');
    const reminders = require('../electron/services/reminderService.ts');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'discipline-migrations-'));
    const legacyMigrations = path.join(directory, 'drizzle');
    const databasePath = path.join(directory, 'data.db');
    let sqlite;
    try {
        fs.mkdirSync(path.join(legacyMigrations, 'meta'), { recursive: true });
        const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json', 'utf8'));
        journal.entries = journal.entries.slice(0, 1);
        fs.writeFileSync(path.join(legacyMigrations, 'meta/_journal.json'), JSON.stringify(journal));
        const migration = journal.entries[0].tag + '.sql';
        fs.copyFileSync(path.join('drizzle', migration), path.join(legacyMigrations, migration));
        sqlite = new Database(databasePath);
        migrate(drizzle(sqlite), { migrationsFolder: legacyMigrations });
        sqlite.prepare('INSERT INTO tasks (title, completed) VALUES (?, ?)').run('Preserved task', 1);
        sqlite.close();
        sqlite = undefined;

        initializeDatabase(databasePath, path.resolve('drizzle'));
        assert.equal(tasks.getAllTasks()[0].title, 'Preserved task');
        assert.equal(tasks.getAllTasks()[0].completed, true);
        reminders.createReminder({ title: 'Preserved reminder', dueAt: 1000 });
        closeDatabase();

        initializeDatabase(databasePath, path.resolve('drizzle'));
        assert.equal(tasks.getAllTasks().length, 1);
        assert.equal(reminders.getAllReminders()[0].title, 'Preserved reminder');
        assert.equal(getDatabase().$client.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get().count, journal.entries.length + 1);
        closeDatabase();
    } finally {
        if (sqlite?.open) sqlite.close();
        closeDatabase();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
