const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');

// Exercise the existing built renderer with an isolated database.
(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/task-center-'));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        const clock = await app.evaluate(({ ipcMain }) => {
            const value = new Date(); value.setHours(15, 17, 0, 0); const now = +value;
            Date.now = () => now;
            const create = ipcMain._invokeHandlers.get('task:create'); ipcMain.removeHandler('task:create');
            ipcMain.handle('task:create', (event, input) => {
                Date.now = () => input.scheduledStartAt ? input.scheduledStartAt - 1 : now;
                try { return create(event, input); } finally { Date.now = () => now; }
            });
            return now;
        });
        await page.clock.install({ time: new Date(clock) });
        const seeded = await page.evaluate(async now => {
            const at = (day, hour) => { const d = new Date(now); d.setDate(d.getDate() + day); d.setHours(hour, 0, 0, 0); return +d; };
            const date = day => { const d = new Date(at(day, 0)); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
            const one = (day, hour) => window.electronAPI.createTask({ title: 'Same title', category: hour === 18 ? 'exercise' : 'study', enabled: false, scheduleType: 'one-time', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, scheduledStartAt: at(day, hour), scheduledEndAt: at(day, hour + 1) });
            const series = day => window.electronAPI.createTask({ title: 'Same title', category: 'study', enabled: false, scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: date(day), startTime: '12:00', endTime: '13:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [] } });
            return { old: await one(-1, 14), today: await one(0, 14), future: await one(0, 18), nextSeries: await series(1), pastSeries: await series(-1) };
        }, clock);
        await page.reload();
        const open = () => page.getByRole('button', { name: 'Task Center', exact: true }).click();
        const center = page.getByRole('dialog', { name: 'Task Center', exact: true });
        const recurring = center.getByRole('button', { name: 'Recurring', exact: true });
        const missed = center.getByRole('button', { name: 'Missed', exact: true });
        const rows = center.locator('li');
        await open();
        await page.waitForFunction(() => document.querySelectorAll('.task-center li').length === 7);
        assert.equal(await recurring.getAttribute('aria-pressed'), 'false'); assert.equal(await missed.getAttribute('aria-pressed'), 'false');
        assert.equal(await center.locator('li strong').count(), 7, 'same titles and independent occurrence records are all retained');
        const search = center.getByRole('searchbox', { name: 'Search task names', exact: true });
        const category = center.getByRole('combobox', { name: 'Task category', exact: true });
        await search.fill('  SAME title  '); assert.equal(await rows.count(), 7);
        await search.fill('not found'); assert.equal(await rows.count(), 0); await center.getByText('No tasks match your search and filters.', { exact: true }).waitFor();
        await search.fill('same'); await category.selectOption('exercise'); assert.equal(await rows.count(), 1);
        await recurring.click(); assert.equal(await rows.count(), 0); await recurring.click(); assert.equal(await rows.count(), 1);
        await category.selectOption('other'); assert.equal(await rows.count(), 0);
        await search.fill(''); await category.selectOption('all'); assert.equal(await rows.count(), 7);
        await recurring.click(); assert.equal(await rows.count(), 2); assert.equal(await recurring.getAttribute('aria-pressed'), 'true');
        await missed.click(); assert.equal(await rows.count(), 4); assert.equal(await recurring.getAttribute('aria-pressed'), 'false'); assert.equal(await missed.getAttribute('aria-pressed'), 'true');
        await missed.click(); assert.equal(await rows.count(), 7);
        await recurring.click(); await recurring.click(); assert.equal(await rows.count(), 7);
        await center.locator(`[data-entry-kind="recurring"][data-task-id="${seeded.nextSeries.id}"] button`).click();
        const edit = page.getByRole('dialog', { name: 'Edit recurring task', exact: true });
        await edit.getByLabel('Task title', { exact: true }).waitFor();
        await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
        await center.locator(`[data-entry-kind="one-time"][data-task-id="${seeded.future.id}"] button`).click();
        const details = page.getByRole('dialog', { name: 'Task details', exact: true });
        await details.getByRole('heading', { name: 'Same title', exact: true }).waitFor();
        assert.equal(await details.locator('.missed-detail-notice').count(), 0);
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        await open(); await missed.click();
        await center.locator(`[data-entry-kind="missed"][data-task-id="${seeded.old.id}"] button`).click();
        await details.locator('.missed-detail-notice').waitFor();
        assert.equal(await details.getByRole('button', { name: 'Start late', exact: true }).count(), 0);
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        await open(); await rows.first().waitFor();
        assert.equal(await recurring.getAttribute('aria-pressed'), 'false'); assert.equal(await missed.getAttribute('aria-pressed'), 'false');
        assert.equal(await rows.count(), 7);
        await page.screenshot({ path: path.join(evidence, 'task-center-all.png') });
        assert.deepEqual(errors, []);
        console.log('PASS Task Center default/all, duplicate titles, occurrence identity, exclusive toggling and all three existing flows: ' + evidence);
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
