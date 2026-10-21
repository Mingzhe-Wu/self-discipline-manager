const assert=require('node:assert/strict');
const {test,beforeEach,afterEach,mock}=require('node:test');
require('./register-typescript.cjs');
const path=require('node:path');
const db=require('../electron/db/database.ts'),service=require('../electron/services/taskService.ts'),schema=require('../electron/db/schema.ts');
const {resizeOccurrenceRange,resizeDragTime}=require('../shared/scheduling/occurrenceResize.ts');
const start=Date.parse('2026-10-20T12:00Z'),minute=60000,hour=60*minute;
beforeEach(()=>{mock.method(Date,'now',()=>start-hour);db.initializeDatabase(':memory:',path.resolve('drizzle'));});
afterEach(()=>{db.closeDatabase();mock.restoreAll();});
const single=()=>service.createTask({title:'Resize',category:'exercise',enabled:false,scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+hour,timeZone:'UTC'});
const recurring=()=>service.createTask({title:'Series',category:'study',enabled:false,scheduleType:'recurring',recurrenceRule:{frequency:'daily',startDate:'2026-10-20',startTime:'12:00',endTime:'13:00',timeZone:'UTC',weekdays:[]}});
function resize(task,edge,at){return service.resizeOccurrence({target:{taskId:task.id,occurrenceId:task.currentOccurrence.id},edge,at,expectedState:task.currentOccurrence.endedAt!==null?'completed':task.currentOccurrence.startedAt!==null?'in-progress':'planned'});}
test('planned edges change only planned boundaries and preserve occurrence identity',()=>{
 const task=single(),saved=resize(task,'start',start-5*minute);
 assert.equal(saved.id,task.currentOccurrence.id);assert.equal(saved.scheduledStartAt,start-5*minute);assert.equal(saved.scheduledEndAt,start+hour);assert.equal(saved.startedAt,null);
 resize(service.getAllTasks()[0],'end',start+90*minute);assert.equal(service.getAllTasks()[0].scheduledEndAt,start+90*minute);
});
test('in-progress top edits actual start and bottom edits planned end without completing',()=>{
 let task=single();service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+7*minute+1234,endedAt:null});task=service.getAllTasks()[0];
 const saved=resize(task,'start',start+5*minute);assert.equal(saved.startedAt,start+5*minute);assert.equal(saved.scheduledStartAt,start);assert.equal(saved.endedAt,null);
 const end=resize(service.getAllTasks()[0],'end',start+90*minute);assert.equal(end.scheduledEndAt,start+90*minute);assert.equal(end.startedAt,start+5*minute);assert.equal(end.endedAt,null);
});
test('finished edges edit actual times only, retaining precise untouched endpoint',()=>{
 let task=single();service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+7*minute+1234,endedAt:start+50*minute});task=service.getAllTasks()[0];
 const saved=resize(task,'end',start+55*minute);assert.equal(saved.startedAt,start+7*minute+1234);assert.equal(saved.endedAt,start+55*minute);assert.equal(saved.scheduledStartAt,start);assert.equal(saved.scheduledEndAt,start+hour);
});
test('invalid ranges, non-five-minute edits and stale lifecycle are rejected without writes',()=>{
 const task=single();assert.throws(()=>resize(task,'end',start),/later|after/i);assert.throws(()=>resize(task,'start',start+3*minute),/five.minute/i);
 service.startOccurrence({taskId:task.id,occurrenceId:task.currentOccurrence.id});assert.throws(()=>resize(task,'end',start+90*minute),/changed/i);
 const live=service.getAllTasks()[0];assert.throws(()=>resize(live,'end',live.currentOccurrence.startedAt-5*minute),/start|later|after/i);
 assert.equal(service.getAllTasks()[0].scheduledEndAt,start+hour);
});
test('recurring planned resize detaches just this occurrence, preserving rule and exclusion',()=>{
 const task=recurring(),rule=task.recurrenceRule,original=task.currentOccurrence;
 const saved=resize(task,'end',start+90*minute),rows=service.getAllTasks();assert.notEqual(saved.taskId,task.id);assert.equal(saved.id,original.id);assert.equal(saved.startedAt,null);assert.equal(saved.scheduledEndAt,start+90*minute);
 const parent=rows.find(t=>t.id===task.id),child=rows.find(t=>t.id===saved.taskId);assert.deepEqual(parent.recurrenceRule,rule);assert.equal(child.category,'study');assert.equal(child.scheduleType,'one-time');assert.equal(child.scheduledEndAt,saved.scheduledEndAt);
 assert.equal(db.getDatabase().select().from(schema.recurrenceExclusionsTable).all().length,1);
 const occurrences=service.getWeekSchedule(start,start+24*hour).occurrences;assert.equal(occurrences.length,1);assert.equal(occurrences[0].taskId,child.id);
});
test('recurring actual correction transfers existing history and successful notification slots',()=>{
 const slots=require('../electron/db/reminderSlotRepository.ts');let task=recurring();service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start,endedAt:start+45*minute});task=service.getAllTasks()[0];
 const original=task.currentOccurrence;slots.claimSlot(original.id,0,start);slots.finishSlot(original.id,0,'sent',start);const sent=slots.getSlot(original.id,0);
 const saved=resize(task,'start',start+5*minute);assert.equal(saved.id,original.id);assert.equal(saved.endedAt,original.endedAt);assert.equal(saved.recordedAt,original.recordedAt);assert.deepEqual(slots.getSlot(saved.id,0),sent);assert.notEqual(saved.taskId,task.id);
});
test('drag snapping uses five minutes and stops at the original local day boundaries',()=>{
 assert.equal(resizeDragTime(start,7,'UTC'),start+5*minute);assert.equal(resizeDragTime(start,-9999,'UTC'),Date.parse('2026-10-20T00:00Z'));assert.equal(resizeDragTime(start,9999,'UTC'),Date.parse('2026-10-20T23:55Z'));
 const occurrence={scheduledStartAt:start,scheduledEndAt:start+hour,record:{startedAt:start+10*minute,endedAt:start+50*minute}};
 assert.throws(()=>resizeOccurrenceRange(occurrence,'end',start),/start|earlier/i);
});

