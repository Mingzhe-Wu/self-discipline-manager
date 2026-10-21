const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const createBeforeStart = require('./create-before-start.cjs');
const start = Date.parse('2026-10-19T09:00Z');
const minute = 60000;
const single = (changes = {}) => ({ title: 'Range', scheduleType: 'one-time', scheduledStartAt: start, scheduledEndAt: start + 90 * minute, timeZone: 'UTC', ...changes });
const daily = (changes = {}) => ({ title: 'Daily range', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-19', startTime: '09:00', endTime: '10:30', timeZone: 'UTC', weekdays: [], ...changes } });
beforeEach(() => { mock.method(Date, 'now', () => start - 3600000); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });
test('one-time and recurring planned ranges persist and derive independent actual duration', () => {
    const task = service.createTask(single());
    assert.equal(task.scheduledEndAt, start + 90 * minute);
    assert.equal(task.currentOccurrence.scheduledStartAt, start);
    assert.equal(task.currentOccurrence.scheduledEndAt, task.scheduledEndAt);
    const target = { taskId: task.id, occurrenceId: task.currentOccurrence.id };
    const actual = service.updateOccurrenceTimes({ ...target, startedAt: start + 17 * minute + 123, endedAt: start + 100 * minute + 456 });
    assert.equal(actual.scheduledStartAt, start); assert.equal(actual.scheduledEndAt, task.scheduledEndAt);
    assert.equal(actual.startedAt % 60000, 123); assert.equal(actual.endedAt % 60000, 456);
    const recurring = service.createTask(daily());
    const week = service.getWeekSchedule(start, start + 7 * 86400000);
    const rows = week.occurrences.filter((row) => row.taskId === recurring.id);
    assert.equal(rows.length, 7);
    assert.ok(rows.every((row) => row.scheduledEndAt - row.scheduledStartAt === 90 * minute));
    assert.equal(service.getAllTasks()[1].recurrenceRule.endTime, '10:30');
});
test('planned ranges require five-minute boundaries and a later same-day end', () => {
    for (const input of [single({ scheduledStartAt: start + 3 * minute }), single({ scheduledEndAt: start + 42 * minute }),
        single({ scheduledStartAt: start + 1 }), single({ scheduledEndAt: start }), single({ scheduledEndAt: start - minute }),
        single({ scheduledEndAt: start + 86400000 }), daily({ startTime: '09:03' }), daily({ endTime: '10:42' }),
        daily({ startTime: '23:00', endTime: '01:00' }), daily({ startTime: '09:00', endTime: '09:00' })]) {
        assert.throws(() => service.createTask(input), /five|5.minute|later|same.day|midnight|range/i);
    }
    assert.equal(service.getAllTasks().length, 0);
});
test('end-only schedule edits preserve old meaningful range but project fresh state and reminder identity', () => {
    const task = service.createTask(daily());
    const occurrence = task.currentOccurrence;
    service.updateOccurrenceTimes({ taskId: task.id, occurrenceId: occurrence.id, startedAt: start, endedAt: start + 10 * minute });
    service.updateTask(task.id, daily({ endTime: '11:00' }));
    const visible = service.getWeekSchedule(start, start + 86400000).occurrences;
    assert.equal(visible.length, 1); assert.equal(visible[0].scheduledEndAt, start + 120 * minute);
    assert.equal(visible[0].record?.startedAt ?? null, null);
    const history = service.listOccurrences(task.id, start, start + 1);
    assert.equal(history.find((row) => row.id === occurrence.id).endedAt, start + 10 * minute);
    const fresh = service.startOccurrence({ taskId: task.id, scheduledStartAt: start, scheduledEndAt: start + 120 * minute });
    assert.notEqual(fresh.id, occurrence.id);
});

const layout = require('../src/timetableLayout.ts');
test('timetable chooses actual wall-clock geometry without modifying planned ranges', () => {
    assert.deepEqual(layout.rangeGeometry(9 * 60, 10 * 60 + 30), { top: 1080, height: 180 });
    assert.deepEqual(layout.rangeGeometry(14 * 60 + 15, 16 * 60), { top: 1710, height: 210 });
    assert.deepEqual(layout.rangeGeometry(8 * 60 + 5, 8 * 60 + 10), { top: 970, height: 10 });
    const planned = single();
    const before = layout.splitDisplaySegments(planned, 'UTC');
    const after = layout.splitOccurrenceDisplaySegments({ taskId: 1, ...planned, record: { startedAt: start + 17 * minute, endedAt: start + 142 * minute } }, 'UTC', start);
    assert.equal(after[0].startMinute, 557); assert.equal(after[0].endMinute, 682);
    assert.equal(before[0].startMinute, 540); assert.equal(before[0].endMinute, 630);
});
test('viewer-zone midnight splits visual segments without changing planned identity', () => {
    const segments = layout.splitDisplaySegments({ scheduledStartAt: Date.parse('2026-10-20T06:30Z'), scheduledEndAt: Date.parse('2026-10-20T07:30Z') }, 'America/Los_Angeles');
    assert.deepEqual(segments.map(({ date, startMinute, endMinute }) => ({ date, startMinute, endMinute })), [
        { date: '2026-10-19', startMinute: 1410, endMinute: 1440 }, { date: '2026-10-20', startMinute: 0, endMinute: 30 },
    ]);
});
test('week projection includes a range continued from before its viewer-zone week boundary', () => {
    const task = createBeforeStart(service, single({ scheduledStartAt: Date.parse('2026-10-19T06:30Z'), scheduledEndAt: Date.parse('2026-10-19T07:30Z') }));
    const range = require('../shared/scheduling/week.ts').weekRange(Date.parse('2026-10-19T12:00Z'), 'America/Los_Angeles');
    const week = service.getWeekSchedule(range.from, range.to);
    assert.equal(week.occurrences.filter((row) => row.taskId === task.id).length, 1);
});

test('0005 migrates old point schedules without rounding actual/planned history or replaying sent slots', () => {
    const fs = require('node:fs'); const os = require('node:os');
    db.closeDatabase();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'planned-range-upgrade-'));
    try {
        const folder = path.join(directory, 'old'); fs.mkdirSync(path.join(folder, 'meta'), { recursive: true });
        const journal = JSON.parse(fs.readFileSync(path.resolve('drizzle/meta/_journal.json'))); journal.entries = journal.entries.slice(0, 5);
        fs.writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify(journal));
        for (const entry of journal.entries) fs.copyFileSync(path.resolve('drizzle', entry.tag + '.sql'), path.join(folder, entry.tag + '.sql'));
        const file = path.join(directory, 'data.db'); db.initializeDatabase(file, folder);
        const old = db.getDatabase().$client;
        const oldStart = start + 3 * minute;
        old.prepare(`INSERT INTO tasks (id,title,schedule_type,scheduled_at,schedule_effective_at,recurrence_rule,enabled,created_at,updated_at,generated_through) VALUES (1,'Old recurring','recurring',?,?,?,1,?,?,?)`).run(oldStart, oldStart,
            JSON.stringify({ frequency: 'daily', startDate: '2026-10-19', time: '09:03', timeZone: 'UTC', weekdays: [] }), start, start, start + 14 * 86400000);
        old.prepare(`INSERT INTO task_occurrences (id,task_id,scheduled_at,started_at,ended_at,recorded_at,progress_source,created_at,updated_at) VALUES (1,1,?,?,?,?,'corrected',?,?)`).run(oldStart, start + 17 * minute + 234, start + 65 * minute + 567, start + 86400000, start, start + 86400000);
        old.prepare(`INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state,attempt_count,last_attempt_at,sent_at) VALUES (1,0,'sent',1,?,?)`).run(start, start);
        const foldStart = Date.parse('2026-11-01T08:45Z');
        old.prepare("INSERT INTO tasks (id,title,schedule_type,scheduled_at,schedule_effective_at,recurrence_rule,enabled,created_at,updated_at,generated_through) VALUES (2,'Fold','recurring',?,?,?,1,?,?,?)").run(foldStart, foldStart,
            JSON.stringify({ frequency: 'daily', startDate: '2026-11-01', time: '01:45', timeZone: 'America/Los_Angeles', weekdays: [] }), start, start, foldStart + 14 * 86400000);
        old.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_at,created_at,updated_at) VALUES (2,2,?,?,?)").run(foldStart, start, start);
        old.prepare("INSERT INTO tasks (id,title,schedule_type,scheduled_at,schedule_effective_at,enabled,created_at,updated_at,generated_through) VALUES (3,'Precise old point','one-time',?,?,1,?,?,?)").run(oldStart + 123, oldStart + 123, start, start, oldStart + 123);
        old.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_at,created_at,updated_at) VALUES (3,3,?,?,?)").run(oldStart + 123, start, start);
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle'));
        assert.equal(service.getAllTasks().find((task) => task.id === 3).scheduledStartAt, oldStart + 123);
        const foldOccurrence = db.getDatabase().$client.prepare('SELECT * FROM task_occurrences WHERE id=2').get();
        assert.equal(foldOccurrence.scheduled_end_at, Date.parse('2026-11-01T10:15Z'));
        const foldProjected = service.getWeekSchedule(Date.parse('2026-11-01T07:00Z'), Date.parse('2026-11-02T08:00Z')).occurrences.find((row) => row.taskId === 2);
        assert.equal(foldProjected.record.id, 2);
        Date.now.mock.mockImplementation(() => foldStart - 5 * minute);
        assert.equal(require('../electron/services/reminderService.ts').getDueReminders().find((job) => job.taskId === 2).occurrenceId, 2);
        Date.now.mock.mockImplementation(() => start - 3600000);
        const migrated = service.getAllTasks()[0];
        assert.equal(migrated.scheduledStartAt, oldStart);
        assert.equal(migrated.scheduledEndAt, oldStart + 30 * minute);
        assert.equal(migrated.recurrenceRule.startTime, '09:03'); assert.equal(migrated.recurrenceRule.endTime, '09:33');
        const row = db.getDatabase().$client.prepare('SELECT * FROM task_occurrences WHERE id=1').get();
        assert.equal(row.started_at, start + 17 * minute + 234); assert.equal(row.ended_at, start + 65 * minute + 567);
        assert.equal(row.scheduled_start_at, oldStart); assert.equal(row.scheduled_end_at, oldStart + 30 * minute);
        assert.equal(db.getDatabase().$client.prepare('SELECT state FROM occurrence_reminder_slots WHERE occurrence_id=1').get().state, 'sent');
        service.updateTask(1, { title: 'Renamed legacy', scheduleType: 'recurring', recurrenceRule: migrated.recurrenceRule });
        assert.throws(() => service.createTask({ title: 'Cannot copy unaligned schedule', scheduleType: 'recurring', recurrenceRule: migrated.recurrenceRule }), /five.minute/);
        db.closeDatabase(); db.initializeDatabase(file, path.resolve('drizzle'));
        assert.deepEqual(db.getDatabase().$client.prepare('SELECT * FROM task_occurrences WHERE id=1').get(), row);
        assert.equal(db.getDatabase().$client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n, JSON.parse(fs.readFileSync(path.resolve("drizzle/meta/_journal.json"))).entries.length);
        const { legacyPlannedEnd, legacyRecurrenceRange } = require('../electron/db/migrationRanges.ts');
        const nearMidnight = Date.parse('2026-10-20T06:50Z');
        assert.equal(legacyPlannedEnd(nearMidnight, 'America/Los_Angeles'), Date.parse('2026-10-20T07:00Z') - 1);
        assert.equal(JSON.parse(legacyRecurrenceRange(JSON.stringify({ time: '23:50', timeZone: 'UTC' }))).endTime, '23:59:59.999');
    } finally { db.closeDatabase(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('migrated recurring ranges and generated ranges agree across repeated DST hours', () => {
    const { legacyScheduleEnd } = require('../electron/db/migrationRanges.ts');
    const rule = { frequency: 'daily', startDate: '2026-11-01', time: '01:45', timeZone: 'America/Los_Angeles', weekdays: [] };
    const at = Date.parse('2026-11-01T08:45Z');
    assert.equal(legacyScheduleEnd(at, rule.timeZone, JSON.stringify(rule)), Date.parse('2026-11-01T10:15Z'));
});

test('one-time validation rejects backward local-clock ranges during a repeated DST hour', () => {
    assert.throws(() => service.createTask(single({ scheduledStartAt: Date.parse('2026-11-01T08:45Z'), scheduledEndAt: Date.parse('2026-11-01T09:15Z'), timeZone: 'America/Los_Angeles' })), /later|range/);
});
