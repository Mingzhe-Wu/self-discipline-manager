const assert=require('node:assert/strict');const {test,beforeEach,afterEach,mock}=require('node:test');const fs=require('node:fs'),os=require('node:os'),path=require('node:path');require('./register-typescript.cjs');
const db=require('../electron/db/database.ts'),service=require('../electron/services/taskService.ts'),slots=require('../electron/db/reminderSlotRepository.ts'),schema=require('../electron/db/schema.ts');
const hour=3600000,day=86400000,start=Date.parse('2026-10-19T09:00Z');
const daily=()=>({title:'Study',category:'study',enabled:false,scheduleType:'recurring',recurrenceRule:{frequency:'daily',startDate:'2026-10-19',startTime:'09:00',endTime:'10:00',timeZone:'UTC',weekdays:[]}});
beforeEach(()=>{mock.method(Date,'now',()=>start-hour);db.initializeDatabase(':memory:',path.resolve('drizzle'));});afterEach(()=>{db.closeDatabase();mock.restoreAll();});
test('display range chooses planned, running actual start/current end, finished actual and legacy fallback',()=>{
 const {occurrenceDisplayRange:range}=require('../shared/scheduling/occurrenceDisplay.ts');const base={taskId:1,scheduledStartAt:start,scheduledEndAt:start+hour,record:null};
 assert.deepEqual(range(base,start+2*hour),{startAt:start,endAt:start+hour});
 const running={...base,record:{startedAt:start+15*60000,endedAt:null}};assert.deepEqual(range(running,start+30*60000),{startAt:start+15*60000,endAt:start+hour});assert.equal(range(running,start+2*hour).endAt,start+2*hour);
 const late={...base,record:{startedAt:start+3*hour,endedAt:null}};assert.ok(range(late,start+4*hour).endAt>=start+4*hour);
 assert.deepEqual(range({...base,record:{startedAt:start+17*60000,endedAt:start+90*60000}},start),{startAt:start+17*60000,endAt:start+90*60000});
 assert.deepEqual(range({...base,record:{startedAt:null,endedAt:start+hour,legacyCompleted:true}},start),{startAt:start,endAt:start+hour});
 assert.equal(base.scheduledStartAt,start);
});
test('manual editor correction moves one occurrence, slots and history atomically without editing parent',()=>{
 const task=service.createTask(daily()),original=task.currentOccurrence,target={taskId:task.id,occurrenceId:original.id};
 service.updateOccurrenceTimes({...target,startedAt:start+1234,endedAt:start+30*60000+5678});slots.claimSlot(original.id,0,start);slots.finishSlot(original.id,0,'sent',start);
 const parentBefore=service.getAllTasks().find(t=>t.id===task.id),slotBefore=slots.getSlot(original.id,0),recordBefore=service.listOccurrences(task.id,start,start+1)[0];
 const saved=service.correctOccurrenceTimes({...target,startedAt:start+5*60000,endedAt:start+45*60000});assert.notEqual(saved.taskId,task.id);assert.equal(saved.id,original.id);assert.equal(saved.recordedAt,recordBefore.recordedAt);assert.equal(saved.createdAt,recordBefore.createdAt);
 const rows=service.getAllTasks(),parent=rows.find(t=>t.id===task.id),single=rows.find(t=>t.id===saved.taskId);assert.deepEqual(parent.recurrenceRule,parentBefore.recurrenceRule);assert.equal(parent.updatedAt,parentBefore.updatedAt);assert.equal(single.scheduleType,'one-time');assert.equal(single.title,task.title);assert.equal(single.category,task.category);assert.equal(single.enabled,task.enabled);assert.equal(single.scheduledStartAt,start);assert.equal(single.scheduledEndAt,start+hour);assert.equal(single.currentOccurrence.endedAt,start+45*60000);
 assert.equal(service.listOccurrences(task.id,start,start+1).length,0);assert.deepEqual(slots.getSlot(original.id,0),slotBefore);assert.equal(db.getDatabase().select().from(schema.recurrenceExclusionsTable).all().length,1);
 const week=service.getWeekSchedule(start,start+day);assert.equal(week.occurrences.filter(o=>o.scheduledStartAt===start).length,1);assert.equal(week.occurrences.find(o=>o.scheduledStartAt===start).taskId,single.id);assert.throws(()=>service.correctOccurrenceTimes({...target,startedAt:start,endedAt:start+hour}),/not found/);
});
test('normal start/finish and history edits never detach; invalid editor correction makes no replacement',()=>{
 const task=service.createTask(daily()),target={taskId:task.id,occurrenceId:task.currentOccurrence.id};service.startOccurrence(target);service.endOccurrence(target);service.updateOccurrenceTimes({...target,startedAt:start,endedAt:start+hour});assert.equal(service.getAllTasks().length,1);assert.equal(db.getDatabase().select().from(schema.recurrenceExclusionsTable).all().length,0);
 assert.throws(()=>service.correctOccurrenceTimes({...target,startedAt:start+hour,endedAt:start}),/earlier/);assert.equal(service.getAllTasks().length,1);assert.equal(db.getDatabase().select().from(schema.recurrenceExclusionsTable).all().length,0);
});
test('excluded occurrence stays detached after reopening the database',()=>{
 db.closeDatabase();const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sdm-detach-')),file=path.join(directory,'data.db');try{db.initializeDatabase(file,path.resolve('drizzle'));const task=service.createTask(daily()),record=service.correctOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start,endedAt:start+hour});db.closeDatabase();db.initializeDatabase(file,path.resolve('drizzle'));const week=service.getWeekSchedule(start,start+day);assert.equal(week.occurrences.length,1);assert.equal(week.occurrences[0].taskId,record.taskId);assert.equal(service.listOccurrences(task.id,start,start+1).length,0);assert.equal(db.getDatabase().select().from(schema.recurrenceExclusionsTable).all().length,1);}finally{db.closeDatabase();fs.rmSync(directory,{recursive:true,force:true});}
});
test('actual geometry is rendered across week boundaries without stale scheduled duplicates',()=>{
 const task=service.createTask({title:'Moved',scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+hour,timeZone:'UTC'});service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+20*day,endedAt:start+20*day+hour});assert.equal(service.getWeekSchedule(start,start+day).occurrences.length,0);const moved=service.getWeekSchedule(start+20*day,start+21*day).occurrences;assert.equal(moved.length,1);assert.equal(moved[0].scheduledStartAt,start);
});
test('recurring details reuses actual editor and shows derived occurrence statistics',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Details=require('../src/components/TaskDetails.tsx').default;const task=service.createTask(daily());const record=service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+5*60000,endedAt:start+50*60000});const html=renderToStaticMarkup(React.createElement(Details,{task,occurrence:{taskId:task.id,scheduledStartAt:start,scheduledEndAt:start+hour,record},now:start,revision:0,onChange:async()=>{},onClose(){},onEdit(){},onBusyChange(){},onDetached(){}}));assert.match(html,/actual-timeline-editor/);assert.match(html,/5 min late/);assert.match(html,/15 min shorter/);assert.match(html,/Actual start time/);
});


