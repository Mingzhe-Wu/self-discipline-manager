const assert=require('node:assert/strict');const {test}=require('node:test');require('./register-typescript.cjs');
const { lifecycleToast, TOAST_DURATION }=require('../src/toast.ts');
test('lifecycle success messages use actual times and derived duration',()=>{
 const startedAt=new Date(2026,9,20,14,32).getTime(),endedAt=startedAt+42*60000;
 assert.match(lifecycleToast('start','Exercise',{startedAt,endedAt:null}),/Started "Exercise" at/);
 assert.equal(lifecycleToast('finish','Exercise',{startedAt,endedAt}),'Finished "Exercise" · 42 min');
 assert.equal(lifecycleToast('reset','Exercise'),'"Exercise" reset to Planned');assert.ok(TOAST_DURATION>=2000&&TOAST_DURATION<=3000);
});
