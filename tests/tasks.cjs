const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./register-typescript.cjs');
const database = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const createBeforeStart = require('./create-before-start.cjs');
const { occurrenceState, occurrenceDuration } = require('../shared/occurrenceLifecycle.ts');
const finish = (target) => { service.startOccurrence(target); return service.endOccurrence(target); };
const instant = (text) => Date.parse(text);
const now = instant('2026-10-19T18:00:00Z');
const migrations = path.resolve('drizzle');
const daily = (overrides = {}) => ({ title: 'Daily practice', scheduleType: 'recurring', recurrenceRule: {
    frequency: 'daily', startDate: '2026-10-17', startTime: '09:00', endTime: '09:30', timeZone: 'UTC', weekdays: [], ...overrides,
} });

beforeEach(() => {
    mock.method(Date, 'now', () => now);
    database.initializeDatabase(':memory:', migrations);
});
afterEach(() => { database.closeDatabase(); mock.restoreAll(); });

test('one-time task has one persistent occurrence and stays completed', () => {
    const task = createBeforeStart(service, { title: '  Dentist  ', scheduleType: 'one-time', scheduledStartAt: now - 5 * 60000, scheduledEndAt: now + 25 * 60000 });
    assert.equal(task.title, 'Dentist');
    assert.equal(task.scheduleType, 'one-time');
    const occurrence = task.currentOccurrence;
    assert.equal(occurrence.scheduledStartAt, now - 5 * 60000);
    const started = service.startOccurrence({ taskId: task.id, occurrenceId: occurrence.id });
    assert.equal(occurrenceState(started), 'in-progress');
    assert.equal(started.startedAt, now);
    service.endOccurrence({ taskId: task.id, occurrenceId: occurrence.id });
    Date.now.mock.mockImplementation(() => now + 5 * 86400000);
    const loaded = service.getAllTasks()[0];
    assert.equal(loaded.currentOccurrence.endedAt, now);
    assert.equal(loaded.currentOccurrence.recordedAt, now);
    assert.equal(loaded.nextOccurrenceAt, null);
    assert.equal(service.listOccurrences(task.id, now - 86400000, now + 10 * 86400000).length, 1);
});

test('new one-time schedules reject elapsed starts without writing task or occurrence rows', () => {
    const input = { title: 'Future appointment', scheduleType: 'one-time', scheduledStartAt: now + 5 * 60000, scheduledEndAt: now + 35 * 60000, timeZone: 'UTC' };
    const sql = database.getDatabase().$client;
    assert.throws(() => service.createTask({ ...input, scheduledStartAt: now - 5 * 60000 }), /future/);
    assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n, 0);
    assert.equal(sql.prepare('SELECT count(*) n FROM task_occurrences').get().n, 0);
    const future = service.createTask(input);
    assert.equal(future.scheduledStartAt, input.scheduledStartAt);
    // Creation and schedule editing share the same inclusive current instant boundary.
    const current = service.createTask({ ...input, title: 'Current boundary', scheduledStartAt: now });
    assert.equal(current.scheduledStartAt, now);
    assert.equal(sql.prepare('SELECT count(*) n FROM tasks').get().n, 2);
    assert.equal(sql.prepare('SELECT count(*) n FROM task_occurrences').get().n, 2);
});

test('daily completion belongs to one occurrence and future occurrences remain active', () => {
    const task = service.createTask(daily());
    const today = task.currentOccurrence;
    assert.equal(today.scheduledStartAt, instant('2026-10-19T09:00Z'));
    const target = { taskId: task.id, occurrenceId: today.id };
    const started = service.startOccurrence(target);
    assert.equal(occurrenceState(started), 'in-progress');
    assert.equal(started.endedAt, null);
    const neighboringRows = service.listOccurrences(task.id, instant('2026-10-17T00:00Z'), instant('2026-10-21T00:00Z'));
    assert.ok(neighboringRows.filter((row) => row.id !== today.id).every((row) => occurrenceState(row) === 'planned'));
    service.endOccurrence(target);
    assert.equal(service.getAllTasks()[0].enabled, true);
    assert.equal(service.getAllTasks()[0].nextOccurrenceAt, instant('2026-10-20T09:00Z'));
    Date.now.mock.mockImplementation(() => instant('2026-10-20T18:00Z'));
    const tomorrow = service.getAllTasks()[0].currentOccurrence;
    assert.notEqual(tomorrow.id, today.id);
    assert.equal(occurrenceState(tomorrow), 'planned');
    assert.equal(tomorrow.startedAt, null);
    assert.equal(tomorrow.endedAt, null);
    assert.equal(tomorrow.recordedAt, null);
    const history = service.listOccurrences(task.id, instant('2026-10-17T00:00Z'), instant('2026-10-21T00:00Z'));
    assert.equal(history.length, 4);
    assert.equal(history.filter((item) => item.recordedAt !== null).length, 1);
});

