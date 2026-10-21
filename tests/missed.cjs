const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const tasks = require('../electron/services/taskService.ts');
const settings = require('../electron/services/settingsService.ts');
const reminders = require('../electron/services/reminderService.ts');
const { occurrenceState } = require('../shared/occurrenceLifecycle.ts');
const T = Date.parse('2026-10-21T14:00Z'), M = 60000;
let now;
beforeEach(() => { now = T - M; mock.method(Date, 'now', () => now); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });
function add(duration = 60) { return tasks.createTask({ title: 'Study', category: 'study', enabled: true, scheduleType: 'one-time', scheduledStartAt: T, scheduledEndAt: T + duration * M, timeZone: 'UTC' }); }
const target = task => ({ taskId: task.id, occurrenceId: task.currentOccurrence.id });

test('Missed follows planned end strictly, while actual progress and legacy completion take precedence', () => {
    const row = add().currentOccurrence;
    assert.equal(occurrenceState(row, T + 60 * M), 'planned');
    assert.equal(occurrenceState(row, T + 60 * M + 1), 'missed');
    assert.equal(occurrenceState({ ...row, startedAt: T }, T + 100 * M), 'in-progress');
    assert.equal(occurrenceState({ ...row, endedAt: T }, T + 100 * M), 'completed');
    assert.equal(occurrenceState({ ...row, legacyCompleted: true }, T + 100 * M), 'completed');
});

test('Missed cannot normally start/end/reset, but historical correction remains available', () => {
    const task = add(); now = T + 61 * M;
    assert.throws(() => tasks.startOccurrence(target(task)), /missed/i);
    assert.throws(() => tasks.endOccurrence(target(task)), /start|missed/i);
    assert.throws(() => tasks.updateOccurrenceTimes({ ...target(task), startedAt: null, endedAt: null }), /missed/i);
    const corrected = tasks.updateOccurrenceTimes({ ...target(task), startedAt: T, endedAt: T + 30 * M });
    assert.equal(occurrenceState(corrected), 'completed');
    assert.equal(tasks.getAllTasks().length, 1);
});

test('Late Start creates a fresh immediately running Task with rounded local plan and unchanged original', () => {
    const task = add(), original = task.currentOccurrence;
    now = T - 5 * M;
    const slot = reminders.getDueReminders()[0];
    assert.ok(reminders.claimReminder(slot)); reminders.markReminderSent(slot);
    now = T + 77 * M + 1234;
    const late = tasks.lateStartOccurrence(target(task), 'UTC');
    assert.notEqual(late.id, task.id);
    assert.equal(late.scheduleType, 'one-time');
    assert.equal(late.category, 'study');
    assert.equal(late.scheduledStartAt, T + 75 * M);
    assert.equal(late.scheduledEndAt, T + 135 * M);
    assert.equal(late.currentOccurrence.startedAt, now);
    assert.equal(occurrenceState(late.currentOccurrence), 'in-progress');
    assert.deepEqual(tasks.listOccurrences(task.id, T, T + 1)[0], original);
    assert.equal(occurrenceState(original), 'missed');
    assert.equal(db.getDatabase().$client.prepare('SELECT count(*) AS n FROM occurrence_reminder_slots WHERE occurrence_id=?').get(late.currentOccurrence.id).n, 0);
    assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots WHERE occurrence_id=?').get(original.id).state, 'sent');
});

