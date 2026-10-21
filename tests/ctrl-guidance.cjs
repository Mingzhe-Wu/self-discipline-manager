const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

test('Ctrl guidance exposes an accessible help control and the complete instructions', () => {
    const Help = require('../src/components/CtrlModeHelp.tsx').default;
    const html = renderToStaticMarkup(React.createElement(Help));
    assert.match(html, /aria-label="Ctrl mode guidance"/);
    for (const text of ['Click empty space to set the start time', 'Move the pointer to preview the end time', 'Click again to confirm the end time', 'Guide line shows the current pointer time', 'Right-click while selecting to cancel', 'Double-click empty space to create a task without choosing an end time', 'Drag an existing task edge to adjust its start\/end time', '(planned or actual, depending on task state)']) assert.ok(html.includes(text));
});