test('weekly recurrence produces only selected weekdays from the start date', () => {
    const task = service.createTask(daily({ frequency: 'weekly', weekdays: [1, 3], startDate: '2026-10-19' }));
    const occurrences = service.listOccurrences(task.id, instant('2026-10-19T00:00Z'), instant('2026-10-26T00:00Z'));
    assert.deepEqual(occurrences.map((item) => new Date(item.scheduledStartAt).getUTCDay()).sort(), [1, 3]);
    assert.throws(() => service.createTask(daily({ frequency: 'weekly', weekdays: [] })), /weekday/i);
    assert.throws(() => service.createTask(daily({ timeZone: 'Invalid/Zone' })), /schedule|zone/i);
    assert.throws(() => service.createTask(daily({ startTime: '25:00', endTime: '25:30' })), /time|schedule/i);
});

test("before today's scheduled time, current occurrence is today rather than yesterday", () => {
    Date.now.mock.mockImplementation(() => instant('2026-10-19T06:00Z'));
    const task = service.createTask(daily());
    assert.equal(task.currentOccurrence.scheduledStartAt, instant('2026-10-19T09:00Z'));
    assert.equal(task.nextOccurrenceAt, instant('2026-10-19T09:00Z'));
});

test('manual backfill and corrections preserve scheduled time and first record-entry time', () => {
    const task = service.createTask(daily());
    const old = service.listOccurrences(task.id, instant('2026-10-17T00:00Z'), instant('2026-10-18T00:00Z'))[0];
    const actual = instant('2026-10-17T09:05Z');
    const target = { taskId: task.id, occurrenceId: old.id };
    const backfilled = service.updateOccurrenceTimes({ ...target, startedAt: actual, endedAt: actual + 600000 });
    assert.equal(backfilled.progressSource, 'backfill');
    assert.equal(occurrenceDuration(backfilled), 600000);
    Date.now.mock.mockImplementation(() => now + 86400000);
    const corrected = service.updateOccurrenceTimes({ ...target, startedAt: actual - 600000, endedAt: actual + 600000 });
    assert.equal(corrected.scheduledStartAt, old.scheduledStartAt);
    assert.equal(corrected.startedAt, actual - 600000);
    assert.equal(corrected.endedAt, actual + 600000);
    assert.equal(corrected.recordedAt, now);
    assert.equal(corrected.updatedAt, now + 86400000);
    assert.equal(corrected.progressSource, 'corrected');
    const cleared = service.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
    assert.equal(cleared.recordedAt, now);
    assert.equal(cleared.progressSource, 'corrected');
    assert.equal(occurrenceState(cleared), 'planned');
    assert.equal(occurrenceDuration(cleared), null);
    assert.throws(() => service.startOccurrence({ taskId: task.id, occurrenceId: old.id + 999999 }), /occurrence/i);
});