test('timetable markup positions planned/running/finished cards with the chosen display range',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Week=require('../src/components/WeekSchedule.tsx').default;const task=service.createTask({title:'Geometry',scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+hour,timeZone:'UTC'});
 for(const [record,now,top,height] of [[null,start+2*hour,540,60],[{startedAt:start+15*60000,endedAt:null},start+30*60000,555,45],[{startedAt:start+17*60000,endedAt:start+90*60000},start,557,73]]){
  const html=renderToStaticMarkup(React.createElement(Week,{from:Date.parse('2026-10-19T00:00Z'),tasks:[task],occurrences:[{taskId:task.id,scheduledStartAt:start,scheduledEndAt:start+hour,record}],now,timeZone:'UTC',filter:'all',onChange:async()=>{},onSelect(){}}));
  const geometry=html.match(/class="occurrence-card[^"]*"[^>]*style="top:([^;]+)px;height:([^;]+)px/);assert.ok(geometry);assert.equal(Number(geometry[1]),top);assert.equal(Number(geometry[2]),height);assert.ok(html.includes('data-scheduled-start-at="'+start+'"'));
 }
});


test('failed detachment rolls back replacement, exclusion and occurrence transfer together',()=>{
 const task=service.createTask(daily()),original=task.currentOccurrence,sql=db.getDatabase().$client;
 const before=sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(original.id);
 sql.exec("CREATE TRIGGER reject_actual_detach BEFORE INSERT ON tasks WHEN NEW.schedule_type='one-time' BEGIN SELECT RAISE(ABORT,'fixture rejection'); END");
 assert.throws(()=>service.correctOccurrenceTimes({taskId:task.id,occurrenceId:original.id,startedAt:start,endedAt:start+hour}),/fixture rejection/);
 assert.equal(service.getAllTasks().length,1);assert.equal(sql.prepare('SELECT count(*) n FROM recurrence_exclusions').get().n,0);assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences WHERE id=?').get(original.id),before);
});

