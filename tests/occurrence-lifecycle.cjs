const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const tasks = require('../electron/services/taskService.ts');
const T = Date.parse('2026-10-19T20:00Z');
const minute = 60000;
const setNow = (now) => Date.now.mock.mockImplementation(() => now);
const once = () => tasks.createTask({ title: 'Workout', scheduleType: 'one-time', scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 });
beforeEach(() => { mock.method(Date, 'now', () => T - 10 * minute); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });

test('early start preserves planned time, is idempotent, and end derives duration', () => {
    const task = once();
    const target = { taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 };
    const started = tasks.startOccurrence(target);
    assert.equal(started.startedAt, T - 10 * minute);
    assert.equal(started.scheduledStartAt, T);
    setNow(T - 9 * minute);
    assert.equal(tasks.startOccurrence(target).startedAt, started.startedAt);
    setNow(T + 20 * minute);
    const ended = tasks.endOccurrence(target);
    assert.equal(ended.endedAt, T + 20 * minute);
    const { occurrenceState, occurrenceDuration } = require('../shared/occurrenceLifecycle.ts');
    assert.equal(occurrenceState(ended), 'completed');
    assert.equal(occurrenceDuration(ended), 30 * minute);
    assert.ok(!Object.hasOwn(ended, 'duration'));
    setNow(T + 30 * minute);
    assert.equal(tasks.endOccurrence(target).endedAt, ended.endedAt);
});

test('end before start and invalid time corrections are rejected without adding bogus rows', () => {
    const task = once();
    assert.throws(() => tasks.endOccurrence({ taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 }), /start/i);
    const target = { taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 };
    assert.throws(() => tasks.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: T }), /start/i);
    assert.throws(() => tasks.updateOccurrenceTimes({ ...target, startedAt: T, endedAt: T - 1 }), /end|earlier/i);
    assert.equal(tasks.listOccurrences(task.id, T, T + 1)[0].recordedAt, null);
});

test('manual start/end backfill and corrections preserve planned and first record-entry times', () => {
    const task = once();
    const target = { taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 };
    setNow(T + 86400000);
    const original = tasks.updateOccurrenceTimes({ ...target, startedAt: T - minute, endedAt: T + 30 * minute });
    assert.equal(original.progressSource, 'backfill');
    setNow(T + 2 * 86400000);
    const corrected = tasks.updateOccurrenceTimes({ ...target, startedAt: T - 2 * minute, endedAt: T + 20 * minute });
    assert.equal(corrected.progressSource, 'corrected');
    assert.equal(corrected.recordedAt, original.recordedAt);
    assert.equal(corrected.scheduledStartAt, T);
    const cleared = tasks.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
    assert.equal(cleared.startedAt, null);
    assert.equal(cleared.endedAt, null);
    assert.equal(cleared.recordedAt, original.recordedAt);
});

test('pre/start reminders use only latest slot, stop after early start, and expire after final thirty-second window', () => {
    const reminders = require('../electron/services/reminderService.ts');
    const task = once();
    setNow(T - 6 * minute); assert.deepEqual(reminders.getDueReminders(), []);
    for (const offset of [-5, 0, 3, 6, 9, 12, 15]) {
        setNow(T + offset * minute);
        const jobs = reminders.getDueReminders();
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].slot, offset);
        assert.equal(reminders.claimReminder(jobs[0]), true);
        assert.equal(reminders.claimReminder(jobs[0]), false);
        reminders.markReminderSent(jobs[0]);
        assert.deepEqual(reminders.getDueReminders(), []);
    }
    setNow(T + 15 * minute + 30000); assert.deepEqual(reminders.getDueReminders(), []);
    tasks.startOccurrence({ taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 });
    assert.deepEqual(reminders.getDueReminders(), []);
    const early = tasks.createTask({ title: 'Early', scheduleType: 'one-time', scheduledStartAt: T + 86400000, scheduledEndAt: (T + 86400000) + 30 * 60000 });
    tasks.startOccurrence({ taskId: early.id, scheduledStartAt: early.scheduledStartAt, scheduledEndAt: early.scheduledEndAt });
    for (const offset of [-5, 0, 3, 15]) { setNow(early.scheduledStartAt + offset * minute); assert.deepEqual(reminders.getDueReminders(), []); }
});

