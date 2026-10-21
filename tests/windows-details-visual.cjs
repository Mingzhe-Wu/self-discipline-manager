const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron } = require('playwright-core');

// The Browser plugin is unavailable; exercise the built renderer in isolated Electron.
(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/details-visual-'));
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const app = await _electron.launch({ executablePath: require('electron'), args: [path.resolve('.'), '--user-data-dir=' + path.join(evidence, 'userData')], env });
    try {
        const page = await app.firstWindow();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        const task = await page.evaluate(async () => {
            const date = new Date();
            const startDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
            const task = await window.electronAPI.createTask({ title: 'Study Algorithms', category: 'study', enabled: false, scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate, startTime: '10:50', endTime: '11:50', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [] } });
            await window.electronAPI.updateTaskOccurrenceTimes({ taskId: task.id, occurrenceId: task.currentOccurrence.id, startedAt: task.scheduledStartAt + 5 * 60000, endedAt: task.scheduledEndAt - 15 * 60000 });
            return task;
        });
        await page.reload();
        await require('./open-timetable-details.cjs')(page, task.id, task.title);
        const details = page.getByRole('dialog', { name: 'Task details', exact: true });
        const info = details.getByRole('region', { name: 'Task information', exact: true });
        const summary = details.getByRole('region', { name: 'Timing summary', exact: true });
        const timeline = details.getByRole('region', { name: 'Planned and actual timeline', exact: true });
        await info.getByRole('heading', { name: task.title, exact: true }).waitFor();
        assert.match(await info.innerText(), /Study/);
        assert.match(await summary.innerText(), /5 min late/);
        assert.match(await summary.innerText(), /15 min early/);
        assert.match(await summary.innerText(), /20 min shorter/);
        assert.equal(await summary.locator('.timing-stat').count(), 5);
        assert.equal(await info.getByRole('slider').count(), 0);
        assert.equal(await timeline.getByRole('slider').count(), 2);
        const history = details.locator('.history-disclosure');
        assert.equal(await history.count(), 0);
        const toggle = info.getByRole('switch', { name: 'Edit task information', exact: true });
        const infoBefore = await info.boundingBox();
        const toggleBox = await toggle.locator('..').boundingBox();
        assert.ok(toggleBox.x > infoBefore.x + infoBefore.width / 2, 'Edit sits at the right');
        assert.ok(toggleBox.y > infoBefore.y + infoBefore.height - 65, 'Edit sits at the bottom');
        const rangeBox = await info.locator('.actual-time-summary').boundingBox();
        const footerBox = await info.locator('.detail-edit-controls').boundingBox();
        assert.ok(footerBox.y - rangeBox.y - rangeBox.height <= 18, 'no reserved blank area above Edit');
        await toggle.check();
        await page.screenshot({ path: path.join(evidence, 'details-edit.png') });
        assert.equal(await timeline.getByRole('button', { name: 'Choose actual start time', exact: true }).isEnabled(), true);
        await toggle.uncheck();
        await info.getByRole('heading', { name: task.title, exact: true }).waitFor();
        await details.evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: path.join(evidence, 'details-desktop.png') });
        await timeline.scrollIntoViewIfNeeded();
        await timeline.screenshot({ path: path.join(evidence, 'details-timeline.png') });
        // Force a narrower detail panel without changing the app's supported window minimum.
        await details.evaluate(element => { element.style.width = '360px'; });
        assert.equal(await summary.locator('.actual-timeline-statistics').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
        assert.ok(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'narrow details has no horizontal overflow');
        for (const name of ['Choose actual start time', 'Choose actual end time']) {
            const button = timeline.getByRole('button', { name, exact: true });
            await button.click();
            const menu = timeline.getByRole('dialog', { name: name.includes('start') ? 'Actual start selection' : 'Actual end selection', exact: true });
            assert.equal(await menu.isVisible(), true);
            const box = await menu.boundingBox();
            const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
            assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height, 'time menu stays in the viewport');
            await page.keyboard.press('Escape');
        }
        await details.evaluate(element => { element.scrollTop = 0; });
        await page.screenshot({ path: path.join(evidence, 'details-narrow.png') });
        await timeline.scrollIntoViewIfNeeded();
        await timeline.screenshot({ path: path.join(evidence, 'details-timeline-narrow.png') });
        assert.deepEqual(errors, []);
        console.log('PASS details cards, Edit placement/spacing, narrow layout and time menus: ' + evidence);
    } finally {
        await app.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
