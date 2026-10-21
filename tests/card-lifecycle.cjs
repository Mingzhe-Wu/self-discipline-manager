const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const path = require('node:path');
require('./register-typescript.cjs');
const database = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const { occurrenceDuration, occurrenceState } = require('../shared/occurrenceLifecycle.ts');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const WeekSchedule = require('../src/components/WeekSchedule.tsx').default;
const at = Date.parse('2026-10-20T09:00Z');
beforeEach(() => { mock.method(Date, 'now', () => at); database.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { database.closeDatabase(); mock.restoreAll(); });
for (const kind of ['one-time', 'recurring']) {
    test(`${kind} finished reset clears actual times and duration but preserves the occurrence and planned relationship`, () => {
        const task = service.createTask(kind === 'one-time' ? { title: 'Focus', scheduleType: kind, scheduledStartAt: at, scheduledEndAt: at + 1800000, timeZone: 'UTC' }
            : { title: 'Focus', scheduleType: kind, recurrenceRule: { frequency: 'daily', startDate: '2026-10-20', startTime: '09:00', endTime: '09:30', timeZone: 'UTC', weekdays: [] } });
        const original = task.currentOccurrence;
        const target = { taskId: task.id, occurrenceId: original.id };
        service.startOccurrence(target);
        Date.now.mock.mockImplementation(() => at + 65123);
        const finished = service.endOccurrence(target);
        assert.equal(occurrenceState(finished), 'completed'); assert.equal(occurrenceDuration(finished), 65123);
        const reset = service.updateOccurrenceTimes({ ...target, startedAt: null, endedAt: null });
        assert.equal(occurrenceState(reset), 'planned');
        assert.equal(reset.startedAt, null); assert.equal(reset.endedAt, null); assert.equal(occurrenceDuration(reset), null);
        assert.equal(reset.id, original.id); assert.equal(reset.taskId, original.taskId);
        assert.equal(reset.scheduledStartAt, original.scheduledStartAt); assert.equal(reset.scheduledEndAt, original.scheduledEndAt);
        const loaded = service.getAllTasks().find((row) => row.id === task.id);
        assert.equal(loaded.scheduledStartAt, task.scheduledStartAt); assert.equal(loaded.scheduledEndAt, task.scheduledEndAt);
        assert.deepEqual(loaded.recurrenceRule, task.recurrenceRule); assert.equal(loaded.enabled, task.enabled);
    });
}
test('timetable cards expose independent upper details and lower lifecycle regions', () => {
    const task = service.createTask({ title: 'Focus', scheduleType: 'one-time', scheduledStartAt: at, scheduledEndAt: at + 1800000 });
    const week = service.getWeekSchedule(at, at + 86400000);
    const render = () => renderToStaticMarkup(React.createElement(WeekSchedule, { from: at, ...service.getWeekSchedule(at, at + 86400000), now: at, timeZone: 'UTC', filter: 'all', onChange: async () => {}, onSelect() {} }));
    assert.equal(week.occurrences.length, 1);
    assert.doesNotMatch(render(), /lifecycle-action/);
    assert.match(render(), /<button[^>]*class="card-primary-button card-action-hint"[^>]*>/);
    assert.match(render(), /<button[^>]*class="card-details-region-button"/);
    assert.doesNotMatch(render(), /<li[^>]*role="button"/);
    assert.match(render(), /aria-label="Start Focus"/);
    assert.match(render(), /aria-label="Details for Focus"/);
    service.startOccurrence({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    assert.match(render(), /aria-label="Finish Focus"/);
    service.endOccurrence({ taskId: task.id, occurrenceId: task.currentOccurrence.id });
    assert.match(render(), /aria-label="Reset Focus"/);
    assert.match(render(), />Finished</);
});


test('each lifecycle state exposes its visual state, action hint and accessible description', () => {
    const task = service.createTask({ title: 'Study', scheduleType: 'one-time', scheduledStartAt: at, scheduledEndAt: at + 1800000 });
    const target = { taskId: task.id, occurrenceId: task.currentOccurrence.id };
    const render = () => renderToStaticMarkup(React.createElement(WeekSchedule, { from: at, ...service.getWeekSchedule(at, at + 86400000), now: at, timeZone: 'UTC', filter: 'all', onChange: async () => {}, onSelect() {} }));
    for (const [state, label, action] of [['planned', 'Planned', 'Start'], ['in-progress', 'In Progress', 'Finish'], ['completed', 'Finished', 'Reset']]) {
        if (state === 'in-progress') service.startOccurrence(target);
        if (state === 'completed') service.endOccurrence(target);
        const html = render();
        assert.ok(html.includes('data-state="' + state + '"'));
        assert.ok(html.includes('Press to ' + action.toLowerCase()));
        assert.ok(html.includes({ Start: '▶', Finish: '■', Reset: '↺' }[action]));
        assert.match(html, /class="lifecycle-status"/);
        assert.match(html, /class="card-action-label"/);
        assert.match(html, /class="card-primary-button card-action-hint"[^>]*aria-describedby="[^"]+"/);
        assert.ok(html.includes('>' + label + '<'));
        assert.match(html, /class="task-card-title">Study</);
        assert.match(html, /aria-label="Details for Study"/);
    }
});