test('failed slots retry within their window; starting stops subsequent reminders and stale jobs', () => {
    const reminders = require('../electron/services/reminderService.ts');
    const task = once();
    setNow(T);
    const job = reminders.getDueReminders()[0];
    assert.equal(reminders.claimReminder(job), true);
    reminders.markReminderFailed(job);
    setNow(T + minute);
    assert.equal(reminders.getDueReminders()[0].slot, 0);
    assert.equal(reminders.claimReminder(job), true);
    reminders.markReminderSent(job);
    tasks.startOccurrence({ taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 });
    for (const offset of [3, 6, 9, 12, 15]) { setNow(T + offset * minute); assert.deepEqual(reminders.getDueReminders(), []); }
    assert.equal(reminders.claimReminder(job), false);
});

test('offline return picks one latest slot, never a backlog or stale old-rule occurrence', () => {
    const reminders = require('../electron/services/reminderService.ts');
    const task = once();
    setNow(T + 10 * minute);
    const jobs = reminders.getDueReminders();
    assert.deepEqual(jobs.map((job) => job.slot), [9]);
    reminders.claimReminder(jobs[0]); reminders.markReminderSent(jobs[0]);
    assert.deepEqual(reminders.getDueReminders(), []);
    setNow(T + 15 * minute + 29999); assert.equal(reminders.getDueReminders()[0].slot, 15);
    setNow(T + 16 * minute); assert.deepEqual(reminders.getDueReminders(), []);
    setNow(T + 5 * 86400000); assert.deepEqual(reminders.getDueReminders(), []);
    tasks.setTaskEnabled(task.id, false);
});

test('successful and ambiguous in-flight slots survive restart without being replayed', () => {
    const reminders = require('../electron/services/reminderService.ts');
    db.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slot-restart-'));
    try {
        const file = path.join(directory, 'data.db');
        db.initializeDatabase(file, path.resolve('drizzle'));
        once(); setNow(T);
        const sent = reminders.getDueReminders()[0]; reminders.claimReminder(sent); reminders.markReminderSent(sent);
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle')); reminders.recoverInterruptedReminders();
        assert.deepEqual(reminders.getDueReminders(), []);
        setNow(T + 3 * minute);
        const ambiguous = reminders.getDueReminders()[0]; reminders.claimReminder(ambiguous);
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle')); reminders.recoverInterruptedReminders();
        assert.deepEqual(reminders.getDueReminders(), []);
        const rows = db.getDatabase().$client.prepare('SELECT slot, state, attempt_count FROM occurrence_reminder_slots ORDER BY slot').all();
        assert.deepEqual(rows, [{ slot: 0, state: 'sent', attempt_count: 1 }, { slot: 3, state: 'unknown', attempt_count: 1 }]);
    } finally { db.closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); }
});

function schedulerHarness() {
    const vm = require('node:vm');
    const ts = require('typescript');
    const { EventEmitter } = require('node:events');
    const notifications = [];
    let tick, intervals = 0, cleared = 0;
    class Notification extends EventEmitter {
        static isSupported() { return true; }
        constructor(options) { super(); this.options = options; notifications.push(this); }
        show() {}
        close() { this.closed = true; }
    }
    const exports = {};
    const filename = path.resolve('electron/scheduler/taskScheduler.ts');
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    }).outputText, { exports,
        require: (name) => name === 'electron' ? { Notification } : require(name.endsWith('reminderPolicy') ? '../electron/services/reminderPolicy.ts' : '../electron/services/reminderService.ts'),
        setInterval: (fn, delay) => { assert.equal(delay, 30000); tick = fn; intervals++; return 1; },
        clearInterval: () => cleared++, console: { error() {} },
    }, { filename });
    return { ...exports, notifications, tick: () => tick(), counts: () => ({ intervals, cleared }) };
}