test('Missed cards retain planned geometry, subdued-red state hook and only open-details action', () => {
    const task = add(); now = T + 77 * M;
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const Week = require('../src/components/WeekSchedule.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Week, { from: Date.parse('2026-10-19T00:00Z'), ...tasks.getWeekSchedule(Date.parse('2026-10-19T00:00Z'), Date.parse('2026-10-26T00:00Z')), now, timeZone: 'UTC', filter: 'all', planningHours: { wakeTime: '16:00', sleepTime: '20:00' }, onSelect() {}, onChange: async () => {} }));
    assert.match(html, /data-state="missed"/);
    assert.match(html, /Open details Study/);
    assert.doesNotMatch(html, /aria-label="Start Study"|aria-label="Reset Study"/);
    assert.match(html, /data-planning-start="840"/);
    assert.match(html, /14:00–15:00/);
    assert.match(require('node:fs').readFileSync('src/index.css', 'utf8'), /data-state='missed'.*--card-bg: #f5eded/);
    const Details = require('../src/components/TaskDetails.tsx').default;
    const props = { task, now, revision: 0, onChange: async () => {}, onBusyChange() {}, onClose() {} };
    const today = renderToStaticMarkup(React.createElement(Details, props));
    // Use the runtime local date, just as the production UI does.
    const { canLateStart } = require('../shared/occurrenceLifecycle.ts');
    assert.equal(today.includes('>Start late</button>'), canLateStart(T, now, Intl.DateTimeFormat().resolvedOptions().timeZone));
    const yesterday = renderToStaticMarkup(React.createElement(Details, { ...props, now: now + 86400000 }));
    assert.doesNotMatch(yesterday, />Start late<\/button>/);
});

test('recurring Late Start preserves parent recurrence/history/exclusions and manual correction stays separate', () => {
    const task = tasks.createTask({ title: 'Recurring', category: 'work', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-21', startTime: '14:00', endTime: '15:00', timeZone: 'UTC', weekdays: [] } });
    const sql = db.getDatabase().$client;
    const snapshot = sql.prepare('SELECT * FROM task_occurrences WHERE task_id=?').all(task.id);
    now = T + 77 * M;
    const late = tasks.lateStartOccurrence(target(task), 'UTC');
    assert.equal(late.category, 'work');
    assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences WHERE task_id=?').all(task.id), snapshot);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM recurrence_exclusions').get().n, 0);
    assert.deepEqual(tasks.getAllTasks().find(row => row.id === task.id).recurrenceRule, task.recurrenceRule);
    const corrected = tasks.correctOccurrenceTimes({ ...target(task), startedAt: T, endedAt: T + 30 * M });
    assert.equal(occurrenceState(corrected), 'completed');
    assert.equal(tasks.getAllTasks().length, 3, 'only existing correction detachment creates another task');
    assert.equal(corrected.scheduledStartAt, T);
    assert.equal(corrected.startedAt, T);
    assert.equal(corrected.endedAt, T + 30 * M);
});

test('Late Start rounds within the current offset during a repeated local hour', () => {
    now = Date.parse('2026-11-01T06:00Z');
    const task = tasks.createTask({ title: 'DST night', scheduleType: 'one-time', scheduledStartAt: Date.parse('2026-11-01T07:00Z'), scheduledEndAt: Date.parse('2026-11-01T07:30Z'), timeZone: 'America/Los_Angeles' });
    now = Date.parse('2026-11-01T09:17Z');
    const late = tasks.lateStartOccurrence(target(task), 'America/Los_Angeles');
    assert.equal(late.scheduledStartAt, Date.parse('2026-11-01T09:15Z'));
    assert.equal(late.scheduledEndAt - late.scheduledStartAt, 30 * M);
    assert.equal(late.currentOccurrence.startedAt, now);
});

test('Late Start rolls back the new Task if its initial running occurrence cannot be inserted', () => {
    const task = add(); now = T + 77 * M;
    const sql = db.getDatabase().$client;
    sql.exec("CREATE TEMP TRIGGER fail_running_insert BEFORE INSERT ON task_occurrences WHEN NEW.started_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'simulated failure'); END");
    assert.throws(() => tasks.lateStartOccurrence(target(task), 'UTC'), /simulated failure/);
    assert.equal(tasks.getAllTasks().length, 1);
    assert.deepEqual(tasks.listOccurrences(task.id, T, T + 1)[0], task.currentOccurrence);
});

test('Late Start rejects previous local dates and non-Missed occurrences', () => {
    const task = add();
    assert.throws(() => tasks.lateStartOccurrence(target(task), 'UTC'), /missed/i);
    now = T + 86400000;
    assert.throws(() => tasks.lateStartOccurrence(target(task), 'UTC'), /today/i);
    assert.equal(tasks.getAllTasks().length, 1);
});

test('Wake/Sleep never constrain saving, editing or Late Start; full duration can cross midnight', () => {
    const task = add(); settings.updatePlanningHours({ wakeTime: '09:00', sleepTime: '15:00' });
    now = Date.parse('2026-10-21T23:42Z');
    const late = tasks.lateStartOccurrence(target(task), 'UTC');
    assert.equal(late.scheduledStartAt, Date.parse('2026-10-21T23:40Z'));
    assert.equal(late.scheduledEndAt, Date.parse('2026-10-22T00:40Z'));
    const future = tasks.createTask({ title: 'Early', scheduleType: 'one-time', scheduledStartAt: Date.parse('2026-10-22T05:00Z'), scheduledEndAt: Date.parse('2026-10-22T06:00Z'), timeZone: 'UTC' });
    assert.ok(future.id);
    assert.deepEqual(settings.updatePlanningHours({ wakeTime: '12:00', sleepTime: '13:00' }), { wakeTime: '12:00', sleepTime: '13:00' });
});

test('Missed list contains only Missed, newest first, and reminders stop at the end', () => {
    const short = add(5), longer = add(10), future = add(60); now = T + 4 * M;
    assert.equal(reminders.getDueReminders().length, 3);
    now = T + 6 * M;
    assert.equal(reminders.getDueReminders().some(row => row.taskId === short.id), false);
    assert.deepEqual(tasks.getMissedTasks().occurrences.map(row => row.taskId), [short.id]);
    now = T + 11 * M;
    assert.deepEqual(tasks.getMissedTasks().occurrences.map(row => row.taskId), [longer.id, short.id]);
    tasks.startOccurrence(target(future));
    assert.equal(tasks.getMissedTasks().occurrences.some(row => row.taskId === future.id), false);
});
