const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { quickAddDraft } = require('../src/timetableQuickAdd.ts');
const hours = { wakeTime: '08:00', sleepTime: '23:00' };
test('clicked day and scrolled timeline position prefill nearest five minutes with one-hour end', () => {
 assert.deepEqual(quickAddDraft('2026-10-21',(15*60+37-480)*1.25,1.25,480,hours),{date:'2026-10-21',startTime:'15:35',endTime:'16:35'});
 assert.equal(quickAddDraft('2026-10-22',(15*60+38-480)*.75,.75,480,hours).startTime,'15:40');
});
test('quick add respects wake/sleep and existing same-day representable form times', () => {
 assert.equal(quickAddDraft('2026-10-21',7*60,1,0,hours),null);
 assert.deepEqual(quickAddDraft('2026-10-21',22*60+45,1,0,hours),{date:'2026-10-21',startTime:'22:45',endTime:'23:00'});
 assert.equal(quickAddDraft('2026-10-21',23*60,1,0,hours),null);
 assert.equal(quickAddDraft('2026-10-21',1435,1,0,{wakeTime:'00:00',sleepTime:'24:00'}),null);
});
