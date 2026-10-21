const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { quickAddDraft } = require('../src/timetableQuickAdd.ts');
const { quickAddSelection } = require('../src/timetableQuickAdd.ts');
const hours = { wakeTime: '08:00', sleepTime: '23:00' };
test('clicked day and scrolled timeline position prefill nearest five minutes with one-hour end', () => {
 assert.deepEqual(quickAddDraft('2026-10-21',(15*60+37-480)*1.25,1.25,480,hours),{date:'2026-10-21',startTime:'15:35',endTime:'16:35'});
 assert.equal(quickAddDraft('2026-10-22',(15*60+38-480)*.75,.75,480,hours).startTime,'15:40');
});
test('quick add ignores preferred wake/sleep but respects the same-day representable limit', () => {
 assert.equal(quickAddDraft('2026-10-21',7*60,1,0,hours).startTime,'07:00');
 assert.deepEqual(quickAddDraft('2026-10-21',22*60+45,1,0,hours),{date:'2026-10-21',startTime:'22:45',endTime:'23:45'});
 assert.equal(quickAddDraft('2026-10-21',23*60,1,0,hours).endTime,'23:55');
 assert.equal(quickAddDraft('2026-10-21',1435,1,0,{wakeTime:'00:00',sleepTime:'24:00'}),null);
});

test('two-click selection snaps the end and preserves the clicked start/day',()=>{
 const draft={date:'2026-10-21',startTime:'15:35',endTime:'16:35'};
 assert.deepEqual(quickAddSelection(draft, (16*60+12-480)*1.25,1.25,480,hours),{...draft,endTime:'16:10'});
 assert.equal(quickAddSelection(draft,0,1,480,hours).endTime,'15:40');
 assert.equal(quickAddSelection(draft,99999,1,480,hours).endTime,'23:55');
});
