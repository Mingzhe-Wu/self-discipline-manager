const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
require('./register-typescript.cjs');
const database = require('../electron/db/database.ts');
const settings = require('../electron/services/settingsService.ts');
const tasks = require('../electron/services/taskService.ts');
const createBeforeStart = require('./create-before-start.cjs');
const { validatePlanningHours, assertPlanningRange } = require('../shared/scheduling/planningHours.ts');
const now = Date.parse('2026-10-20T08:00Z');
const hours = { wakeTime: '08:00', sleepTime: '22:00' };
beforeEach(() => { mock.method(Date, 'now', () => now); database.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { database.closeDatabase(); mock.restoreAll(); });
const single = (title, start, end, timeZone = 'UTC') => createBeforeStart(tasks, { title, scheduleType: 'one-time', scheduledStartAt: Date.parse(start), scheduledEndAt: Date.parse(end), timeZone });

test('planning settings validate five-minute same-day boundaries and full-day default', () => {
    assert.deepEqual(settings.getPlanningHours(), { wakeTime: '00:00', sleepTime: '24:00' });
    assert.deepEqual(validatePlanningHours(hours), hours);
    for (const value of [null, {}, { wakeTime: '24:00', sleepTime: '24:00' }, { wakeTime: '08:03', sleepTime: '22:00' }, { wakeTime: '08:00', sleepTime: '22:01' }, { wakeTime: '08:00', sleepTime: '08:00' }, { wakeTime: '23:00', sleepTime: '07:00' }]) assert.throws(() => validatePlanningHours(value));
    assert.doesNotThrow(() => assertPlanningRange(Date.parse('2026-10-20T15:00Z'), Date.parse('2026-10-20T16:00Z'), 'America/Los_Angeles', hours));
    assert.doesNotThrow(() => assertPlanningRange(Date.parse('2026-10-20T14:55Z'), Date.parse('2026-10-20T16:00Z'), 'America/Los_Angeles', hours));
    assert.doesNotThrow(() => assertPlanningRange(Date.parse('2026-10-20T23:00Z'), Date.parse('2026-10-21T00:00Z'), 'UTC', { wakeTime: '00:00', sleepTime: '24:00' }));
});

test('planning settings persist across database restart as a singleton', () => {
    database.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planning-settings-'));
    try {
        const file = path.join(directory, 'settings.db');
        database.initializeDatabase(file, path.resolve('drizzle'));
        settings.updatePlanningHours(hours);
        settings.updatePlanningHours({ ...hours, sleepTime: '23:00' });
        database.closeDatabase(); database.initializeDatabase(file, path.resolve('drizzle'));
        assert.deepEqual(settings.getPlanningHours(), { ...hours, sleepTime: '23:00' });
        assert.equal(database.getDatabase().$client.prepare('SELECT count(*) AS count FROM user_settings').get().count, 1);
    } finally { database.closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('display settings allow existing future tasks including disabled recurring notifications', () => {
    single('Early appointment', '2026-10-21T07:00Z', '2026-10-21T08:00Z');
    tasks.createTask({ title: 'Late practice', enabled: false, scheduleType: 'recurring', recurrenceRule: { frequency: 'weekly', startDate: '2027-10-20', startTime: '22:00', endTime: '23:00', timeZone: 'Pacific/Auckland', weekdays: [1] } });
    assert.deepEqual(settings.updatePlanningHours(hours), hours);
    assert.deepEqual(settings.getPlanningHours(), hours);
});

test('past and completed one-time history allows narrowing without rewriting actual timestamps', () => {
    const past = single('Past', '2026-10-19T06:00Z', '2026-10-19T07:00Z');
    const completed = single('Finished', '2026-10-21T06:00Z', '2026-10-21T07:00Z');
    const target = { taskId: completed.id, occurrenceId: completed.currentOccurrence.id };
    const actual = tasks.updateOccurrenceTimes({ ...target, startedAt: now - 12345, endedAt: now - 123 });
    assert.deepEqual(settings.updatePlanningHours(hours), hours);
    const loaded = tasks.getAllTasks();
    assert.equal(loaded.find((task) => task.id === past.id).scheduledStartAt, past.scheduledStartAt);
    assert.equal(loaded.find((task) => task.id === completed.id).currentOccurrence.endedAt, actual.endedAt);
});

test('display preferences do not constrain current unfinished tasks in other zones', () => {
    single('Ongoing in Los Angeles', '2026-10-20T07:30Z', '2026-10-20T08:30Z', 'America/Los_Angeles');
    assert.doesNotThrow(() => settings.updatePlanningHours(hours));
});

test('invalid settings leave the saved value untouched', () => {
    settings.updatePlanningHours(hours);
    assert.throws(() => settings.updatePlanningHours({ wakeTime: '09:03', sleepTime: '22:00' }));
    assert.deepEqual(settings.getPlanningHours(), hours);
});

test('display preferences do not impose seasonal constraints on recurring tasks', () => {
    const task = tasks.createTask({ title: 'Seasonal practice', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-20', startTime: '01:30', endTime: '02:30', timeZone: 'America/Los_Angeles', weekdays: [] } });
    database.getDatabase().$client.prepare('INSERT INTO recurrence_exclusions (task_id,scheduled_start_at,scheduled_end_at,created_at) VALUES (?,?,?,?)')
        .run(task.id, Date.parse('2027-03-14T09:30Z'), Date.parse('2027-03-14T10:30Z'), now);
    assert.doesNotThrow(() => settings.updatePlanningHours({ wakeTime: '01:00', sleepTime: '03:00' }));
});

test('settings narrow around unchanged unaligned legacy schedules without rewriting history', () => {
    const recurring = tasks.createTask({ title: 'Legacy recurring', scheduleType: 'recurring', recurrenceRule: {
        frequency: 'daily', startDate: '2026-10-20', startTime: '09:00', endTime: '10:00', timeZone: 'UTC', weekdays: [],
    } });
    const oneTime = single('Legacy precise', '2026-10-21T10:00Z', '2026-10-21T11:00Z');
    const sql = database.getDatabase().$client;
    const legacyRule = { ...recurring.recurrenceRule, startTime: '09:03', endTime: '10:33' };
    sql.prepare('UPDATE tasks SET recurrence_rule=?,scheduled_start_at=scheduled_start_at+180000,scheduled_end_at=scheduled_end_at+1980000 WHERE id=?').run(JSON.stringify(legacyRule), recurring.id);
    sql.prepare('UPDATE tasks SET scheduled_start_at=scheduled_start_at+123,scheduled_end_at=scheduled_end_at+456 WHERE id=?').run(oneTime.id);
    const beforeTasks = sql.prepare('SELECT * FROM tasks ORDER BY id').all();
    const beforeOccurrences = sql.prepare('SELECT * FROM task_occurrences ORDER BY id').all();
    assert.deepEqual(settings.updatePlanningHours(hours), hours);
    assert.deepEqual(sql.prepare('SELECT * FROM tasks ORDER BY id').all(), beforeTasks);
    assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences ORDER BY id').all(), beforeOccurrences);
    assert.doesNotThrow(() => settings.updatePlanningHours({ wakeTime: '09:05', sleepTime: '22:00' }));
    assert.doesNotThrow(() => settings.updatePlanningHours({ wakeTime: '08:00', sleepTime: '11:00' }));
    assert.deepEqual(settings.getPlanningHours(), { wakeTime: '08:00', sleepTime: '11:00' });
});

test('new recurring plans allow seasonal wall ranges outside preferred display hours', () => {
    settings.updatePlanningHours({ wakeTime: '01:00', sleepTime: '03:00' });
    assert.doesNotThrow(() => tasks.createTask({ title: 'Seasonal create', scheduleType: 'recurring', recurrenceRule: {
        frequency: 'daily', startDate: '2026-10-20', startTime: '01:30', endTime: '02:30', timeZone: 'America/Los_Angeles', weekdays: [],
    } }));
    assert.equal(tasks.getAllTasks().length, 1);
});

test('changing recurrence outside preferred hours preserves existing actual history and exclusions', () => {
    settings.updatePlanningHours({ wakeTime: '01:00', sleepTime: '03:00' });
    const input = { title: 'Seasonal update', scheduleType: 'recurring', recurrenceRule: {
        frequency: 'daily', startDate: '2026-10-20', startTime: '01:30', endTime: '02:00', timeZone: 'America/Los_Angeles', weekdays: [],
    } };
    const task = tasks.createTask(input);
    tasks.updateOccurrenceTimes({ taskId: task.id, occurrenceId: task.currentOccurrence.id, startedAt: now - 12345, endedAt: now - 123 });
    const sql = database.getDatabase().$client;
    sql.prepare('INSERT INTO recurrence_exclusions (task_id,scheduled_start_at,scheduled_end_at,created_at) VALUES (?,?,?,?)')
        .run(task.id, Date.parse('2027-03-14T09:30Z'), Date.parse('2027-03-14T10:30Z'), now);
    const before = { tasks: sql.prepare('SELECT * FROM tasks').all(), occurrences: sql.prepare('SELECT * FROM task_occurrences').all(), exclusions: sql.prepare('SELECT * FROM recurrence_exclusions').all() };
    assert.doesNotThrow(() => tasks.updateTask(task.id, { ...input, recurrenceRule: { ...input.recurrenceRule, endTime: '02:30' } }));
    for (const row of before.occurrences.filter(row => row.recorded_at != null)) assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(row.id), row);
    assert.deepEqual(sql.prepare('SELECT * FROM recurrence_exclusions').all(), before.exclusions);
});
