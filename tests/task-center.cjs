const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { taskCenterEntries, filterTaskCenterEntries, toggleTaskCenterFilter } = require('../src/taskCenter.ts');
const tasks = [{ id: 1, title: 'Same title', scheduleType: 'recurring', createdAt: 1 }, { id: 2, title: 'Same title', scheduleType: 'one-time', createdAt: 2 }, { id: 3, title: 'Same title', scheduleType: 'one-time', createdAt: 3 }];
const occurrence = (taskId, id, at) => ({ taskId, scheduledStartAt: at, scheduledEndAt: at + 1, record: { id } });
const data = { tasks, occurrences: [occurrence(1, 11, 100), occurrence(1, 12, 200), occurrence(2, 21, 300)] };

test('Task Center keeps same-title tasks and distinct recurring missed occurrences as separate records', () => {
    const entries = taskCenterEntries(data);
    assert.equal(entries.length, 5);
    assert.equal(new Set(entries.map(row => row.key)).size, 5);
    assert.equal(entries.filter(row => row.kind === 'recurring').length, 1);
    assert.equal(entries.filter(row => row.task.id === 2).length, 1, 'one-time missed record is shown once');
    assert.equal(entries.filter(row => row.task.id === 1 && row.kind === 'missed').length, 2);
    assert.equal(entries.filter(row => row.kind === 'one-time').length, 1);
});

test('single filter value makes tags exclusive and selecting again returns all', () => {
    let filter = 'all';
    filter = toggleTaskCenterFilter(filter, 'recurring'); assert.equal(filter, 'recurring');
    filter = toggleTaskCenterFilter(filter, 'missed'); assert.equal(filter, 'missed');
    filter = toggleTaskCenterFilter(filter, 'missed'); assert.equal(filter, 'all');
    assert.equal(toggleTaskCenterFilter('recurring', 'recurring'), 'all');
});

test('filters preserve proper destination kinds and newest-first missed ordering', () => {
    const entries = taskCenterEntries(data);
    assert.equal(filterTaskCenterEntries(entries, 'all').length, 5);
    assert.deepEqual(filterTaskCenterEntries(entries, 'recurring').map(row => row.task.id), [1]);
    assert.deepEqual(filterTaskCenterEntries(entries, 'missed').map(row => row.occurrence.record.id), [21, 12, 11]);
});

test('title search is case-insensitive, trimmed and retains same-title records', () => {
    const entries = taskCenterEntries(data);
    assert.equal(filterTaskCenterEntries(entries, 'all', ' SAME title ').length, 5);
    assert.equal(filterTaskCenterEntries(entries, 'all', 'missing').length, 0);
    assert.equal(filterTaskCenterEntries(entries, 'all', '   ').length, 5);
});

test('category and title combine with the exclusive type filter without changing missed ordering', () => {
    const categorized = { ...data, tasks: data.tasks.map(task => ({ ...task, category: task.id === 1 ? 'exercise' : 'other' })) };
    const entries = taskCenterEntries(categorized);
    assert.equal(filterTaskCenterEntries(entries, 'all', '', 'exercise').length, 3);
    assert.equal(filterTaskCenterEntries(entries, 'recurring', 'title', 'other').length, 0);
    assert.deepEqual(filterTaskCenterEntries(entries, 'missed', 'same', 'exercise').map(row => row.occurrence.record.id), [12, 11]);
    assert.equal(filterTaskCenterEntries(entries, 'all', '', 'other').length, 2);
});
