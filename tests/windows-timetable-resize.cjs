const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) { for (let n = 0; n < 160; n++) { if (await check()) return; await pause(50); } throw new Error(message); }

(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/timetable-resize-'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const board = page.getByRole('region', { name: 'Weekly schedule', exact: true });
        await board.waitFor();
        const previousDate = await board.locator('.day-column').nth(2).getAttribute('data-date');
        await page.getByRole('button', { name: 'Next week', exact: true }).click();
        await until(async () => await board.locator('.day-column').nth(2).getAttribute('data-date') !== previousDate, 'next week');
        const date = await board.locator('.day-column').nth(2).getAttribute('data-date');
        const tasks = await page.evaluate(async date => {
            const at = time => new Date(date + 'T' + time).getTime(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const add = (title, start, end) => window.electronAPI.createTask({ title, category: 'study', enabled: false, scheduleType: 'one-time', scheduledStartAt: at(start), scheduledEndAt: at(end), timeZone: zone });
            const planned = await add('Planned resize', '14:00', '15:00');
            const running = await add('Running resize', '15:30', '16:30');
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: running.id, occurrenceId: running.currentOccurrence.id, startedAt: at('15:35') + 1234, endedAt: null });
            const finished = await add('Finished resize', '17:00', '18:00');
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: finished.id, occurrenceId: finished.currentOccurrence.id, startedAt: at('17:10'), endedAt: at('17:45') });
            const recurring = await window.electronAPI.createTask({ title: 'Recurring resize', category: 'exercise', enabled: false, scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: date, startTime: '11:00', endTime: '12:00', timeZone: zone, weekdays: [] } });
            window.dispatchEvent(new Event('focus'));
            return { planned, running, finished, recurring };
        }, date);
        await board.locator(`[data-task-id="${tasks.planned.id}"]`).waitFor();
        await app.evaluate(({ ipcMain }) => {
            globalThis.__resizeCalls = 0;
            const handler = ipcMain._invokeHandlers.get('task:resize-occurrence');
            ipcMain.removeHandler('task:resize-occurrence');
            ipcMain.handle('task:resize-occurrence', (...args) => { globalThis.__resizeCalls++; return handler(...args); });
        });
        const calls = () => app.evaluate(() => globalThis.__resizeCalls);
        const read = id => page.evaluate(id => window.electronAPI.listTasks().then(tasks => tasks.find(task => task.id === id)), id);
        const card = id => board.locator(`.day-column[data-date="${date}"] [data-task-id="${id}"]`);
        const density = Number(await board.getAttribute('data-density'));
        await page.bringToFront();
        await page.mouse.click(20,25);
        await page.keyboard.down('Control');
        assert.equal(await page.locator('.quick-add-mode-label').innerText(), 'Ctrl mode active. See the instructions in the top-right corner.');
        assert.equal(await page.locator('.quick-add-visual').evaluate(element => getComputedStyle(element).backdropFilter), 'none');
        async function drag(id, edge, minutes, cancel = false) {
            const item = card(id), handle = item.locator('.timetable-resize-handle.is-' + edge);
            await item.evaluate(element => { element.closest('.week-scroll').scrollTop = element.offsetTop - 180; });
            await handle.scrollIntoViewIfNeeded();
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const before = await calls();
            const current = await read(id), state = await item.getAttribute('data-state');
            const field = edge === 'start' ? state === 'planned' ? 'scheduledStartAt' : 'startedAt' : state === 'completed' ? 'endedAt' : 'scheduledEndAt';
            const source = current.currentOccurrence[field];
            await handle.hover();
            await page.mouse.down(); await until(async () => (await item.getAttribute('class')).includes('is-resizing'), 'edge hold activated');
            const targetY = await item.evaluate((element, at) => {const date = new Date(at), board=element.closest('.week-scroll');return element.closest('.day-timeline').getBoundingClientRect().top + (date.getHours()*60+date.getMinutes()-Number(board.dataset.planningStart))*Number(board.dataset.density);}, source+minutes*60000);
            await page.mouse.move((await handle.boundingBox()).x + (await handle.boundingBox()).width / 2, targetY, { steps: 4 });
            await item.locator('.timetable-resize-preview').waitFor();
            assert.match(await page.locator('.quick-add-hint').innerText(), /Release to save.*Right-click to cancel/);
            assert.equal(await page.locator('.quick-add-guide').count(),1,'guide remains visible over a dragged card');
            assert.ok((await item.locator('.timetable-resize-preview').innerText()).endsWith(await page.locator('.quick-add-guide-time').innerText()), 'preview time equals the pointer guide');
            assert.equal(await calls(), before, 'preview does not persist');
            assert.equal(await page.getByRole('dialog', { name: 'Add Task', exact: true }).count(), 0);
            if (cancel) {
                if (cancel === 'right') { await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'}); }
                else if (cancel === 'ctrl') await page.keyboard.up('Control');
                else await page.keyboard.press('Escape');
                await page.mouse.up(); assert.equal(await calls(), before);
                if (cancel === 'ctrl') await page.keyboard.down('Control');
                return;
            }
            const guideClock = await page.locator('.quick-add-guide-time').innerText();
            await page.mouse.up();
            await until(async () => await calls() === before + 1 && await item.count() === 0 || await calls() === before + 1 && await item.getAttribute('aria-busy') === 'false', 'resize saved once');
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const saved = (await page.evaluate(()=>window.electronAPI.listTasks())).find(task=>task.currentOccurrence?.id===current.currentOccurrence.id);
            if(saved) assert.equal(new Date(saved.currentOccurrence[field]).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}), guideClock, 'saved endpoint matches guide exactly');
        }
        await drag(tasks.planned.id, 'start', 10);
        let changed = await read(tasks.planned.id);
        assert.equal(changed.scheduledStartAt, tasks.planned.scheduledStartAt + 10 * 60000);
        assert.equal(changed.currentOccurrence.startedAt, null);
        await drag(tasks.planned.id, 'end', 15);
        changed = await read(tasks.planned.id); assert.equal(changed.scheduledEndAt, tasks.planned.scheduledEndAt + 15 * 60000);
        await drag(tasks.planned.id, 'start', 10, true);
        await drag(tasks.planned.id, 'start', 10, 'right');
        await drag(tasks.planned.id, 'start', 10, 'ctrl');
        assert.equal((await read(tasks.planned.id)).scheduledStartAt, changed.scheduledStartAt);
        // A long hold without movement must not round a precise actual timestamp.
        const preciseHandle = card(tasks.running.id).locator('.timetable-resize-handle.is-start');
        await preciseHandle.scrollIntoViewIfNeeded();
        const preciseBox = await preciseHandle.boundingBox(), preciseBefore = (await read(tasks.running.id)).currentOccurrence.startedAt, holdCalls = await calls();
        await page.mouse.move(preciseBox.x + preciseBox.width / 2, preciseBox.y + preciseBox.height / 2); await page.mouse.down(); await pause(180); await page.mouse.up();
        assert.equal(await calls(), holdCalls); assert.equal((await read(tasks.running.id)).currentOccurrence.startedAt, preciseBefore);
        await drag(tasks.running.id, 'start', 5);
        changed = await read(tasks.running.id); assert.equal(changed.currentOccurrence.startedAt, tasks.running.scheduledStartAt + 10 * 60000); assert.equal(changed.scheduledStartAt, tasks.running.scheduledStartAt);
        await drag(tasks.running.id, 'end', 10);
        changed = await read(tasks.running.id); assert.equal(changed.scheduledEndAt, tasks.running.scheduledEndAt + 10 * 60000); assert.equal(changed.currentOccurrence.endedAt, null);
        await drag(tasks.finished.id, 'start', 5); await drag(tasks.finished.id, 'end', 10);
        changed = await read(tasks.finished.id); assert.equal(changed.currentOccurrence.startedAt, tasks.finished.scheduledStartAt + 15 * 60000); assert.equal(changed.currentOccurrence.endedAt, tasks.finished.scheduledStartAt + 55 * 60000); assert.equal(changed.scheduledEndAt, tasks.finished.scheduledEndAt);
        await drag(tasks.recurring.id, 'end', 15);
        const rows = await page.evaluate(() => window.electronAPI.listTasks());
        const parent = rows.find(task => task.id === tasks.recurring.id), child = rows.find(task => task.id !== parent.id && task.title === parent.title);
        assert.deepEqual(parent.recurrenceRule, tasks.recurring.recurrenceRule); assert.equal(child.scheduleType, 'one-time'); assert.equal(child.category, 'exercise'); assert.equal(child.scheduledEndAt, tasks.recurring.scheduledEndAt + 15 * 60000);
        // Released first click fixes start; second click chooses a 90-minute range.
        const day = board.locator('.day-column').nth(3), selectedDate = await day.getAttribute('data-date');
        await board.evaluate(element => { element.scrollTop = (13 * 60 - Number(element.dataset.planningStart)) * Number(element.dataset.density) - 150; });
        const point = await day.locator('.day-timeline').evaluate(element => { const box = element.getBoundingClientRect(), board = element.closest('.week-scroll'); return { x: box.x + box.width / 2, y: box.y + (13 * 60 - Number(board.dataset.planningStart)) * Number(board.dataset.density) }; });
        await page.mouse.click(point.x, point.y);
        const selection = page.locator('.quick-add-selection'); await selection.waitFor();
        await page.mouse.move(point.x, point.y + 90 * density, { steps: 5 });
        assert.match(await selection.innerText(), /13:00–14:30/);
        assert.ok(Math.abs((await selection.boundingBox()).height - 90 * density) < 2);
        assert.equal(await page.getByRole('dialog', { name: 'Add Task', exact: true }).count(), 0);
        await page.screenshot({ path: path.join(evidence, 'range-selection.png') });
        await page.mouse.click(point.x, point.y + 90 * density);
        const form = page.getByRole('dialog', { name: 'Add Task', exact: true }); await form.waitFor();
        assert.equal(await form.count(), 1); assert.equal(await form.getByLabel('Date', { exact: true }).inputValue(), selectedDate);
        assert.equal(await form.getByLabel('Start Time', { exact: true }).inputValue(), '13:00'); assert.equal(await form.getByLabel('End Time', { exact: true }).inputValue(), '14:30');
        await page.keyboard.up('Control'); await form.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.deepEqual(errors, []);
        console.log('PASS Ctrl lifecycle edge resize, cancellation, recurring detach and two-click selection: ' + evidence);
    } catch (error) {
        const page = app.windows()[0]; if (page) await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
        throw error;
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