test('native scheduler reserves once, retries failures, ignores late events and cleans up its single timer', () => {
    const task = once(); setNow(T);
    const scheduler = schedulerHarness();
    try {
        scheduler.startTaskScheduler(); scheduler.startTaskScheduler();
        assert.equal(scheduler.counts().intervals, 1);
        assert.equal(scheduler.notifications.length, 1);
        const first = scheduler.notifications[0];
        assert.equal(first.options.body, 'Time to start: Workout');
        const staleShow = first.listeners('show')[0];
        scheduler.tick(); assert.equal(scheduler.notifications.length, 1);
        first.emit('failed', {}, 'OS failure');
        scheduler.tick(); assert.equal(scheduler.notifications.length, 2);
        staleShow();
        assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots').get().state, 'sending');
        scheduler.notifications[1].emit('show'); scheduler.tick();
        assert.equal(scheduler.notifications.length, 2);
        setNow(T + 3 * minute); scheduler.tick();
        assert.equal(scheduler.notifications.length, 3);
        tasks.startOccurrence({ taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 }); scheduler.tick();
        assert.equal(scheduler.notifications[2].closed, true);
        assert.equal(scheduler.notifications[2].listenerCount('show'), 0);
        setNow(T + 6 * minute); scheduler.tick(); assert.equal(scheduler.notifications.length, 3);
    } finally { scheduler.stopTaskScheduler(); }
    assert.equal(scheduler.counts().cleared, 1);
});

test('native scheduler closes in-flight notifications on shutdown and does not replay them on restart', () => {
    once(); setNow(T - 5 * minute);
    const scheduler = schedulerHarness();
    scheduler.startTaskScheduler();
    assert.equal(scheduler.notifications[0].options.body, 'Upcoming in 5 minutes: Workout');
    scheduler.stopTaskScheduler();
    assert.equal(scheduler.notifications[0].closed, true);
    assert.equal(scheduler.notifications[0].listenerCount('show'), 0);
    scheduler.startTaskScheduler();
    assert.equal(scheduler.notifications.length, 1);
    assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots').get().state, 'unknown');
    scheduler.stopTaskScheduler();
});

test('clearing actual times never reopens a successfully delivered reminder slot', () => {
    const reminders = require('../electron/services/reminderService.ts');
    const task = once(); setNow(T);
    const job = reminders.getDueReminders()[0]; reminders.claimReminder(job); reminders.markReminderSent(job);
    const target = { taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 };
    tasks.startOccurrence(target);
    tasks.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
    assert.deepEqual(reminders.getDueReminders(), []);
    setNow(T + 3 * minute);
    assert.equal(reminders.getDueReminders()[0].slot, 3);
});

test('disabled, deleted and retained old-rule occurrences cannot deliver reminders', () => {
    const reminders = require('../electron/services/reminderService.ts');
    const task = tasks.createTask({ title: 'Daily', scheduleType: 'recurring', recurrenceRule: {
        frequency: 'daily', startTime: '20:00', endTime: '20:30', timeZone: 'UTC', startDate: '2026-10-19', weekdays: [],
    } });
    setNow(T - 5 * minute);
    const job = reminders.getDueReminders()[0]; reminders.claimReminder(job); reminders.markReminderSent(job);
    tasks.updateTask(task.id, { title: 'Daily', scheduleType: 'recurring', recurrenceRule: {
        frequency: 'daily', startTime: '21:00', endTime: '21:30', timeZone: 'UTC', startDate: '2026-10-19', weekdays: [],
    } });
    setNow(T);
    assert.deepEqual(reminders.getDueReminders(), []);
    assert.ok(tasks.listOccurrences(task.id, T, T + 1).length, 'old reminder record remains historical');
    const single = once(); tasks.setTaskEnabled(single.id, false);
    assert.deepEqual(reminders.getDueReminders(), []);
    tasks.setTaskEnabled(single.id, true); assert.equal(reminders.getDueReminders().length, 1);
    tasks.deleteTask(single.id); assert.deepEqual(reminders.getDueReminders(), []);
});

test('a started one-time task allows planned time correction while locking the schedule type', () => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const TaskForm = require('../src/components/TaskForm.tsx').default;
    const task = once(); tasks.startOccurrence({ taskId: task.id, scheduledStartAt: T, scheduledEndAt: (T) + 30 * 60000 });
    const current = tasks.getAllTasks()[0];
    const markup = renderToStaticMarkup(React.createElement(TaskForm, { task: current, onSave: async () => {}, onCancel() {} }));
    assert.doesNotMatch(markup, /<fieldset disabled="" class="schedule-fields">/);
    assert.match(markup, /aria-label="Schedule type" disabled=""/);
    const corrected = tasks.updateTask(task.id, { title: task.title, scheduleType: 'one-time', scheduledStartAt: T + 5 * minute, scheduledEndAt: T + 35 * minute });
    assert.equal(corrected.currentOccurrence.id, current.currentOccurrence.id);
    assert.equal(corrected.currentOccurrence.startedAt, current.currentOccurrence.startedAt);
});
