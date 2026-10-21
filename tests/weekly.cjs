const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
require('./register-typescript.cjs');
const database = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const createBeforeStart = require('./create-before-start.cjs');
const { occurrenceState, occurrenceDuration } = require('../shared/occurrenceLifecycle.ts');
const finish = (target) => service.updateOccurrenceTimes({ ...target, startedAt: Date.now(), endedAt: Date.now() });
const now = Date.parse('2026-10-19T18:00Z');
const from = Date.parse('2026-10-19T00:00Z');
const to = Date.parse('2026-10-26T00:00Z');
const daily = (changes = {}) => ({ title: 'Practice', scheduleType: 'recurring', enabled: false, recurrenceRule: {
    frequency: 'daily', startDate: '2026-10-17', startTime: '09:00', endTime: '09:30', timeZone: 'UTC', weekdays: [], ...changes,
} });
beforeEach(() => { mock.method(Date, 'now', () => now); database.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { database.closeDatabase(); mock.restoreAll(); });

test('week navigation is Monday-first and uses local calendar days across DST', () => {
    const { weekRange, shiftWeek, weekDays } = require('../shared/scheduling/week.ts');
    const range = weekRange(Date.parse('2026-11-01T17:00Z'), 'America/Los_Angeles');
    assert.equal(range.from, Date.parse('2026-10-26T07:00Z'));
    assert.equal(range.to, Date.parse('2026-11-02T08:00Z'));
    const next = shiftWeek(range.from, 1, 'America/Los_Angeles');
    assert.equal(next, range.to);
    assert.equal(shiftWeek(next, -1, 'America/Los_Angeles'), range.from);
    assert.deepEqual(weekDays(range.from, 'America/Los_Angeles').map((day) => day.date), ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
});

test('one-time cards fall on the viewer local day, including a different saved zone', () => {
    const { dayKey } = require('../shared/scheduling/week.ts');
    const task = service.createTask({ title: 'Bill', scheduleType: 'one-time', scheduledStartAt: Date.parse('2026-10-22T01:00Z'), scheduledEndAt: (Date.parse('2026-10-22T01:00Z')) + 30 * 60000 });
    const week = service.getWeekSchedule(from, to);
    assert.equal(week.occurrences.length, 1);
    assert.equal(week.occurrences[0].taskId, task.id);
    assert.equal(dayKey(week.occurrences[0].scheduledStartAt, 'America/Los_Angeles'), '2026-10-21');
});

test('daily and selected weekly rules derive bounded weeks and merge one occurrence completion', () => {
    const task = service.createTask(daily());
    service.createTask({ ...daily({ frequency: 'weekly', weekdays: [1, 3, 5] }), title: 'Workout' });
    finish({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    const week = service.getWeekSchedule(from, to);
    const dailyRows = week.occurrences.filter((row) => row.taskId === task.id);
    assert.equal(dailyRows.length, 7);
    assert.equal(week.occurrences.length, 10);
    assert.equal(dailyRows.filter((row) => row.record?.recordedAt !== null && row.record?.recordedAt !== undefined).length, 1);
    assert.equal(week.tasks.length, 2, 'recurrence never duplicates task records');
});

test('browsing distant weeks does not materialize them; virtual completion validates schedule', () => {
    const task = service.createTask(daily());
    const count = () => database.getDatabase().$client.prepare('SELECT count(*) AS n FROM task_occurrences').get().n;
    const initial = count();
    const distant = Date.parse('2040-01-02T00:00Z');
    const week = service.getWeekSchedule(distant, distant + 7 * 86400000);
    assert.equal(week.occurrences.length, 7);
    assert.equal(count(), initial);
    assert.equal(week.occurrences[0].record, null);
    const result = finish({ taskId: task.id, scheduledStartAt: week.occurrences[0].scheduledStartAt, scheduledEndAt: (week.occurrences[0].scheduledStartAt) + 30 * 60000 });
    assert.ok(result.recordedAt !== null);
    assert.equal(count(), initial + 1);
    assert.throws(() => finish({ taskId: task.id, scheduledStartAt: distant + 12345, scheduledEndAt: (distant + 12345) + 30 * 60000 }), /occurrence|schedule/i);
    assert.throws(() => service.getWeekSchedule(from, from + 30 * 86400000), /week|range/i);
});

test('schedule editing preserves old expectations, backfills and meaningful future rows', () => {
    const task = service.createTask(daily());
    const old = service.listOccurrences(task.id, from - 2 * 86400000, from)[0];
    const saved = service.updateOccurrenceTimes({ taskId: task.id, occurrenceId: old.id, startedAt: old.scheduledStartAt, endedAt: old.scheduledStartAt + 1000 });
    const futureTime = Date.parse('2026-10-21T09:00Z');
    const early = service.startOccurrence({ taskId: task.id, scheduledStartAt: futureTime, scheduledEndAt: (futureTime) + 30 * 60000 });
    assert.equal(occurrenceState(early), 'in-progress');
    service.updateTask(task.id, { ...daily({ startTime: '10:00', endTime: '10:30', frequency: 'weekly', weekdays: [2, 4] }), title: 'Changed', enabled: true });
    const history = service.listOccurrences(task.id, from - 2 * 86400000, to);
    assert.deepEqual(history.find((row) => row.id === saved.id), saved);
    assert.deepEqual(history.find((row) => row.id === early.id), early);
    assert.ok(history.some((row) => row.scheduledStartAt === Date.parse('2026-10-19T09:00Z')), 'missed past expectation stays');
    assert.ok(!history.some((row) => row.scheduledStartAt === Date.parse('2026-10-20T09:00Z')), 'untouched future old rule is replaced');
    const week = service.getWeekSchedule(from, to);
    assert.ok(week.occurrences.some((row) => row.scheduledStartAt === Date.parse('2026-10-20T10:00Z')));
    assert.ok(!week.occurrences.some((row) => row.scheduledStartAt === Date.parse('2026-10-18T10:00Z')));
    assert.equal(week.tasks[0].title, 'Changed');
    assert.equal(week.tasks[0].enabled, true);
    assert.ok(!week.occurrences.some((row) => row.scheduledStartAt === early.scheduledStartAt), 'retained started old-rule occurrence is history-only');
    assert.throws(() => finish({ taskId: task.id, scheduledStartAt: Date.parse('2026-10-20T09:00Z'), scheduledEndAt: (Date.parse('2026-10-20T09:00Z')) + 30 * 60000 }), /occurrence|schedule/i);
});

test('editing daily time after completion shows only the new time and preserves old completion in history', () => {
    const task = service.createTask(daily({ startTime: '20:00', endTime: '20:30' }));
    const oldTime = Date.parse('2026-10-19T20:00Z');
    const completed = finish({ taskId: task.id, scheduledStartAt: oldTime, scheduledEndAt: (oldTime) + 30 * 60000 });
    service.updateTask(task.id, daily({ startTime: '21:00', endTime: '21:30' }));
    const week = service.getWeekSchedule(from, to);
    assert.deepEqual(week.occurrences.map((row) => row.scheduledStartAt), [19, 20, 21, 22, 23, 24, 25].map((day) => Date.parse(`2026-10-${day}T21:00Z`)));
    assert.equal(new Set(week.occurrences.map((row) => `${row.taskId}:${row.scheduledStartAt}`)).size, 7);
    assert.ok(week.occurrences.every((row) => row.record?.recordedAt == null), 'old completion must not mark the new time complete');
    assert.deepEqual(service.listOccurrences(task.id, oldTime, oldTime + 1)[0], completed);
});

test('editing weekdays after completion removes old-day active cards but keeps their history editable', () => {
    const task = service.createTask(daily({ frequency: 'weekly', weekdays: [1, 3, 5], startTime: '20:00', endTime: '20:30' }));
    const oldTime = Date.parse('2026-10-19T20:00Z');
    const completed = service.updateOccurrenceTimes({ taskId: task.id, scheduledStartAt: oldTime, scheduledEndAt: (oldTime) + 30 * 60000, startedAt: oldTime - 60000, endedAt: oldTime - 1000 });
    service.updateTask(task.id, daily({ frequency: 'weekly', weekdays: [2, 4], startTime: '20:00', endTime: '20:30' }));
    const times = () => service.getWeekSchedule(from, to).occurrences.map((row) => row.scheduledStartAt);
    assert.deepEqual(times(), [Date.parse('2026-10-20T20:00Z'), Date.parse('2026-10-22T20:00Z')]);
    assert.deepEqual(service.listOccurrences(task.id, oldTime, oldTime + 1)[0], completed);
    const corrected = service.updateOccurrenceTimes({ taskId: task.id, occurrenceId: completed.id, startedAt: oldTime - 60000, endedAt: oldTime - 2000 });
    assert.equal(corrected.progressSource, 'corrected');
    assert.equal(corrected.recordedAt, completed.recordedAt);
    assert.deepEqual(times(), [Date.parse('2026-10-20T20:00Z'), Date.parse('2026-10-22T20:00Z')], 'editing retained history must not restore old cards');
});

test('schedule edits clean stale uncompleted future rows and merge only matching current state', () => {
    const task = service.createTask(daily({ startTime: '20:00', endTime: '20:30' }));
    const staleTime = Date.parse('2026-10-19T20:00Z');
    assert.ok(service.listOccurrences(task.id, staleTime, staleTime + 1).length === 1);
    service.updateTask(task.id, daily({ startTime: '21:00', endTime: '21:30' }));
    assert.deepEqual(service.listOccurrences(task.id, staleTime, staleTime + 1), [], 'pristine stale rows are deleted, not merely hidden');
    const currentTime = Date.parse('2026-10-19T21:00Z');
    const completed = finish({ taskId: task.id, scheduledStartAt: currentTime, scheduledEndAt: (currentTime) + 30 * 60000 });
    const week = service.getWeekSchedule(from, to);
    const todayRows = week.occurrences.filter((row) => row.scheduledStartAt < from + 86400000);
    assert.equal(todayRows.length, 1);
    assert.equal(todayRows[0].record.id, completed.id);
    assert.equal(todayRows[0].record.recordedAt, now);
});

test('weekly projection never inserts unmatched historical or stale records as active cards', () => {
    const { deriveOccurrences } = require('../shared/scheduling/week.ts');
    const task = service.createTask(daily({ startTime: '20:00', endTime: '20:30' }));
    const records = service.listOccurrences(task.id, from, to);
    const changed = { ...task, recurrenceRule: { ...task.recurrenceRule, startTime: '21:00', endTime: '21:30' } };
    const active = deriveOccurrences(changed, from, to, records);
    assert.equal(active.length, 7);
    assert.ok(active.every((row) => new Date(row.scheduledStartAt).getUTCHours() === 21));
    assert.ok(active.every((row) => row.record === null));
});

test('editing after downtime freezes the old rule through cutover; invalid edits change nothing', () => {
    const task = service.createTask(daily());
    Date.now.mock.mockImplementation(() => Date.parse('2026-12-19T18:00Z'));
    assert.throws(() => service.updateTask(task.id, daily({ frequency: 'weekly', weekdays: [] })), /weekday/i);
    service.updateTask(task.id, daily({ startTime: '10:00', endTime: '10:30' }));
    const history = service.listOccurrences(task.id, Date.parse('2026-12-01T00:00Z'), Date.parse('2026-12-20T00:00Z'));
    assert.equal(history.length, 19);
    assert.ok(history.every((row) => new Date(row.scheduledStartAt).getUTCHours() === 9));
    const future = service.getWeekSchedule(Date.parse('2026-12-21T00:00Z'), Date.parse('2026-12-28T00:00Z'));
    assert.ok(future.occurrences.every((row) => new Date(row.scheduledStartAt).getUTCHours() === 10));
});

test('completed one-time retains its history and allows metadata edits but cannot become recurring', () => {
    const task = createBeforeStart(service, { title: 'Done', scheduleType: 'one-time', scheduledStartAt: now - 5 * 60000, scheduledEndAt: now + 25 * 60000 });
    const completed = finish({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    const updated = service.updateTask(task.id, { title: 'Renamed', scheduleType: 'one-time', scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt, enabled: false });
    assert.equal(updated.title, 'Renamed');
    assert.equal(updated.enabled, false);
    assert.equal(updated.currentOccurrence.id, completed.id);
    assert.throws(() => service.updateTask(task.id, daily()), /one-time.*schedule|completed one-time|progress/i);
});

test('converted one-time task uses its own completion rather than historical recurring rows', () => {
    const task = service.createTask(daily());
    const scheduledStartAt = now + 86400000;
    service.updateTask(task.id, { title: 'Once', scheduleType: 'one-time', scheduledStartAt, scheduledEndAt: scheduledStartAt + 30 * 60000 });
    const completed = finish({ taskId: task.id, scheduledStartAt, scheduledEndAt: scheduledStartAt + 30 * 60000 });
    const current = service.getAllTasks()[0].currentOccurrence;
    assert.equal(current.id, completed.id);
    assert.equal(current.recordedAt, now);
});

test('converting recurring to one-time projects only its new expectation and retains backlog history', () => {
    const task = service.createTask({ ...daily(), enabled: true });
    const scheduledStartAt = now + 86400000;
    service.updateTask(task.id, { title: 'Once later', scheduleType: 'one-time', scheduledStartAt, scheduledEndAt: scheduledStartAt + 30 * 60000, enabled: true });
    const week = service.getWeekSchedule(from, to);
    assert.deepEqual(week.occurrences.map((row) => row.scheduledStartAt), [scheduledStartAt]);
    assert.ok(service.listOccurrences(task.id, from - 2 * 86400000, from + 86400000).length >= 3);
});

test('title-only edits do not regenerate dates, and creation honors notification preference', () => {
    const task = service.createTask(daily());
    assert.equal(task.enabled, false);
    const before = service.listOccurrences(task.id, from, to);
    service.updateTask(task.id, { ...daily(), title: 'Renamed' });
    assert.deepEqual(service.listOccurrences(task.id, from, to), before);
});

test('main weekly cards keep imported and completion metadata out of the default view', () => {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const WeekSchedule = require('../src/components/WeekSchedule.tsx').default;
    const task = service.createTask({ title: 'Legacy example', scheduleType: 'one-time', scheduledStartAt: now, scheduledEndAt: (now) + 30 * 60000 });
    const week = service.getWeekSchedule(from, to);
    const markup = renderToStaticMarkup(React.createElement(WeekSchedule, { from, tasks: [{ ...task, origin: 'legacy-task' }],
        occurrences: week.occurrences, now, timeZone: 'UTC', filter: 'all', onChange: async () => {}, onSelect() {} }));
    assert.ok(!markup.includes('Imported'), 'provenance belongs in details, not cards');
    assert.ok(!markup.includes('class="card-actions"'), 'cards use their title to open details');
    assert.match(markup, /aria-label="Start Legacy example"/);
    assert.ok(!/migration|recordedAt|completionSource|notificationState|Unknown|unscheduled|time zone/i.test(markup));
    assert.match(markup, /data-date="2026-10-19"[^>]*aria-current="date"/);
    assert.equal((markup.match(/class="day-column"/g) || []).length, 7);
});

for (const kind of ['one-time', 'recurring']) {
    test(`${kind} cards follow planned, in-progress, completed and corrected lifecycle states`, () => {
        const React = require('react');
        const { renderToStaticMarkup } = require('react-dom/server');
        const WeekSchedule = require('../src/components/WeekSchedule.tsx').default;
        const task = createBeforeStart(service, kind === 'one-time'
            ? { title: 'Lifecycle task', scheduleType: 'one-time', scheduledStartAt: now - 5 * 60000, scheduledEndAt: now + 25 * 60000 }
            : { ...daily({ startTime: '18:00', endTime: '18:30' }), title: 'Lifecycle task' });
        const scheduledStartAt = task.currentOccurrence.scheduledStartAt;
        const target = { taskId: task.id, scheduledStartAt, scheduledEndAt: scheduledStartAt + 30 * 60000 };
        const originalHistory = service.listOccurrences(task.id, from - 2 * 86400000, to);
        function markup() {
            const week = service.getWeekSchedule(from, to);
            return renderToStaticMarkup(React.createElement(WeekSchedule, { from, ...week, now: Date.now(), timeZone: 'UTC', filter: 'all', onChange: async () => {}, onSelect() {} }));
        }
        assert.match(markup(), /aria-label="Start Lifecycle task"/);
        assert.doesNotMatch(markup(), /aria-label="Finish Lifecycle task"/);
        const started = service.startOccurrence(target);
        assert.equal(occurrenceState(started), 'in-progress');
        assert.match(markup(), /aria-label="Finish Lifecycle task"/);
        Date.now.mock.mockImplementation(() => now + 60000);
        const completed = service.endOccurrence(target);
        assert.equal(occurrenceDuration(completed), 60000);
        assert.doesNotMatch(markup(), /aria-label="Finish Lifecycle task"/);
        if (kind === 'one-time') assert.doesNotMatch(markup(), /aria-label="Start Lifecycle task"/);
        Date.now.mock.mockImplementation(() => now + 120000);
        const cleared = service.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
        assert.equal(cleared.startedAt, null);
        assert.equal(cleared.endedAt, null);
        assert.equal(cleared.recordedAt, now, 'first entry survives clearing times');
        assert.equal(cleared.progressSource, 'corrected');
        assert.equal(cleared.scheduledStartAt, scheduledStartAt);
        assert.match(markup(), /aria-label="Start Lifecycle task"/);
        const restarted = service.startOccurrence(target);
        assert.equal(restarted.id, completed.id);
        assert.equal(restarted.startedAt, now + 120000);
        assert.equal(restarted.recordedAt, now);
        const loaded = service.getAllTasks()[0];
        assert.equal(loaded.id, task.id);
        assert.deepEqual(loaded.recurrenceRule, task.recurrenceRule);
        const remainingHistory = service.listOccurrences(task.id, from - 2 * 86400000, to);
        assert.deepEqual(remainingHistory.filter((row) => row.id !== completed.id), originalHistory.filter((row) => row.id !== completed.id));
        if (kind === 'recurring') assert.ok(loaded.nextOccurrenceAt > now);
    });
}

test('0003 upgrades the unified schema and preserves completed history through edit and restart', () => {
    database.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weekly-task-upgrade-'));
    try {
        const oldMigrations = path.join(directory, 'old');
        fs.mkdirSync(path.join(oldMigrations, 'meta'), { recursive: true });
        const journal = JSON.parse(fs.readFileSync(path.resolve('drizzle/meta/_journal.json')));
        journal.entries = journal.entries.slice(0, 3);
        fs.writeFileSync(path.join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal));
        for (const entry of journal.entries) fs.copyFileSync(path.resolve('drizzle', entry.tag + '.sql'), path.join(oldMigrations, entry.tag + '.sql'));
        const filename = path.join(directory, 'data.db');
        database.initializeDatabase(filename, oldMigrations);
        const scheduled = Date.parse('2026-10-17T09:00Z');
        database.getDatabase().$client.prepare('INSERT INTO tasks(id,title,schedule_type,scheduled_at,recurrence_rule,created_at,updated_at,generated_through) VALUES (7,?,?,?,?,?,?,?)')
            .run('Practice', 'recurring', scheduled, JSON.stringify({ frequency: 'daily', startDate: '2026-10-17', time: '09:00', timeZone: 'UTC', weekdays: [] }), now, now, scheduled);
        database.getDatabase().$client.prepare('INSERT INTO task_occurrences(task_id,scheduled_at,completed_at,recorded_at,completion_source,created_at,updated_at) VALUES (7,?,?,?,?,?,?)')
            .run(scheduled, scheduled + 1000, now, 'backfill', now, now);
        database.closeDatabase();
        database.initializeDatabase(filename, path.resolve('drizzle'));
        assert.equal(service.getAllTasks()[0].scheduleEffectiveAt, scheduled);
        const original = service.listOccurrences(7, scheduled, scheduled + 1)[0];
        assert.equal(original.startedAt, null, 'migration does not invent an actual start');
        assert.equal(original.endedAt, scheduled + 1000);
        assert.equal(original.progressSource, 'backfill');
        assert.equal(original.recordedAt, now);
        assert.equal(original.legacyCompleted, false);
        assert.equal(occurrenceState(original), 'completed');
        assert.equal(occurrenceDuration(original), null);
        service.updateTask(7, { ...daily({ startTime: '10:00', endTime: '10:30' }), title: 'Edited upgrade' });
        database.closeDatabase();
        database.initializeDatabase(filename, path.resolve('drizzle'));
        const loaded = service.getWeekSchedule(from, to);
        assert.equal(loaded.tasks[0].title, 'Edited upgrade');
        assert.equal(loaded.tasks[0].scheduleEffectiveAt, now);
        assert.deepEqual(service.listOccurrences(7, scheduled, scheduled + 1)[0], original);
        assert.equal(database.getDatabase().$client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n, JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"))).entries.length);
    } finally {
        database.closeDatabase();
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
