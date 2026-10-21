const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { defaultEndTime, moveStartTime } = require('../src/taskFormTimes.ts');

test('new tasks start with one hour and moving start preserves duration', () => {
    assert.equal(defaultEndTime('09:00'), '10:00');
    assert.equal(moveStartTime('09:00', '10:30', '11:15', false), '12:45');
});

test('manual end edits remain fixed when start changes', () => {
    assert.equal(moveStartTime('09:00', '10:30', '11:15', true), '10:30');
});

test('duration never silently wraps through midnight', () => {
    assert.equal(defaultEndTime('23:30'), '24:30');
    assert.equal(moveStartTime('09:00', '10:00', '23:30', false), '24:30');
});
