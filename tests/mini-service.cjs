const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');
const db = require('../electron/db/database.ts');
const tasks = require('../electron/services/taskService.ts');
const { getMiniToday } = require('../electron/services/miniService.ts');
const { miniSections } = require('../shared/scheduling/miniSchedule.ts');
const createBeforeStart = require('./create-before-start.cjs');
const now = Date.parse('2026-10-21T18:00Z');
beforeEach(() => { mock.method(Date, 'now', () => now); db.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { db.closeDatabase(); mock.restoreAll(); });

test('Today service includes ongoing activity from yesterday but not yesterday missed or tomorrow plans', () => {
    const make = (title, delta) => createBeforeStart(tasks, { title, scheduleType: 'one-time', scheduledStartAt: now + delta, scheduledEndAt: now + delta + 3600000, timeZone: 'UTC', enabled: false });
    const carry = make('Carry over', -86400000);
    tasks.updateOccurrenceTimes({ taskId: carry.id, occurrenceId: carry.currentOccurrence.id, startedAt: now - 86400000, endedAt: null });
    make('Old missed', -86400000);
    const next = make('Next', 3600000);
    make('Tomorrow', 86400000);
    const today = getMiniToday(), sections = miniSections(today.occurrences, now);
    assert.deepEqual(sections.running.map(row => row.taskId), [carry.id]);
    assert.deepEqual(sections.upcoming.map(row => row.taskId), [next.id]);
    assert.equal(sections.missed.length, 0);
});

test('mini detail navigation resolves an exact occurrence without changing progress or accepting another identity', () => {
    const { getMiniTaskDetails } = require('../electron/services/miniService.ts');
    const task = createBeforeStart(tasks, { title: 'Open missed', scheduleType: 'one-time', scheduledStartAt: now - 7200000, scheduledEndAt: now - 3600000, timeZone: 'UTC' });
    const result = getMiniTaskDetails({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    assert.equal(result.task.id, task.id); assert.equal(result.occurrence.record.id, task.currentOccurrence.id);
    assert.equal(result.occurrence.record.startedAt, null);
    assert.throws(() => getMiniTaskDetails({ taskId: task.id, occurrenceId: 999999 }));
    assert.throws(() => getMiniTaskDetails({ taskId: task.id, scheduledStartAt: now, scheduledEndAt: now + 3600000 }));
    assert.throws(() => getMiniTaskDetails(null));
});

test('mini recurring navigation preserves the selected occurrence instead of opening the series first day', () => {
    const { getMiniTaskDetails } = require('../electron/services/miniService.ts');
    const task = tasks.createTask({ title: 'Recurring detail', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-20', startTime: '20:00', endTime: '21:00', timeZone: 'UTC', weekdays: [] } });
    const row = getMiniToday().occurrences.find(row => row.taskId === task.id && row.scheduledStartAt > now);
    assert.ok(row); assert.notEqual(row.scheduledStartAt, task.scheduledStartAt);
    const details = getMiniTaskDetails({ taskId: task.id, scheduledStartAt: row.scheduledStartAt, scheduledEndAt: row.scheduledEndAt });
    assert.equal(details.occurrence.scheduledStartAt, row.scheduledStartAt);
    assert.deepEqual(details.occurrence, row);
    assert.equal(details.occurrence.record?.startedAt ?? null, null);
    assert.equal(details.task.scheduleType, 'recurring');
});