test('recurring in-progress planned-end resize preserves actual start and stays in progress',()=>{
 let task=recurring();service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+7*minute+1234,endedAt:null});task=service.getAllTasks()[0];
 const saved=resize(task,'end',start+90*minute);assert.notEqual(saved.taskId,task.id);assert.equal(saved.startedAt,task.currentOccurrence.startedAt);assert.equal(saved.endedAt,null);assert.equal(saved.recordedAt,task.currentOccurrence.recordedAt);assert.equal(saved.scheduledEndAt,start+90*minute);
});

test('failed recurring resize rolls back replacement, exclusion and transferred history',()=>{
 const task=recurring(),sql=db.getDatabase().$client,before=sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(task.currentOccurrence.id);
 sql.exec("CREATE TRIGGER reject_resize BEFORE INSERT ON tasks WHEN NEW.schedule_type='one-time' BEGIN SELECT RAISE(ABORT,'resize rejected'); END");
 assert.throws(()=>resize(task,'end',start+90*minute),/resize rejected/);
 assert.equal(service.getAllTasks().length,1);assert.equal(sql.prepare('SELECT count(*) n FROM recurrence_exclusions').get().n,0);assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(task.currentOccurrence.id),before);
});

test('resized recurring exclusion and transferred occurrence survive database reopen',()=>{
 const fs=require('node:fs'),os=require('node:os'),directory=fs.mkdtempSync(path.join(os.tmpdir(),'sdm-resize-')),file=path.join(directory,'data.db');
 db.closeDatabase();
 try {
  db.initializeDatabase(file,path.resolve('drizzle'));const task=recurring(),saved=resize(task,'end',start+90*minute);
  db.closeDatabase();db.initializeDatabase(file,path.resolve('drizzle'));
  const week=service.getWeekSchedule(start,start+24*hour);assert.equal(week.occurrences.length,1);assert.equal(week.occurrences[0].taskId,saved.taskId);assert.equal(week.occurrences[0].scheduledEndAt,start+90*minute);assert.equal(service.listOccurrences(task.id,start,start+1).length,0);
 } finally {db.closeDatabase();fs.rmSync(directory,{recursive:true,force:true});}
});
