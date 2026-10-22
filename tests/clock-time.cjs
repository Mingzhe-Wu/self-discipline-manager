const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { CLOCK_HOURS, CLOCK_MINUTES, replaceClockPart } = require('../src/clockTime.ts');

test('clock selection exposes 24 hours and twelve five-minute values', () => {
    assert.equal(CLOCK_HOURS.length, 24); assert.equal(CLOCK_HOURS[0], '00'); assert.equal(CLOCK_HOURS.at(-1), '23');
    assert.deepEqual(CLOCK_MINUTES, ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55']);
    assert.equal(replaceClockPart('09:35', 'hour', '13'), '13:35');
    assert.equal(replaceClockPart('09:35', 'minute', '55'), '09:55');
    assert.equal(replaceClockPart('', 'hour', '00'), '00:');
    assert.equal(replaceClockPart('', 'minute', '05'), ':05');
    assert.equal(replaceClockPart('09:35', 'hour', ''), ':35');
});

test('planned clock fields are separate accessible hour/minute controls and preserve invalid/saved values without rounding', () => {
    const Clock = require('../src/components/ClockTimeSelect.tsx').default;
    const render = (hour, minute) => renderToStaticMarkup(React.createElement(Clock, { label: 'Start Time', hour, minute, onHourChange() {}, onMinuteChange() {}, required: true }));
    const html = render('09', '35');
    assert.equal((html.match(/<select/g) || []).length, 2); assert.equal((html.match(/<option/g) || []).length, 38);
    assert.match(html, /aria-label="Start Time hour"/); assert.match(html, /aria-label="Start Time minute"/);
    assert.match(render('24', '03'), /24 \(saved\)/); assert.match(render('24', '03'), /03 \(saved\)/);
});

test('Actual endpoint splits hours/minutes and retains the precise saved instant', () => {
    const Endpoint = require('../src/components/ActualEndpointControl.tsx').default;
    const exact = new Date(2026, 9, 21, 9, 2, 17, 123).getTime();
    const html = renderToStaticMarkup(React.createElement(Endpoint, { endpoint: 'startedAt', value: exact, fallback: exact, disabled: false, selectingDisabled: false, onChange() {} }));
    assert.equal((html.match(/<select/g) || []).length, 2);
    assert.match(html, /aria-label="Actual start hour"/); assert.match(html, /aria-label="Actual start minute"/);
    assert.match(html, /saved precise time/); assert.ok(html.includes(`value="${exact}" selected`));
    assert.ok((html.match(/<option/g) || []).length < 45);
});

test('ordinary Add Task starts with four empty clock placeholders', () => {
    const TaskForm = require('../src/components/TaskForm.tsx').default;
    const html = renderToStaticMarkup(React.createElement(TaskForm, { onSave: async () => {}, onCancel() {} }));
    assert.equal((html.match(/value="" selected="">Hour/g) || []).length, 2);
    assert.equal((html.match(/value="" selected="">Minute/g) || []).length, 2);
    const Endpoint = require('../src/components/ActualEndpointControl.tsx').default;
    const actual = renderToStaticMarkup(React.createElement(Endpoint, { endpoint: 'startedAt', value: null, fallback: Date.now(), disabled: false, selectingDisabled: false, onChange() {} }));
    assert.match(actual, /value="" selected="">Hour/);
});
