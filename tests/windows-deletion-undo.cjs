const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, name) { for (let i=0;i<140;i++) { if(await check()) return; await pause(50); } throw Error('Timed out: '+name); }
(async () => {
 const evidence=fs.mkdtempSync(path.resolve('release/verification/delete-undo-'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve('.'),'--user-data-dir='+path.join(evidence,'userData')],env});
 try {
  const page=await app.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('region',{name:'Weekly schedule',exact:true}).waitFor();
  const originals=await page.evaluate(async()=>{
   const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(12,0,0,0);
   const a=await window.electronAPI.createTask({title:'Undo one-time',category:'study',scheduleType:'one-time',scheduledStartAt:+tomorrow,scheduledEndAt:+tomorrow+3600000,enabled:false});
   await window.electronAPI.updateTaskOccurrenceTimes({taskId:a.id,occurrenceId:a.currentOccurrence.id,startedAt:+tomorrow+12345,endedAt:+tomorrow+999999});
   const b=await window.electronAPI.createTask({title:'Undo series',category:'exercise',scheduleType:'recurring',recurrenceRule:{frequency:'daily',startDate:[tomorrow.getFullYear(),String(tomorrow.getMonth()+1).padStart(2,'0'),String(tomorrow.getDate()).padStart(2,'0')].join('-'),startTime:'14:00',endTime:'15:00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,weekdays:[]},enabled:false});
   return {a:(await window.electronAPI.listTasks()).find(t=>t.id===a.id),b};
  });
  await page.reload();await page.getByRole('region',{name:'Weekly schedule',exact:true}).waitFor();
  const rows=()=>page.evaluate(()=>window.electronAPI.listTasks());
  async function remove(title){
   if(title==='Undo series'){await page.getByRole('button',{name:'Manage recurring tasks',exact:true}).click();await page.locator('.task-picker').getByRole('button',{name:title,exact:true}).click();}
   else {const id=originals.a.id;let card=page.locator('.occurrence-card[data-task-id="'+id+'"]').first();if(!await card.count())await page.getByRole('button',{name:'Next week',exact:true}).click();await card.waitFor();await card.scrollIntoViewIfNeeded();await card.hover();await until(async()=>(await card.getAttribute('class')).includes('is-expanded'),'card expanded');await card.locator('.card-content').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await card.getByRole('button',{name:'Details for '+title,exact:true}).click();}
  const dialog=page.getByRole('dialog',{name:'Task details',exact:true});await dialog.getByRole('button',{name:'Delete task',exact:true}).click();await dialog.getByRole('button',{name:'Confirm delete',exact:true}).click();await dialog.waitFor({state:'hidden'});}
  await remove(originals.a.title);const deletion=page.locator('.app-toast').filter({hasText:'Task Deleted'});await deletion.waitFor();await until(async()=>!(await rows()).some(t=>t.id===originals.a.id),'task removed');
  const text=await deletion.locator('span').first().boundingBox(),undo=await deletion.getByRole('button',{name:'Undo',exact:true}).boundingBox();assert.ok(undo.x>text.x,'Undo is right of message');
  await remove(originals.b.title);await until(async()=>await deletion.count()===2,'deletion toasts stack independently');
  await deletion.first().getByRole('button',{name:'Undo',exact:true}).click();await until(async()=>(await rows()).some(t=>t.id===originals.a.id),'one-time undo');
  await deletion.getByRole('button',{name:'Undo',exact:true}).click();await until(async()=>(await rows()).some(t=>t.id===originals.b.id),'series undo');
  const restored=await rows(),a=restored.find(t=>t.id===originals.a.id),b=restored.find(t=>t.id===originals.b.id);assert.deepEqual(a.currentOccurrence,originals.a.currentOccurrence);assert.equal(a.enabled,false);assert.equal(a.category,'study');assert.deepEqual(b.recurrenceRule,originals.b.recurrenceRule);
  await remove(originals.a.title);await deletion.waitFor();await pause(5200);assert.equal(await deletion.count(),0,'deleted toast expires after five seconds');assert.equal((await rows()).some(t=>t.id===originals.a.id),false,'timeout retains deletion');
  assert.deepEqual(errors,[]);await page.screenshot({path:path.join(evidence,'result.png')});fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({passed:true,checks:['Task Deleted + right-side Undo','independent stacked undo','one-time timing preserved','recurring series restored','five-second expiry'],errors},null,2));console.log('PASS deletion undo UI: '+evidence);
 } finally {await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