test('manual correction detaches a virtual future occurrence and prevents later materialization',()=>{
 const task=service.createTask(daily()),at=start+40*day;const saved=service.correctOccurrenceTimes({taskId:task.id,scheduledStartAt:at,scheduledEndAt:at+hour,startedAt:at-60000,endedAt:at+30*60000});
 Date.now.mock.mockImplementation(()=>at+day);service.getAllTasks();const week=service.getWeekSchedule(at,at+day);assert.equal(week.occurrences.length,1);assert.equal(week.occurrences[0].taskId,saved.taskId);assert.equal(service.listOccurrences(task.id,at,at+1).length,0);
});


test('finished one-time planned correction preserves actual history, record identity and notification slots',()=>{
 const task=service.createTask({title:'Finished correction',scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+hour,timeZone:'UTC'}),original=service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start+600000,endedAt:start+3000000});slots.claimSlot(original.id,0,start);slots.finishSlot(original.id,0,'sent',start);const sent=slots.getSlot(original.id,0);
 Date.now.mock.mockImplementation(()=>start+day);
 const updated=service.updateTask(task.id,{title:task.title,scheduleType:'one-time',scheduledStartAt:start-30*60000,scheduledEndAt:start+90*60000,timeZone:'UTC'});
 assert.equal(updated.currentOccurrence.id,original.id);assert.equal(updated.currentOccurrence.startedAt,original.startedAt);assert.equal(updated.currentOccurrence.endedAt,original.endedAt);assert.equal(updated.currentOccurrence.recordedAt,original.recordedAt);assert.equal(updated.currentOccurrence.scheduledStartAt,start-30*60000);assert.equal(updated.currentOccurrence.scheduledEndAt,start+90*60000);assert.deepEqual(slots.getSlot(original.id,0),sent);assert.equal(db.getDatabase().select().from(schema.taskOccurrencesTable).all().length,1);
 assert.throws(()=>service.updateTask(task.id,daily()),/recurring|schedule type/);
});


test('conflicting historical planned range rejects correction and rolls back the task update',()=>{
 const task=service.createTask({title:'Conflict',scheduleType:'one-time',scheduledStartAt:start,scheduledEndAt:start+hour,timeZone:'UTC'});service.updateOccurrenceTimes({taskId:task.id,occurrenceId:task.currentOccurrence.id,startedAt:start,endedAt:start+hour});const sql=db.getDatabase().$client;
 sql.prepare('INSERT INTO task_occurrences(task_id,scheduled_start_at,scheduled_end_at,started_at,ended_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(task.id,start-1800000,start+hour,start-1800000,start,start,start);
 const before=sql.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),rows=sql.prepare('SELECT * FROM task_occurrences ORDER BY id').all();
 assert.throws(()=>service.updateTask(task.id,{title:'Should roll back',scheduleType:'one-time',scheduledStartAt:start-1800000,scheduledEndAt:start+hour,timeZone:'UTC'}),/UNIQUE/);assert.deepEqual(sql.prepare('SELECT * FROM tasks WHERE id=?').get(task.id),before);assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences ORDER BY id').all(),rows);
});
