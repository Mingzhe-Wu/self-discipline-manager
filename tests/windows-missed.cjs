const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');

// Browser plugin is unavailable: verify the built Electron UI in an isolated profile.
(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/missed-ui-'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        const clock = await app.evaluate(({ ipcMain }) => {
            const time = new Date(); time.setHours(15, 17, 12, 345);
            const now = +time; Date.now = () => now;
            const original = ipcMain._invokeHandlers.get('task:create');
            ipcMain.removeHandler('task:create');
            ipcMain.handle('task:create', (event, input) => {
                Date.now = () => input.scheduledStartAt - 1;
                try { return original(event, input); } finally { Date.now = () => now; }
            });
            return now;
        });
        await page.clock.install({ time: new Date(clock) });
        const seeded = await page.evaluate(async now => {
            const at = (days, hour) => { const value = new Date(now); value.setDate(value.getDate() + days); value.setHours(hour, 0, 0, 0); return +value; };
            const create = (title, start, end) => window.electronAPI.createTask({ title, category: 'study', scheduleType: 'one-time', enabled: false, scheduledStartAt: start, scheduledEndAt: end, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
            const today = await create('Today missed', at(0, 14), at(0, 15));
            const old = await create('Yesterday missed', at(-1, 14), at(-1, 15));
            const future = await create('Future planned', at(0, 18), at(0, 19));
            await window.electronAPI.updatePlanningHours({ wakeTime: '08:00', sleepTime: '15:00' });
            return { today, old, future };
        }, clock);
        await page.reload();
        await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].focus(); });
        const openList = async () => { await page.getByRole('button', { name: 'Task Center', exact: true }).click(); await page.getByRole('dialog', { name: 'Task Center', exact: true }).getByRole('button', { name: 'Missed', exact: true }).click(); };
        await openList();
        const list = page.getByRole('dialog', { name: 'Task Center', exact: true });
        await list.getByRole('button', { name: /Today missed/ }).waitFor();
        assert.deepEqual(await list.locator('li strong').allTextContents(), ['📚 Today missed', '📚 Yesterday missed']);
        assert.equal(await list.getByRole('button', { name: /Future planned/ }).count(), 0);
        await list.getByRole('button', { name: /Yesterday missed/ }).click();
        const details = page.getByRole('dialog', { name: 'Task details', exact: true });
        await details.locator('.missed-detail-notice').waitFor();
        assert.equal(await details.getByRole('button', { name: 'Start late', exact: true }).count(), 0);
        assert.equal(await details.getByRole('button', { name: /Choose actual .* time/ }).count(), 2);
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        await openList();
        await list.getByRole('button', { name: /Today missed/ }).click();
        await details.getByRole('button', { name: 'Start late', exact: true }).click();
        await page.locator('.app-toast').filter({ hasText: 'New task started late' }).waitFor();
        const rows = await page.evaluate(() => window.electronAPI.listTasks());
        const late = rows.find(row => ![seeded.today.id, seeded.old.id, seeded.future.id].includes(row.id));
        assert.ok(late);
        assert.equal(late.currentOccurrence.startedAt, clock);
        assert.equal(late.scheduledEndAt - late.scheduledStartAt, 3600000);
        assert.equal(new Date(late.scheduledStartAt).getMinutes(), 15);
        assert.deepEqual(rows.find(row => row.id === seeded.today.id).currentOccurrence, seeded.today.currentOccurrence);
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        const board = page.getByRole('region', { name: 'Weekly schedule', exact: true });
        await board.locator(`[data-task-id="${late.id}"][data-state="in-progress"]`).waitFor();
        assert.equal(await board.locator(`[data-task-id="${seeded.today.id}"]`).getAttribute('data-state'), 'missed');
        assert.ok(Number(await board.getAttribute('data-planning-end')) >= 19 * 60, 'outside-preference task expands the timetable');
        await require('./open-timetable-details.cjs')(page, seeded.today.id, 'Today missed');
        await details.locator('.missed-detail-notice').waitFor();
        assert.equal((await page.evaluate(() => window.electronAPI.listTasks())).length, 4, 'opening the original does not late-start again');
        await page.screenshot({ path: path.join(evidence, 'missed-details.png') });
        assert.deepEqual(errors, []);
        console.log('PASS Missed list/order/details, explicit Late Start, preserved original, new running task and expanded display: ' + evidence);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

