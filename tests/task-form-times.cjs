const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { defaultEndTime, moveStartTime } = require('../src/taskFormTimes.ts');

test('a start-only quick-add draft keeps end empty when its start is changed',()=>{
 assert.equal(moveStartTime('13:00','','13:30',false),'');
});

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

test('clearing or partially choosing a start never produces a NaN end', () => {
    assert.equal(defaultEndTime(''), '');
    assert.equal(moveStartTime('09:00', '10:00', '', false), '');
    assert.equal(moveStartTime('09:00', '10:00', '09:', false), '');
    assert.equal(moveStartTime(':35', '10:00', '09:35', false), '10:00');
    assert.equal(moveStartTime('09:00', '10:00', ':35', true), '10:00');
});
