const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {_electron}=require('playwright-core');
(async()=>{
 const evidence=fs.mkdtempSync(path.resolve('release/verification/quick-select-')),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve('.'),'--user-data-dir='+path.join(evidence,'userData')],env});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const board=page.getByRole('region',{name:'Weekly schedule',exact:true});await board.waitFor();
  const toolbar=page.getByRole('navigation',{name:'Week navigation'});
  const heights=[];for(const name of ['Manage recurring tasks','Planning hours','Add Task']){const b=toolbar.getByRole('button',{name,exact:true});heights.push((await b.boundingBox()).height);}assert.equal(new Set(heights).size,1,'task actions share a height');
  assert.equal(await page.locator('.workspace-footer').count(),0);
  const help=toolbar.getByRole('button',{name:'Ctrl mode guidance',exact:true}),panel=page.locator('.ctrl-help-panel');await help.hover();await panel.waitFor({state:'visible'});assert.match(await panel.innerText(),/planned or actual, depending on task state/);await page.mouse.move(10,10);await panel.waitFor({state:'hidden'});await help.click();await page.mouse.move(10,10);await panel.waitFor({state:'visible'});await help.press('Escape');await panel.waitFor({state:'hidden'});
  const before=await board.locator('.day-column').nth(2).getAttribute('data-date');await page.getByRole('button',{name:'Next week',exact:true}).click();
  await page.waitForFunction(date=>document.querySelectorAll('.day-column')[2].dataset.date!==date,before);
  await page.getByText('Your week starts here.',{exact:true}).waitFor();
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();});
  await page.waitForFunction(()=>{const b=document.querySelector('.week-scroll');return b&&Math.abs(Number(b.dataset.density)-Math.max(.25,(b.clientHeight-92)/480))<.001;});
  const day=board.locator('.day-column').nth(2),date=await day.getAttribute('data-date'),density=Number(await board.getAttribute('data-density'));
  await board.evaluate(element=>{element.scrollTop=(13*60-Number(element.dataset.planningStart))*Number(element.dataset.density)-100;});
  const point=await day.locator('.day-timeline').evaluate(element=>{const r=element.getBoundingClientRect(),b=element.closest('.week-scroll');return{x:r.x+r.width/2,y:r.y+(13*60-Number(b.dataset.planningStart))*Number(b.dataset.density)};});
  const selection=page.locator('.quick-add-selection'),form=page.getByRole('dialog',{name:'Add Task',exact:true});
  await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);
  await selection.waitFor({timeout:3000});assert.equal(await page.locator('.quick-add-mode-label').innerText(),'Ctrl mode active. See the instructions in the top-right corner.');assert.match(await page.locator('.quick-add-hint').innerText(),/Click to confirm end time/);assert.equal(await page.locator('.quick-add-guide').count(),1,'guide stays visible in selection mode');assert.equal(await form.count(),0,'first released click stays in selection mode');
  await page.mouse.move(point.x,point.y+90*density);assert.match(await selection.innerText(),/13:00–14:30/);assert.equal(await page.locator('.quick-add-guide-time').innerText(),'14:30');assert.equal(await form.count(),0);
  await page.mouse.click(point.x,point.y-30*density);assert.equal(await form.count(),0,'upward range is rejected');
  await page.mouse.move(point.x,point.y+90*density);await page.screenshot({path:path.join(evidence,'two-click-selection.png')});
  await page.mouse.click(point.x,point.y+90*density);await form.waitFor();assert.equal(await form.getByLabel('Date',{exact:true}).inputValue(),date);assert.equal(await form.getByLabel('Start Time',{exact:true}).inputValue(),'13:00');assert.equal(await form.getByLabel('End Time',{exact:true}).inputValue(),'14:30');
  await page.keyboard.up('Control');await form.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);await selection.waitFor();await page.mouse.click(point.x,point.y,{button:'right'});await selection.waitFor({state:'hidden'});assert.equal(await form.count(),0);
  await page.mouse.click(point.x,point.y);await selection.waitFor();await page.keyboard.up('Control');await selection.waitFor({state:'hidden'});assert.equal(await page.locator('.quick-add-visual').count(),0);
  await page.keyboard.down('Control');await page.mouse.dblclick(point.x,point.y);await form.waitFor();assert.equal(await form.count(),1);assert.equal(await form.getByLabel('Start Time',{exact:true}).inputValue(),'13:00');assert.equal(await form.getByLabel('End Time',{exact:true}).inputValue(),'');
  await page.keyboard.up('Control');await form.getByLabel('Task title',{exact:true}).fill('End required');await form.getByRole('button',{name:'Create Task',exact:true}).click();assert.equal((await page.evaluate(()=>window.electronAPI.listTasks())).length,0,'missing end cannot be persisted');assert.equal(await form.isVisible(),true);
  await form.getByLabel('End Time',{exact:true}).selectOption('14:00');await form.getByRole('button',{name:'Create Task',exact:true}).click();await form.waitFor({state:'hidden'});assert.equal((await page.evaluate(()=>window.electronAPI.listTasks())).length,1);
  assert.deepEqual(errors,[]);console.log('PASS two-click creation, same-position start-only form, upward rejection and Ctrl/right-click cancellation: '+evidence);
 }catch(error){const page=app.windows()[0];if(page)await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}finally{await app.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
