const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { _electron } = require('playwright-core');
const until = async (check, message) => { for (let n = 0; n < 120; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error(message); };

(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/clock-time-'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow();
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        const add = page.getByRole('dialog', { name: 'Add Task', exact: true });
        assert.equal(await add.getByLabel('Start Time hour', { exact: true }).locator('option:not([value=""])').count(), 24);
        assert.equal(await add.getByLabel('Start Time minute', { exact: true }).locator('option:not([value=""])').count(), 12);
        for (const field of ['Start Time hour', 'Start Time minute', 'End Time hour', 'End Time minute']) {
            assert.equal(await add.getByLabel(field, { exact: true }).inputValue(), '');
        }
        const width = await add.getByLabel('Start Time hour', { exact: true }).evaluate(node => node.getBoundingClientRect().width);
        assert.ok(width < 100, 'clock controls remain compact');
        const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(12, 10, 0, 0);
        const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        await add.getByLabel('Date', { exact: true }).fill(dateText);
        await add.getByLabel('Task title', { exact: true }).fill('Split clock');
        await add.getByLabel('Start Time hour', { exact: true }).selectOption('12');
        assert.equal(await add.getByLabel('Start Time minute', { exact: true }).inputValue(), '');
        await add.getByLabel('Start Time minute', { exact: true }).selectOption('10');
        assert.equal(await add.getByLabel('End Time hour', { exact: true }).inputValue(), '');
        assert.equal(await add.getByLabel('End Time minute', { exact: true }).inputValue(), '');
        await add.getByLabel('End Time hour', { exact: true }).selectOption('13');
        await add.getByLabel('End Time minute', { exact: true }).selectOption('40');
        await add.getByLabel('Start Time hour', { exact: true }).selectOption('');
        assert.equal(await add.locator('option').filter({ hasText: 'NaN' }).count(), 0);
        assert.equal(await add.getByLabel('End Time hour', { exact: true }).inputValue(), '13');
        await add.getByLabel('Start Time hour', { exact: true }).selectOption('12');
        await add.getByRole('button', { name: 'Create Task', exact: true }).click();
        await add.waitFor({ state: 'hidden' });
        let task = await page.evaluate(() => window.electronAPI.listTasks().then(rows => rows.find(task => task.title === 'Split clock')));
        assert.equal(task.scheduledStartAt, +date); assert.equal(task.scheduledEndAt, +date + 90 * 60000);
        const exactEnd = +date + 37 * 60000 + 22123;
        task = await page.evaluate(async ({ id, start, end }) => {
            const task = (await window.electronAPI.listTasks()).find(task => task.id === id);
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: id, occurrenceId: task.currentOccurrence.id, startedAt: start, endedAt: end });
            return (await window.electronAPI.listTasks()).find(task => task.id === id);
        }, { id: task.id, start: +date + 2 * 60000 + 17123, end: exactEnd });
        await app.evaluate(({ BrowserWindow }, task) => BrowserWindow.getAllWindows()[0].webContents.send('task:open-details', { task, occurrence: { taskId: task.id, scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt, record: task.currentOccurrence } }), task);
        const details = page.getByRole('dialog', { name: 'Task details', exact: true }); await details.waitFor();
        await details.getByRole('button', { name: 'Choose actual start time', exact: true }).click();
        const minute = details.getByLabel('Actual start minute', { exact: true });
        assert.ok((await minute.locator('option').count()) <= 14);
        assert.ok((await minute.locator('option:checked').innerText()).includes('saved precise time'));
        await minute.selectOption(String(+date + 5 * 60000));
        const record = () => page.evaluate(id => window.electronAPI.listTasks().then(rows => rows.find(task => task.id === id).currentOccurrence), task.id);
        await until(async () => (await record()).startedAt === +date + 5 * 60000, 'minute selection persists');
        assert.equal((await record()).endedAt, exactEnd, 'untouched endpoint retains exact seconds');
        assert.equal(await details.getByRole('slider', { name: 'Actual start drag handle', exact: true }).getAttribute('aria-valuenow'), String(+date + 5 * 60000));
        await page.keyboard.press('Escape');
        await details.getByRole('button', { name: 'Choose actual end time', exact: true }).click();
        await details.getByLabel('Actual end hour', { exact: true }).selectOption('13');
        await until(async () => new Date((await record()).endedAt).getHours() === 13, 'hour selection persists');
        const end = new Date(+date); end.setHours(13, 5, 0, 0);
        await details.getByLabel('Actual end minute', { exact: true }).selectOption(String(+end));
        await until(async () => (await record()).endedAt === +end, 'end minute persists');
        await page.screenshot({ path: path.join(evidence, 'split-time.png') });
        console.log('PASS split hour/minute creation, actual precision, persistence and timeline synchronization: ' + evidence);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
