const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');

// Exercise the series editor in an isolated profile, never the user's database.
(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/recurring-editor-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow();
        await page.getByRole('button', { name: 'Manage recurring tasks', exact: true }).waitFor();
        const task = await page.evaluate(async () => {
            const task = await window.electronAPI.createTask({ title: 'Series editor', category: 'study', scheduleType: 'recurring', enabled: false, recurrenceRule: { frequency: 'weekly', startDate: '2026-10-19', startTime: '10:00', endTime: '11:00', timeZone: 'UTC', weekdays: [1, 3] } });
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: task.id, occurrenceId: task.currentOccurrence.id, startedAt: task.scheduledStartAt + 300000, endedAt: task.scheduledEndAt - 300000 });
            return { ...task, currentOccurrence: (await window.electronAPI.listTasks()).find(row => row.id === task.id).currentOccurrence };
        });
        await page.reload();
        await page.getByRole('button', { name: 'Manage recurring tasks', exact: true }).click();
        await page.locator('.task-picker').getByRole('button', { name: task.title, exact: true }).click();
        const editor = page.getByRole('dialog', { name: 'Edit recurring task', exact: true });
        await editor.waitFor({ timeout: 5000 });
        assert.equal(await editor.getByLabel('Task title', { exact: true }).inputValue(), task.title);
        assert.equal(await editor.getByLabel('Start Time', { exact: true }).inputValue(), '10:00');
        assert.equal(await editor.getByLabel('End Time', { exact: true }).inputValue(), '11:00');
        assert.equal(await editor.getByRole('slider').count(), 0);
        assert.equal(await editor.getByRole('switch').count(), 0);
        await editor.getByLabel('Task title', { exact: true }).fill('Updated series');
        await editor.getByLabel('Category', { exact: true }).selectOption('work');
        await editor.getByLabel('Start Time', { exact: true }).selectOption('12:00');
        await editor.getByLabel('End Time', { exact: true }).selectOption('13:00');
        await editor.getByRole('button', { name: 'Save Task', exact: true }).click();
        const manager = page.getByRole('dialog', { name: 'Manage recurring tasks', exact: true });
        await manager.getByRole('button', { name: 'Updated series', exact: true }).waitFor();
        const saved = await page.evaluate(async id => (await window.electronAPI.listTasks()).find(task => task.id === id), task.id);
        assert.equal(saved.category, 'work');
        assert.equal(saved.recurrenceRule.startTime, '12:00');
        assert.equal(saved.recurrenceRule.endTime, '13:00');
        const history = await page.evaluate(task => window.electronAPI.listTaskOccurrences(task.id, task.currentOccurrence.scheduledStartAt - 1, task.currentOccurrence.scheduledEndAt + 1), task);
        const original = history.find(row => row.id === task.currentOccurrence.id);
        assert.ok(original, 'series editing preserves the historical occurrence');
        assert.equal(original.startedAt, task.scheduledStartAt + 300000);
        assert.equal(original.endedAt, task.scheduledEndAt - 300000);
        assert.equal(original.scheduledStartAt, task.currentOccurrence.scheduledStartAt);
        assert.equal(original.scheduledEndAt, task.currentOccurrence.scheduledEndAt);
        await manager.getByRole('button', { name: 'Updated series', exact: true }).click();
        await editor.getByLabel('Task title', { exact: true }).fill('Unsaved draft');
        await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
        await manager.getByRole('button', { name: 'Updated series', exact: true }).waitFor();
        console.log('Recurring series editor: prefill, explicit save, return to list and cancel passed.');
    } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

