const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, mock } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('./register-typescript.cjs');
const { TASK_CATEGORIES, categoryMetadata } = require('../shared/taskCategories.ts');
const database = require('../electron/db/database.ts');
const service = require('../electron/services/taskService.ts');
const now = Date.parse('2026-10-19T08:00:00Z');
const oneTime = (category) => ({ title: 'Algorithms', category, scheduleType: 'one-time', timeZone: 'UTC', scheduledStartAt: now+3600000, scheduledEndAt: now+3900000 });
const recurring = (category) => ({ title: 'Practice', category, scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: '2026-10-19', startTime: '10:00', endTime: '11:00', timeZone: 'UTC', weekdays: [] } });
beforeEach(() => { mock.method(Date, 'now', () => now); database.initializeDatabase(':memory:', path.resolve('drizzle')); });
afterEach(() => { database.closeDatabase(); mock.restoreAll(); });
test('nine stable category keys map to readable metadata with Other fallback', () => {
 assert.deepEqual(TASK_CATEGORIES.map(c=>c.key), ['study','work','exercise','personal','chores','meal','rest','entertainment','other']);
 assert.equal(categoryMetadata('study').emoji, '📚'); assert.equal(categoryMetadata('work').label, 'Work');
 assert.equal(categoryMetadata(undefined).key, 'other'); assert.equal(categoryMetadata('unknown').key, 'other');
});
test('one-time and recurring categories persist as keys and invalid category input is rejected', () => {
 const a=service.createTask(oneTime('study')), b=service.createTask(recurring('exercise'));
 assert.equal(a.category,'study');assert.equal(b.category,'exercise');
 assert.equal(service.createTask(oneTime(undefined)).category,'other');
 assert.deepEqual(database.getDatabase().$client.prepare('SELECT category FROM tasks ORDER BY id').all().map(r=>r.category),['study','exercise','other']);
 for(const category of ['📚','invalid',null,123])assert.throws(()=>service.createTask(oneTime(category)),/category/i);
});
test('category-only editing preserves all schedule, lifecycle and notification records', () => {
 const task=service.createTask(oneTime('study'));const target={taskId:task.id,occurrenceId:task.currentOccurrence.id};
 service.startOccurrence(target);service.endOccurrence(target);
 const sql=database.getDatabase().$client;
 sql.prepare("INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state,sent_at) VALUES(?,0,'sent',?)").run(target.occurrenceId,now);
 const before=sql.prepare('SELECT * FROM task_occurrences').all(), slots=sql.prepare('SELECT * FROM occurrence_reminder_slots').all();
 assert.equal(service.updateTask(task.id,oneTime('work')).category,'work');
 const omitted=oneTime(undefined);delete omitted.category;assert.equal(service.updateTask(task.id,omitted).category,'work');
 assert.deepEqual(sql.prepare('SELECT * FROM task_occurrences').all(),before);assert.deepEqual(sql.prepare('SELECT * FROM occurrence_reminder_slots').all(),slots);
});
test('derived recurring occurrences use the parent category and Sync OFF inherits or explicitly changes it', () => {
 const task=service.createTask(recurring('study'));const start=task.scheduledStartAt;
 const week=service.getWeekSchedule(now,now+7*86400000);assert.equal(week.tasks.find(t=>t.id===task.id).category,'study');
 const changes=oneTime(undefined);delete changes.category;
 const detached=service.updateOccurrencePlan({target:{taskId:task.id,scheduledStartAt:start,scheduledEndAt:task.scheduledEndAt},changes,sync:false});
 assert.equal(detached.category,'study');assert.equal(service.getAllTasks().find(t=>t.id===task.id).category,'study');
 const next=start+86400000;const changed=service.updateOccurrencePlan({target:{taskId:task.id,scheduledStartAt:next,scheduledEndAt:next+3600000},changes:{...oneTime('personal'),scheduledStartAt:next+3600000,scheduledEndAt:next+3900000},sync:false});
 assert.equal(changed.category,'personal');
});
test('category persists across database reopen', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'categories-'));const file=path.join(dir,'data.db');
 try{database.closeDatabase();database.initializeDatabase(file,path.resolve('drizzle'));const task=service.createTask(recurring('rest'));database.closeDatabase();database.initializeDatabase(file,path.resolve('drizzle'));assert.equal(service.getAllTasks().find(t=>t.id===task.id).category,'rest');}
 finally{database.closeDatabase();fs.rmSync(dir,{recursive:true,force:true});}
});