test('offline dates are generated on return without duplication or loss of completion history', () => {
    const task = service.createTask(daily());
    finish({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    Date.now.mock.mockImplementation(() => instant('2026-12-19T18:00Z'));
    service.getAllTasks();
    const from = instant('2026-10-17T00:00Z');
    const to = instant('2026-12-20T00:00Z');
    const first = service.listOccurrences(task.id, from, to);
    assert.equal(first.length, 64);
    assert.equal(service.listOccurrences(task.id, from, to).length, 64);
    assert.ok(first.some((item) => item.recordedAt === now));
});

test('deleting immediately after downtime retains expected occurrences up to deletion', () => {
    const task = service.createTask(daily());
    Date.now.mock.mockImplementation(() => instant('2026-12-19T18:00Z'));
    service.deleteTask(task.id);
    const expected = database.getDatabase().$client.prepare('SELECT count(*) AS count FROM task_occurrences WHERE task_id = ? AND scheduled_start_at <= ?').get(task.id, Date.now());
    assert.equal(expected.count, 64);
});

test('DST uses calendar wall time with one occurrence per selected date', () => {
    const spring = service.createTask(daily({ startDate: '2026-03-07', startTime: '02:30', endTime: '04:00', timeZone: 'America/Los_Angeles' }));
    const occurrences = service.listOccurrences(spring.id, instant('2026-03-07T00:00Z'), instant('2026-03-10T00:00Z'));
    assert.deepEqual(occurrences.map((item) => item.scheduledStartAt).sort((a,b) => a-b), [
        instant('2026-03-07T10:30Z'), instant('2026-03-08T10:30Z'), instant('2026-03-09T09:30Z'),
    ]);
    const fall = service.createTask(daily({ startDate: '2026-11-01', startTime: '01:30', endTime: '02:00', timeZone: 'America/Los_Angeles' }));
    const fallOccurrences = service.listOccurrences(fall.id, instant('2026-11-01T00:00Z'), instant('2026-11-03T00:00Z'));
    assert.deepEqual(fallOccurrences.map((item) => item.scheduledStartAt).sort((a,b) => a-b), [instant('2026-11-01T08:30Z'), instant('2026-11-02T09:30Z')]);
});

test('notification preference and deletion preserve occurrence history', () => {
    const task = service.createTask(daily());
    const before = service.listOccurrences(task.id, now - 3 * 86400000, now + 86400000);
    service.setTaskEnabled(task.id, false);
    assert.equal(service.getAllTasks()[0].enabled, false);
    assert.deepEqual(service.listOccurrences(task.id, now - 3 * 86400000, now + 86400000), before);
    service.setTaskEnabled(task.id, true);
    assert.equal(service.getAllTasks()[0].enabled, true);
    service.deleteTask(task.id);
    assert.equal(service.getAllTasks().some((item) => item.id === task.id), false);
    assert.ok(database.getDatabase().$client.prepare('SELECT count(*) AS count FROM task_occurrences WHERE task_id = ?').get(task.id).count > 0);
});

test('full database restart preserves task schedules and edited occurrence history', () => {
    database.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-task-restart-'));
    const filename = path.join(directory, 'data.db');
    try {
        database.initializeDatabase(filename, migrations);
        const task = service.createTask(daily());
        const completed = service.updateOccurrenceTimes({ taskId: task.id, occurrenceId: task.currentOccurrence.id,
            startedAt: now - 600000, endedAt: now - 60000 });
        database.closeDatabase();
        database.initializeDatabase(filename, migrations);
        const loaded = service.getAllTasks()[0];
        assert.deepEqual(loaded.recurrenceRule, task.recurrenceRule);
        assert.deepEqual(loaded.currentOccurrence, completed);
        assert.equal(loaded.currentOccurrence.recordedAt, now);
    } finally {
        database.closeDatabase();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test('old Tasks and Reminders migrate losslessly without treating notifications as completion', () => {
    database.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-task-upgrade-'));
    try {
        const oldMigrations = path.join(directory, 'old');
        fs.mkdirSync(path.join(oldMigrations, 'meta'), { recursive: true });
        const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json')));
        journal.entries = journal.entries.slice(0, 2);
        fs.writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
        for (const entry of journal.entries) fs.copyFileSync(path.join(migrations, entry.tag + '.sql'), path.join(oldMigrations, entry.tag + '.sql'));
        const filename = path.join(directory, 'data.db');
        database.initializeDatabase(filename, oldMigrations);
        const sqlite = database.getDatabase().$client;
        sqlite.exec("INSERT INTO tasks(title, completed) VALUES ('Legacy done', 1), ('Legacy open', 0)");
        sqlite.prepare('INSERT INTO reminders(title, due_at, notified, created_at) VALUES (?, ?, ?, ?)').run('Old notified', now - 10000, 1, now - 20000);
        sqlite.prepare('INSERT INTO reminders(title, due_at, notified, created_at) VALUES (?, ?, ?, ?)').run('Old pending', now + 10000, 0, now - 20000);
        database.closeDatabase();
        database.initializeDatabase(filename, migrations);
        const migrated = service.getAllTasks();
        assert.equal(migrated.length, 4);
        const done = migrated.find((item) => item.title === 'Legacy done');
        assert.equal(done.id, 1);
        assert.equal(done.enabled, false);
        assert.equal(done.origin, 'legacy-task');
        assert.ok(done.currentOccurrence.recordedAt !== null);
        assert.equal(done.currentOccurrence.startedAt, null);
        assert.equal(done.currentOccurrence.endedAt, null, 'unknown legacy actual completion time is not fabricated');
        assert.equal(done.currentOccurrence.legacyCompleted, true);
        assert.equal(done.currentOccurrence.progressSource, 'legacy');
        assert.equal(occurrenceState(done.currentOccurrence), 'completed');
        assert.equal(occurrenceDuration(done.currentOccurrence), null);
        assert.equal(done.currentOccurrence.remindersSuppressed, true);
        const notified = migrated.find((item) => item.title === 'Old notified');
        assert.equal(notified.scheduledStartAt, now - 10000);
        assert.equal(notified.origin, 'legacy-reminder');
        const slots = database.getDatabase().$client.prepare('SELECT slot, state, sent_at FROM occurrence_reminder_slots WHERE occurrence_id = ? ORDER BY slot').all(notified.currentOccurrence.id);
        assert.deepEqual(slots.map((slot) => slot.slot), [-5, 0, 3, 6, 9, 12, 15]);
        assert.ok(slots.every((slot) => slot.state === 'sent' && slot.sent_at === null));
        assert.equal(occurrenceState(notified.currentOccurrence), 'planned');
        assert.equal(notified.currentOccurrence.recordedAt, null);
        const pending = migrated.find((item) => item.title === 'Old pending');
        assert.equal(pending.currentOccurrence.remindersSuppressed, false);
        assert.equal(occurrenceState(pending.currentOccurrence), 'planned');
        assert.equal(database.getDatabase().$client.prepare('SELECT count(*) AS n FROM occurrence_reminder_slots WHERE occurrence_id = ?').get(pending.currentOccurrence.id).n, 0);
        assert.equal(database.getDatabase().$client.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='reminders'").get().count, 0);
        database.closeDatabase();
        database.initializeDatabase(filename, migrations);
        assert.equal(service.getAllTasks().length, 4);
    } finally {
        database.closeDatabase();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

