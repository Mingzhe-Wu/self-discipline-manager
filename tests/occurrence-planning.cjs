const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const reminders = require('../electron/services/reminderService.ts');
const day = 86400000, hour = 3600000;
const start = Date.parse('2026-10-19T09:00Z');
const daily = (changes = {}) => ({ title: 'Daily', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-19', startTime: '09:00', endTime: '10:00', timeZone: 'UTC', weekdays: [], ...changes } });
const single = (at) => ({ title: 'Detached', scheduleType: 'one-time', scheduledStartAt: at, scheduledEndAt: at + hour, timeZone: 'UTC' });
beforeEach(() => { mock.method(Date, 'now', () => start - hour); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });

test('sync ON edits the rule and preserves past and meaningful history', () => {
    const task = service.createTask(daily());
    const original = task.currentOccurrence;
    service.updateOccurrenceTimes({ taskId: task.id, occurrenceId: original.id, startedAt: start, endedAt: start + 600000 });
    Date.now.mock.mockImplementation(() => start + day - hour);
    const result = service.updateOccurrencePlan({ target: { taskId: task.id, scheduledStartAt: start + day, scheduledEndAt: start + day + hour }, changes: daily({ startTime: '11:00', endTime: '12:00' }), sync: true });
    assert.equal(result.id, task.id);
    assert.equal(result.recurrenceRule.startTime, '11:00');
    assert.equal(service.listOccurrences(task.id, start, start + 1)[0].endedAt, start + 600000);
    assert.equal(service.getWeekSchedule(start + day, start + 2 * day).occurrences[0].scheduledStartAt, start + day + 2 * hour);
});

test('detach persists distant virtual exclusion across restart, rule edits, start and reminder paths', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occurrence-detach-'));
    const file = path.join(dir, 'data.db');
    db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle'));
    try {
        const task = service.createTask(daily());
        const at = start + 90 * day;
        const target = { taskId: task.id, scheduledStartAt: at, scheduledEndAt: at + hour };
        const detached = service.updateOccurrencePlan({ target, changes: single(at + 2 * hour), sync: false });
        assert.equal(detached.currentOccurrence.startedAt, null);
        assert.equal(detached.currentOccurrence.endedAt, null);
        assert.equal(service.getAllTasks().find(t => t.id === task.id).recurrenceRule.startTime, '09:00');
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle'));
        service.updateTask(task.id, daily({ endTime: '10:30' }));
        const changedRange = service.getWeekSchedule(at, at + day).occurrences.filter(row => row.taskId === task.id);
        assert.equal(changedRange.length, 1);
        assert.equal(changedRange[0].scheduledEndAt, at + 1.5 * hour);
        service.updateTask(task.id, daily({ startTime: '11:00', endTime: '12:00' }));
        service.updateTask(task.id, daily());
        assert.equal(service.getWeekSchedule(at, at + day).occurrences.filter(row => row.taskId === task.id).length, 0);
        assert.throws(() => service.startOccurrence(target), /not found|excluded/);
        Date.now.mock.mockImplementation(() => at - 300000);
        assert.equal(reminders.getDueReminders().filter(row => row.taskId === task.id).length, 0);
        assert.equal(db.getDatabase().$client.prepare('SELECT count(*) n FROM recurrence_exclusions').get().n, 1);
    } finally { db.closeDatabase(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('detach keeps meaningful cleared history and delivery slots', () => {
    const task = service.createTask(daily());
    const original = task.currentOccurrence;
    const target = { taskId: task.id, occurrenceId: original.id };
    service.startOccurrence(target);
    service.endOccurrence(target);
    service.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
    db.getDatabase().$client.prepare("INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state) VALUES (?,0,'sent')").run(original.id);
    const detached = service.updateOccurrencePlan({ target, changes: single(start + 2 * hour), sync: false });
    const row = service.listOccurrences(task.id, start, start + 1)[0];
    assert.equal(row.id, original.id); assert.equal(row.remindersSuppressed, true);
    assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots WHERE occurrence_id=?').get(original.id).state, 'sent');
    assert.equal(detached.currentOccurrence.recordedAt, null);
    assert.equal(service.getWeekSchedule(start, start + day).occurrences.filter(row => row.taskId === task.id).length, 0);
    assert.throws(() => service.startOccurrence(target), /excluded/);
});

test('replanning started and completed occurrences preserves original actual history without copying it', () => {
    for (const state of ['started', 'completed', 'legacy-completed']) {
        const task = service.createTask(daily());
        const target = { taskId: task.id, occurrenceId: task.currentOccurrence.id };
        if (state === 'legacy-completed') db.getDatabase().$client.prepare('UPDATE task_occurrences SET legacy_completed=1 WHERE id=?').run(target.occurrenceId);
        else {
            service.startOccurrence(target);
            if (state === 'completed') service.endOccurrence(target);
        }
        const before = service.listOccurrences(task.id, start, start + 1)[0];
        const detached = service.updateOccurrencePlan({ target, changes: single(start + 2 * hour), sync: false });
        const retained = service.listOccurrences(task.id, start, start + 1)[0];
        assert.equal(retained.id, before.id);
        assert.equal(retained.startedAt, before.startedAt);
        assert.equal(retained.endedAt, before.endedAt);
        assert.equal(retained.recordedAt, before.recordedAt);
        assert.equal(retained.progressSource, before.progressSource);
        assert.equal(retained.legacyCompleted, before.legacyCompleted);
        assert.equal(retained.remindersSuppressed, true);
        assert.equal(detached.currentOccurrence.startedAt, null);
        assert.equal(detached.currentOccurrence.endedAt, null);
        assert.equal(detached.currentOccurrence.recordedAt, null);
        assert.equal(detached.currentOccurrence.progressSource, null);
        assert.equal(detached.currentOccurrence.legacyCompleted, false);
        assert.equal(service.getWeekSchedule(start, start + day).occurrences.filter(row => row.taskId === task.id).length, 0);
        assert.equal(service.getAllTasks().find(row => row.id === task.id).recurrenceRule.startTime, '09:00');
    }
});

test('detaching a notified occurrence keeps its slot and invalidates a queued notification', () => {
    const task = service.createTask(daily());
    Date.now.mock.mockImplementation(() => start - 300000);
    const reminder = reminders.getDueReminders().find(row => row.taskId === task.id);
    assert.ok(reminder);
    assert.equal(reminders.claimReminder(reminder), true);
    reminders.markReminderSent(reminder);
    service.updateOccurrencePlan({ target: { taskId: task.id, occurrenceId: reminder.occurrenceId }, changes: single(start + 2 * hour), sync: false });
    assert.equal(reminders.isReminderRelevant(reminder), false);
    assert.equal(reminders.claimReminder(reminder), false);
    assert.equal(reminders.getDueReminders().filter(row => row.taskId === task.id).length, 0);
    assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots WHERE occurrence_id=?').get(reminder.occurrenceId).state, 'sent');
});

test('replacement insert failure rolls back exclusion and deletion of the original occurrence', () => {
    const task = service.createTask(daily());
    const sql = db.getDatabase().$client;
    const before = sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(task.currentOccurrence.id);
    sql.exec("CREATE TRIGGER reject_detached BEFORE INSERT ON tasks WHEN NEW.title='Detached' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
    assert.throws(() => service.updateOccurrencePlan({ target: { taskId: task.id, occurrenceId: task.currentOccurrence.id }, changes: single(start + 2 * hour), sync: false }), /fixture rejection/);
    assert.equal(sql.prepare('SELECT count(*) n FROM recurrence_exclusions').get().n, 0);
    assert.equal(service.getAllTasks().length, 1);
    assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(task.currentOccurrence.id), before);
});