test('0007 adds only category=other to legacy recurring/one-time rows and is restart safe', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'category-migration-')),folder=path.join(dir,'old'),file=path.join(dir,'data.db');
 try{
  database.closeDatabase();fs.mkdirSync(path.join(folder,'meta'),{recursive:true});
  const journal=JSON.parse(fs.readFileSync('drizzle/meta/_journal.json'));journal.entries=journal.entries.filter(e=>e.idx<7);
  fs.writeFileSync(path.join(folder,'meta/_journal.json'),JSON.stringify(journal));for(const e of journal.entries)fs.copyFileSync(path.join('drizzle',e.tag+'.sql'),path.join(folder,e.tag+'.sql'));
  database.initializeDatabase(file,folder);const sql=database.getDatabase().$client;
  const rule=JSON.stringify(recurring('study').recurrenceRule);
  sql.prepare("INSERT INTO tasks(id,title,schedule_type,scheduled_start_at,scheduled_end_at,time_zone,recurrence_rule,created_at,updated_at) VALUES(1,'Legacy one','one-time',?,?,'UTC',NULL,1,2),(2,'Legacy recurring','recurring',?,?,'UTC',?,1,2)").run(now,now+1800000,now,now+3600000,rule);
  sql.prepare("INSERT INTO task_occurrences(id,task_id,scheduled_start_at,scheduled_end_at,started_at,ended_at,recorded_at,progress_source,created_at,updated_at) VALUES(1,1,?,?,?, ?,?,'corrected',1,2)").run(now,now+1800000,now-12345,now+1900123,now+86400000);
  sql.prepare("INSERT INTO occurrence_reminder_slots(occurrence_id,slot,state,sent_at) VALUES(1,0,'sent',123)").run();
  sql.prepare('INSERT INTO recurrence_exclusions(task_id,scheduled_start_at,scheduled_end_at,created_at) VALUES(2,?,?,1)').run(now+86400000,now+90000000);
  const tables=['tasks','task_occurrences','occurrence_reminder_slots','recurrence_exclusions'];
  const before=Object.fromEntries(tables.map(t=>[t,sql.prepare('SELECT * FROM '+t+' ORDER BY id').all()]));
  database.closeDatabase();database.initializeDatabase(file,path.resolve('drizzle'));
  for(const t of tables){const after=database.getDatabase().$client.prepare('SELECT * FROM '+t+' ORDER BY id').all();if(t==='tasks')for(const row of after){assert.equal(row.category,'other');delete row.category;}assert.deepEqual(after,before[t],t);}
  database.closeDatabase();database.initializeDatabase(file,path.resolve('drizzle'));assert.equal(database.getDatabase().$client.prepare('SELECT count(*) n FROM tasks WHERE category=?').get('other').n,2);
 }finally{database.closeDatabase();fs.rmSync(dir,{recursive:true,force:true});}
});

test('forms, tiny/grouped cards and details expose category without category status colors', () => {
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const WeekSchedule=require('../src/components/WeekSchedule.tsx').default,TaskForm=require('../src/components/TaskForm.tsx').default,TaskDetails=require('../src/components/TaskDetails.tsx').default;
 const a=service.createTask(oneTime('study'));service.createTask({...oneTime('work'),title:'Project'});
 const week=service.getWeekSchedule(now,now+86400000);const html=renderToStaticMarkup(React.createElement(WeekSchedule,{from:now,...week,now,timeZone:'UTC',filter:'all',onChange:async()=>{},onSelect(){}}));
 assert.match(html,/is-grouped/);assert.match(html,/is-micro/);assert.match(html,/task-category-emoji[^>]*>📚/);assert.match(html,/task-card-title">Algorithms/);
 assert.match(html,/Study category, Algorithms/);assert.match(html,/data-state="planned"/);assert.doesNotMatch(html,/category-study|category-work/);
 const form=renderToStaticMarkup(React.createElement(TaskForm,{task:a,onSave:async()=>{},onCancel(){}}));assert.match(form,/aria-label="Category"/);assert.match(form,/value="study" selected="">📚 Study/);
 const details=renderToStaticMarkup(React.createElement(TaskDetails,{task:a,now,revision:0,onChange:async()=>{},onClose(){},onEdit(){},onBusyChange(){}}));assert.match(details, /<dt>[\s\S]*?Category<\/dt><dd><span class="detail-category-badge">📚 Study<\/span><\/dd>/);
});
