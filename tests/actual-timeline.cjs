const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { timelineScale, timelinePosition, timelineBar, snapActualTime, draggedActualTime, actualStatistics, validateActualTimes, localTimeOptions } = require('../src/actualTimeline.ts');
const minute = 60000;

test('planned and actual bars share one epoch scale, including crossing midnight', () => {
    const planned = Date.parse('2026-10-20T23:00Z');
    const scale = timelineScale(planned, planned + 60 * minute, planned - 30 * minute, planned + 120 * minute);
    assert.ok(scale.start < planned - 30 * minute);
    assert.ok(scale.end > planned + 120 * minute);
    const p = timelineBar(planned, planned + 60 * minute, scale);
    const a = timelineBar(planned - 30 * minute, planned + 120 * minute, scale);
    assert.ok(Math.abs(a.width / p.width - 2.5) < 1e-10);
    assert.equal(timelinePosition(planned, scale), p.left);
    assert.ok(a.left < p.left);
    assert.ok(timelineScale(planned, planned, null, null).end > planned);
});

test('dragging snaps only its endpoint and keeps the frozen scale and peer valid', () => {
    const start = 60 * minute + 1234, end = 90 * minute + 5678;
    const scale = { start: 0, end: 120 * minute };
    assert.equal(snapActualTime(63 * minute), 65 * minute);
    assert.equal(draggedActualTime('startedAt', .99, scale, { startedAt: start, endedAt: end }), 90 * minute);
    assert.equal(draggedActualTime('endedAt', 0, scale, { startedAt: start, endedAt: end }), 65 * minute);
    assert.deepEqual(scale, { start: 0, end: 120 * minute });
});

test('statistics use timestamps only and keep missing actual duration unknown', () => {
    assert.deepEqual(actualStatistics(100, 200, { startedAt: 90, endedAt: 230 }), { startDelta: -10, endDelta: 30, plannedDuration: 100, actualDuration: 140, durationDelta: 40 });
    assert.equal(actualStatistics(100, 200, { startedAt: 100, endedAt: null }).actualDuration, null);
    assert.equal(actualStatistics(100, 200, { startedAt: null, endedAt: null }).startDelta, null);
    assert.equal(actualStatistics(100, 200, { startedAt: 100, endedAt: 200 }).durationDelta, 0);
    assert.match(validateActualTimes({ startedAt: null, endedAt: 10 }), /start/i);
    assert.match(validateActualTimes({ startedAt: 20, endedAt: 10 }), /end/i);
    assert.equal(validateActualTimes({ startedAt: 10, endedAt: 10 }), null);
});

test('time options contain five-minute slots and retain a precise stored endpoint', () => {
    const exact = new Date(2026, 9, 20, 9, 2, 17, 125).getTime();
    const options = localTimeOptions('2026-10-20', exact);
    assert.ok(options.some(option => option.value === exact && option.precise));
    assert.match(options.find(option => option.value === exact).label, /09:02:17/);
    assert.ok(options.filter(option => !option.precise).every(option => new Date(option.value).getMinutes() % 5 === 0 && new Date(option.value).getSeconds() === 0));
    assert.ok(!localTimeOptions('2026-10-21', exact).some(option => option.value === exact));
});

test('editor markup keeps unknown, empty, unfinished, and exact actual states explicit', () => {
    require.extensions['.css'] = () => {};
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const Editor = require('../src/components/ActualTimelineEditor.tsx').default;
    const planned = new Date(2026, 9, 20, 23, 0).getTime();
    const render = record => renderToStaticMarkup(React.createElement(Editor, { occurrence: { taskId: 1, scheduledStartAt: planned, scheduledEndAt: planned + 60 * minute, record }, onChange: async () => {}, onBusyChange() {} }));
    const empty = render(null);
    assert.match(empty, /Not recorded/);
    assert.equal((empty.match(/type="date"/g) || []).length, 2);
    assert.ok(!empty.includes('role="slider"'));
    assert.match(render({ id: 2, startedAt: null, endedAt: null, legacyCompleted: true }), /Unknown \(imported record\)/);
    const partial = render({ id: 2, startedAt: planned + 1234, endedAt: null });
    assert.match(partial, /Unfinished/);
    assert.equal((partial.match(/role="slider"/g) || []).length, 1);
    assert.match(partial, /saved precise time/);
    const complete = render({ id: 2, startedAt: planned, endedAt: planned + 60 * minute });
    assert.equal((complete.match(/role="slider"/g) || []).length, 2);
    assert.match(complete, /On time/);
    assert.match(complete, /Same duration/);
});


test('repeated endpoint drags stop at local midnight and 23:55', () => {
    const at = (h, m = 0) => new Date(2026, 9, 20, h, m).getTime();
    let actual = { startedAt: at(10), endedAt: at(11) };
    for (let i = 0; i < 100; i++) {
        const scale = timelineScale(at(10), at(11), actual.startedAt, actual.endedAt);
        actual = { startedAt: draggedActualTime('startedAt', -10, scale, actual), endedAt: draggedActualTime('endedAt', 10, scale, actual) };
    }
    assert.equal(actual.startedAt, at(0));
    assert.equal(actual.endedAt, at(23, 55));
    assert.deepEqual(timelineScale(at(10), at(11), actual.startedAt, actual.endedAt), { start: at(0), end: at(23, 55) });
});
