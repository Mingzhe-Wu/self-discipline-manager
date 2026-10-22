const { clockField } = require('./clock-field.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

async function waitFor(check, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error(`Condition did not become true within ${timeout}ms`);
}

async function main() {
    const executable = path.resolve(process.argv[2] || 'release/installed-test/Self Discipline Manager.exe');
    assert.ok(fs.existsSync(executable), 'Install the NSIS build before running this check');
    const evidenceRoot = path.resolve('release/verification');
    fs.mkdirSync(evidenceRoot, { recursive: true });
    const evidence = fs.mkdtempSync(path.join(evidenceRoot, 'installed-'));
    const userData = path.join(evidence, 'userData');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_RENDERER_URL;
    const launch = () => electron.launch({ executablePath: executable, args: [`--user-data-dir=${userData}`], cwd: evidence, env });
    const report = { executable, userData, evidence, checks: [], nativeToast: 'not visually verified' };
    let application;
    try {
        application = await launch();
        let page = await application.firstWindow();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        assert.equal(await page.title(), 'Self Discipline Manager');
        assert.ok(page.url().includes('app.asar/out/renderer/index.html'));
        const runtime = await application.evaluate(async ({ app, BrowserWindow, Tray, Notification }) => {
            // Deterministic fixture clock only in this isolated app process. The
            // renderer keeps real time for current-time positioning checks.
            globalThis.__fixtureRealNow = Date.now;
            const fixtureDay = new Date(); fixtureDay.setHours(0, 0, 0, 0);
            Date.now = () => fixtureDay.getTime();
            const { createRequire } = process.getBuiltinModule('node:module');
            const { queryObjects } = process.getBuiltinModule('node:v8');
            const requireApp = createRequire(app.getAppPath() + '/package.json');
            const Database = requireApp('better-sqlite3');
            const db = new Database(app.getPath('userData') + '/data.db', { readonly: true });
            const migrations = db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get().count;
            db.close();
            globalThis.__installedCheck = { attempts: 0, shows: 0, failures: [], bodies: [] };
            const originalShow = Notification.prototype.show;
            Notification.prototype.show = function () {
                globalThis.__installedCheck.attempts++;
                globalThis.__installedCheck.bodies.push(this.body);
                this.once('show', () => globalThis.__installedCheck.shows++);
                this.once('failed', (_event, error) => globalThis.__installedCheck.failures.push(error));
                return originalShow.call(this);
            };
            return {
                packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData'),
                versions: process.versions, arch: process.arch, migrations,
                nativeModules: Object.keys(requireApp.cache).filter((filename) => filename.endsWith('.node')),
                trayCount: queryObjects(Tray),
                preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
            };
        });
        assert.equal(runtime.packaged, true);
        assert.equal(path.resolve(runtime.userData), userData);
        assert.ok(runtime.appPath.startsWith(path.dirname(executable)));
        assert.equal(runtime.arch, 'x64');
        assert.equal(runtime.migrations, 7);
        assert.ok(runtime.nativeModules.some((filename) => filename.startsWith(runtime.appPath) && /win32-x64\.node$/.test(filename)));
        assert.ok(runtime.trayCount >= 1);
        assert.equal(runtime.preferences.contextIsolation, true);
        assert.equal(runtime.preferences.nodeIntegration, false);
        assert.ok(fs.existsSync(path.join(userData, 'data.db')));
        report.runtime = runtime;
        report.checks.push('installed ASAR renderer/preload/resources/native SQLite/migrations/tray load');
        console.log('PASS: installed app loads its ASAR and native SQLite without repository dependencies.');

        const bridge = await page.evaluate(() => ({ require: typeof window.require, process: typeof window.process, keys: Object.keys(window.electronAPI).sort() }));
        assert.equal(bridge.require, 'undefined');
        assert.equal(bridge.process, 'undefined');
        assert.deepEqual(bridge.keys, ['createTask', 'deleteTask', 'endTaskOccurrence', 'getPlanningHours', 'getWeekSchedule', 'listTaskOccurrences', 'listTasks', 'onWindowShown', 'setTaskEnabled', 'startTaskOccurrence', 'updatePlanningHours', 'updateTask', 'updateTaskOccurrencePlan', 'updateTaskOccurrenceTimes'].sort());
        assert.ok(!bridge.keys.some((key) => key.toLowerCase().includes('reminder')));
        const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
        assert.ok(csp.includes("script-src 'self'"));
        assert.ok(!csp.includes('unsafe-inline'));
        assert.ok(!csp.includes('unsafe-eval'));
        const originalUrl = page.url();
        await page.evaluate(() => {
            const link = document.createElement('a');
            link.href = 'https://example.com/';
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.open('https://example.com/');
        });
        assert.equal(page.url(), originalUrl);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        report.checks.push('narrow preload, Node isolation, production CSP, navigation/popup denial');
        // Reset Playwright's navigation barrier after Electron cancels the link.
        await page.reload();
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();

        await application.evaluate(({ ipcMain }) => {
            globalThis.__weekUIHandler = ipcMain._invokeHandlers.get('task:week');
            ipcMain.removeHandler('task:week');
            ipcMain.handle('task:week', async (event, ...args) => {
                await new Promise((resolve) => setTimeout(resolve, 750));
                return globalThis.__weekUIHandler(event, ...args);
            });
        });
        await page.reload();
        await page.getByText('Loading your week…', { exact: true }).waitFor();
        await page.screenshot({ path: path.join(evidence, 'loading-state.png') });
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        await page.screenshot({ path: path.join(evidence, 'empty-state.png') });
        await application.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('task:week');
            ipcMain.handle('task:week', () => { throw new Error('Task list is temporarily unavailable.'); });
        });
        await page.getByRole('button', { name: 'Next week', exact: true }).click();
        await page.getByRole('alert').waitFor();
        await page.screenshot({ path: path.join(evidence, 'error-state.png') });
        await application.evaluate(({ ipcMain }) => {
            ipcMain.removeHandler('task:week');
            ipcMain.handle('task:week', globalThis.__weekUIHandler);
            delete globalThis.__weekUIHandler;
        });
        await page.getByRole('button', { name: 'Try again', exact: true }).click();
        await page.getByRole('alert').waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'This week', exact: true }).click();
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        report.checks.push('intentional loading/empty/error states and retry recovery');

        const dates = await page.evaluate(() => {
            const pad = (value) => String(value).padStart(2, '0');
            const key = (date) => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
            const date = new Date();
            const past = new Date(); past.setDate(past.getDate() - 2);
            const monday = new Date(); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
            return { today: key(date), past: key(past), monday: key(monday) };
        });
        const board = page.getByRole('region', { name: 'Weekly schedule', exact: true });
        async function density() {
            const metrics = await board.evaluate((element) => ({ density: Number(element.dataset.density), height: element.clientHeight }));
            assert.ok(Math.abs(metrics.density - Math.max(0.25, (metrics.height - 76 - 16) / 600)) < 0.001, 'ten planned hours fit the usable board height');
            return metrics.density;
        }
        async function scrollToMinute(minute) {
            await board.evaluate((element, value) => { element.scrollTop = (value - Number(element.dataset.planningStart)) * Number(element.dataset.density); }, minute);
        }
        async function verifyGeometry(card, startMinute, duration) {
            const scale = await density();
            const origin = Number(await board.getAttribute('data-planning-start'));
            const geometry = await card.evaluate((element) => ({ top: parseFloat(element.style.top), height: parseFloat(element.style.height), plannedHeight: Number(element.dataset.plannedHeight) }));
            assert.ok(Math.abs(geometry.top - (startMinute - origin) * scale) < 0.001);
            assert.ok(Math.abs(geometry.height - Math.max(Math.max(duration, 15) * scale, 1)) < 0.001, 'short ranges have a fifteen-minute visual floor');
            assert.ok(Math.abs(geometry.plannedHeight - duration * scale) < 0.001, 'true planned duration stays separate from the visual floor');
        }
        async function hoverCard(card) {
            await card.hover({ position: { x: 3, y: Math.min(4, (await card.boundingBox()).height / 2) } });
        }
        assert.deepEqual(await page.evaluate(() => window.electronAPI.getPlanningHours()), { wakeTime: '00:00', sleepTime: '24:00' });
        assert.equal(await board.getAttribute('data-planning-start'), '0');
        await density();
        assert.equal(await board.locator('.day-column').count(), 7);
        assert.equal(await board.locator('[aria-current="date"]').getAttribute('data-date'), dates.today);
        await page.getByRole('button', { name: 'This week', exact: true }).click();
        await board.waitFor();
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        const addDialog = page.getByRole('dialog', { name: 'Add Task', exact: true });
        await addDialog.waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Task title');
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Shift+Tab');
        assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true);
        await page.keyboard.press('Escape');
        await addDialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Add Task');
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        await addDialog.getByLabel('Task title', { exact: true }).fill('Discarded draft');
        await addDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.equal((await page.evaluate(() => window.electronAPI.listTasks())).length, 0);
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        await page.getByLabel('Task title', { exact: true }).fill('Installed one-time task');
        await page.getByLabel('Date', { exact: true }).fill(dates.today);
        await clockField(page, 'Start Time').selectOption('12:00');
        await clockField(page, 'End Time').selectOption('12:30');
        await page.getByLabel('Notifications enabled', { exact: true }).uncheck();
        await page.screenshot({ path: path.join(evidence, 'add-task.png') });
        // The form also rejects past one-time plans. Freeze only this submit;
        // keep the renderer's real clock for the rest of the timetable checks.
        await page.evaluate(() => { globalThis.__fixtureRealNow = Date.now; const day = new Date(); day.setHours(0, 0, 0, 0); Date.now = () => day.getTime(); });
        await page.getByRole('button', { name: 'Create Task', exact: true }).click();
        await board.getByRole('heading', { name: 'Installed one-time task', exact: true }).waitFor();
        await page.evaluate(() => { Date.now = globalThis.__fixtureRealNow; delete globalThis.__fixtureRealNow; });
        const oneTime = (await page.evaluate(() => window.electronAPI.listTasks()))[0];
        await page.evaluate(async (task) => {
            for (let index = 1; index <= 3; index++) await window.electronAPI.createTask({
                title: 'Overlap geometry check ' + index, scheduleType: 'one-time', enabled: false,
                scheduledStartAt: task.scheduledStartAt + (index === 3 ? 5 : 0) * 60000,
                scheduledEndAt: task.scheduledEndAt + (index === 3 ? 10 : index * 5) * 60000, timeZone: task.timeZone,
            });
        }, oneTime);
        await page.reload(); await board.waitFor();
        const oneCard = board.locator(`[data-task-id="${oneTime.id}"]`);
        async function verifyAffordance(card, state, action, title) {
            await card.locator('.card-primary-button').evaluate((button) => button.blur());
            await page.mouse.move(10, 70);
            assert.equal(await card.locator('.card-action-hint').isVisible(), false);
            const geometry = await card.evaluate((element) => [element.style.top, element.style.height]);
            const color = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
            assert.equal(color, { planned: 'rgb(241, 243, 245)', 'in-progress': 'rgb(232, 239, 246)', completed: 'rgb(237, 244, 239)' }[state]);
            const before = await page.evaluate(async (id) => (await window.electronAPI.listTasks()).find((task) => task.id === id).currentOccurrence, Number(await card.getAttribute('data-task-id')));
            await hoverCard(card);
            await card.getByText('[ ' + { Start: '▶', End: '■', Reset: '↺' }[action] + ' ' + action + ' ]', { exact: true }).waitFor();
            const tiny = await card.evaluate((element) => element.classList.contains('is-tiny'));
            if (tiny) {
                const preview = await card.locator('.card-content').boundingBox();
                const capsule = await card.boundingBox();
                assert.ok(Math.abs(preview.height - 120) < 1, 'tiny cards expose the full replacement action surface');
                const heading = await card.locator('xpath=ancestor::section[1]').locator('h2').boundingBox();
                assert.ok(preview.y >= heading.y + heading.height, 'replacement surface avoids the sticky day heading');
                assert.ok(preview.y <= capsule.y + capsule.height, 'replacement surface stays connected to its planned capsule');
                assert.ok((await card.locator('.card-primary-button').boundingBox()).height >= 24);
            }
            assert.equal(await card.getByRole('heading', { name: title, exact: true }).isVisible(), true);
            assert.equal(await card.locator('.lifecycle-status').isVisible(), true);
            assert.equal(await card.locator('time').isVisible(), true);
            assert.ok(await card.locator('h3').evaluate((element) => parseFloat(getComputedStyle(element).paddingRight) >= 24));
            assert.equal(await card.locator('.card-primary-button').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
            assert.deepEqual(await card.evaluate((element) => [element.style.top, element.style.height]), geometry);
            assert.deepEqual(await page.evaluate(async (id) => (await window.electronAPI.listTasks()).find((task) => task.id === id).currentOccurrence, Number(await card.getAttribute('data-task-id'))), before, 'hover never changes occurrence data');
            assert.equal(await card.locator('.card-action-label').evaluate((element) => getComputedStyle(element).borderStyle), 'solid', 'action appears as a pressable surface');
            assert.equal(await card.locator('.card-action-label').evaluate((element) => element.scrollWidth <= element.clientWidth), true, 'complete action fits');
            await page.screenshot({ path: path.join(evidence, 'card-affordance-' + state + '.png') });
            const raisedShadow = await card.locator('.card-content').evaluate((element) => getComputedStyle(element).boxShadow);
            await page.mouse.down();
            await waitFor(async () => await card.locator('.card-action-label').evaluate((element) => getComputedStyle(element).backgroundColor) === 'rgb(228, 234, 241)');
            assert.notEqual(await card.locator('.card-content').evaluate((element) => getComputedStyle(element).boxShadow), raisedShadow, 'press gives inset feedback');
            assert.deepEqual(await card.evaluate((element) => [element.style.top, element.style.height]), geometry);
            await page.mouse.move(10, 70); await page.mouse.up();
            assert.deepEqual(await page.evaluate(async (id) => (await window.electronAPI.listTasks()).find((task) => task.id === id).currentOccurrence, Number(await card.getAttribute('data-task-id'))), before, 'press-drag away cancels without lifecycle change');
            await hoverCard(card);
            const detailsButton = card.getByRole('button', { name: 'Details for ' + title, exact: true });
            await detailsButton.hover();
            const detailsBox = await detailsButton.boundingBox();
            assert.ok(detailsBox.width >= 28 && detailsBox.height >= 28, 'details action has a twenty-eight-pixel target');
            assert.equal(await card.locator('.card-action-hint').isVisible(), true, 'expanded details retains the separate lower action region');
            assert.equal(await detailsButton.isVisible(), true);
            await page.mouse.move(10, 70);
            await card.locator('.card-primary-button').focus();
            await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
            await card.getByText('[ ' + { Start: '▶', End: '■', Reset: '↺' }[action] + ' ' + action + ' ]', { exact: true }).waitFor();
            await card.locator('.card-primary-button').evaluate((button) => button.blur());
            await page.mouse.move(10, 70);
        }

        assert.equal(await oneCard.getAttribute('data-overlap-count'), '4');
        await verifyGeometry(oneCard, 12 * 60, 30);
        assert.equal(await oneCard.locator('xpath=ancestor::*[@data-date][1]').getAttribute('data-date'), dates.today);
        await scrollToMinute(10 * 60 + 30);
        await oneCard.scrollIntoViewIfNeeded();
        await page.mouse.move(10, 70);
        await verifyAffordance(oneCard, 'planned', 'Start', 'Installed one-time task');
        const beforeHover = await oneCard.boundingBox();
        const usableWidth = await oneCard.locator('xpath=..').evaluate((element) => element.clientWidth - 10);
        assert.ok(Math.abs(beforeHover.width - usableWidth / (1 + .62 * 3)) < 1);
        const defaultZ = await oneCard.evaluate((card) => getComputedStyle(card).zIndex);
        assert.equal(await oneCard.locator('time').isVisible(), false);
        assert.equal(await oneCard.locator('.lifecycle-status').isVisible(), false);
        assert.equal(await oneCard.getByRole('button', { name: 'Details for Installed one-time task', exact: true }).isVisible(), false);
        await oneCard.hover({ position: { x: 2, y: 4 } });
        assert.equal(await oneCard.evaluate((card) => getComputedStyle(card).zIndex), "10000");
        assert.equal(await oneCard.evaluate((card) => getComputedStyle(card).cursor), "pointer");
        const afterHover = await oneCard.boundingBox();
        assert.equal(afterHover.y, beforeHover.y); assert.equal(afterHover.height, beforeHover.height);
        assert.ok(Math.abs(afterHover.width - usableWidth) < 1, 'hover resizes the whole capsule to the usable day width');
        assert.equal(await oneCard.locator('time').isVisible(), true);
        assert.equal(await oneCard.getByText('[ ▶ Start ]', { exact: true }).isVisible(), true);
        assert.equal(await oneCard.getByRole('button', { name: 'Details for Installed one-time task', exact: true }).isVisible(), true);
        await page.mouse.move(10, 70);
        assert.deepEqual(await oneCard.boundingBox(), beforeHover, 'mouse leave restores deterministic staggered geometry');
        assert.equal(await oneCard.evaluate((card) => getComputedStyle(card).zIndex), defaultZ);
        assert.equal(await oneCard.locator('time').isVisible(), false);
        await board.focus(); await page.keyboard.press('Tab');
        assert.equal(await oneCard.evaluate((card) => document.activeElement === card.querySelector('.card-primary-button')), true);
        await page.keyboard.press('Tab');
        const keyboardStart = oneCard.getByRole('button', { name: 'Details for Installed one-time task', exact: true });
        assert.equal(await keyboardStart.isVisible(), true, 'Tab into a grouped action must retain full capsule content');
        assert.equal(await keyboardStart.evaluate((button) => document.activeElement === button), true);
        await oneCard.hover({ position: { x: 2, y: 4 } });
        await page.mouse.move(10, 70);
        assert.equal(await oneCard.locator('time').isVisible(), false, 'mouse leave must restore compact mode even after keyboard focus');
        assert.equal(await oneCard.evaluate((card) => getComputedStyle(card).zIndex), defaultZ);
        const cardDetails = page.getByRole('dialog', { name: 'Task details', exact: true });
        await oneCard.hover({ position: { x: 2, y: 4 } });
        await oneCard.getByRole('button', { name: 'Details for Installed one-time task', exact: true }).click();
        await cardDetails.waitFor();
        assert.equal((await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence)).startedAt, null, 'details does not start');
        await cardDetails.getByRole('button', { name: 'Close details', exact: true }).click();
        await page.mouse.move(10, 70);
        await oneCard.click({ position: { x: 3, y: 6 } });
        await waitFor(async () => await oneCard.getAttribute('data-state') === 'in-progress');
        assert.equal(await cardDetails.isVisible(), false);
        await verifyAffordance(oneCard, 'in-progress', 'End', 'Installed one-time task');
        const running = await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence);
        assert.ok(running.startedAt !== null && running.endedAt === null);
        await oneCard.locator('.card-primary-button').focus(); await page.keyboard.press('Space');
        await waitFor(async () => await oneCard.getAttribute('data-state') === 'completed');
        await verifyAffordance(oneCard, 'completed', 'Reset', 'Installed one-time task');
        const finished = await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence);
        await oneCard.click({ position: { x: 3, y: 6 } });
        const resetDialog = page.getByRole('dialog', { name: 'Reset task?', exact: true });
        await resetDialog.waitFor();
        await resetDialog.getByText('This clears the actual start and end times. The planned schedule will stay unchanged.', { exact: true }).waitFor();
        assert.equal(await resetDialog.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => el === document.activeElement), true);
        await resetDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        assert.deepEqual(await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence), finished, 'cancel preserves all occurrence fields');
        await oneCard.locator('.card-primary-button').focus(); await page.keyboard.press('Enter');
        await resetDialog.getByRole('button', { name: 'Reset task', exact: true }).click();
        await resetDialog.waitFor({ state: 'hidden' });
        const resetRecord = await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence);
        assert.equal(resetRecord.startedAt, null); assert.equal(resetRecord.endedAt, null);
        for (const key of ['id', 'taskId', 'scheduledStartAt', 'scheduledEndAt']) assert.equal(resetRecord[key], finished[key]);
        assert.equal(await oneCard.getAttribute('aria-label'), 'Start Installed one-time task');
        await oneCard.dblclick({ position: { x: 3, y: 6 } });
        await waitFor(async () => await oneCard.getAttribute('data-state') === 'in-progress');
        assert.equal((await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence)).endedAt, null, 'double-click does not advance twice');
        await oneCard.locator('.card-primary-button').focus(); await page.keyboard.press('Enter');
        await waitFor(async () => await oneCard.getAttribute('data-state') === 'completed');
        const ended = await page.evaluate(async () => (await window.electronAPI.listTasks())[0].currentOccurrence);
        assert.ok(ended.endedAt >= ended.startedAt);
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        await page.getByLabel('Task title', { exact: true }).fill('Installed daily task');
        await page.getByLabel('Schedule type', { exact: true }).selectOption('recurring');
        await page.getByLabel('Start date', { exact: true }).fill(dates.past);
        await clockField(page, 'Start Time').selectOption('00:00');
        await clockField(page, 'End Time').selectOption('00:30');
        await page.getByLabel('Notifications enabled', { exact: true }).uncheck();
        await page.getByRole('button', { name: 'Create Task', exact: true }).click();
        await board.getByRole('heading', { name: 'Installed daily task', exact: true }).first().waitFor();
        const daily = await page.evaluate(async () => (await window.electronAPI.listTasks()).find((task) => task.title === 'Installed daily task'));
        const todayCard = board.locator(`[data-date="${dates.today}"] [data-task-id="${daily.id}"]`);
        await todayCard.click({ position: { x: 3, y: 6 } });
        await waitFor(async () => await todayCard.getAttribute('data-state') === 'in-progress');
        await todayCard.locator('.card-primary-button').focus(); await page.keyboard.press('Enter');
        await waitFor(async () => await todayCard.getAttribute('data-state') === 'completed');
        assert.ok(!/recorded at|migration|time zone|source:/i.test(await board.innerText()));
        await todayCard.getByRole('button', { name: 'Details for Installed daily task', exact: true }).click();
        const details = page.getByRole('dialog', { name: 'Task details', exact: true });
        assert.equal(await details.getByText('History uses local date ranges.', { exact: false }).count(), 0);
        await details.locator('.history-disclosure > summary').click();
        await details.getByText('Planned / not started', { exact: false }).first().waitFor();
        const history = await page.evaluate(async (id) => window.electronAPI.listTaskOccurrences(id, Date.now() - 4 * 86400000, Date.now() + 1), daily.id);
        const missed = history.find((occurrence) => occurrence.recordedAt === null);
        const missedRow = details.locator(`[data-occurrence-id="${missed.id}"]`);
        await missedRow.getByLabel('Start time (local)', { exact: true }).fill(`${dates.past}T07:00`);
        await missedRow.getByLabel('End time (local)', { exact: true }).fill(`${dates.past}T07:30`);
        await missedRow.getByRole('button', { name: 'Save backfill', exact: true }).click();
        await missedRow.getByRole('button', { name: 'Save correction', exact: true }).waitFor();
        // Seed seconds/milliseconds as a normal Start/End would, then correct only End in the minute editor.
        await page.evaluate(async ({ id, occurrenceId, date }) => window.electronAPI.updateTaskOccurrenceTimes({ taskId: id, occurrenceId, startedAt: new Date(date + 'T07:00:12.345').getTime(), endedAt: new Date(date + 'T07:30:23.456').getTime() }), { id: daily.id, occurrenceId: missed.id, date: dates.past });
        await details.locator('.history-disclosure > summary').click();
        await details.locator('.history-disclosure > summary').click();
        await missedRow.getByRole('button', { name: 'Save correction', exact: true }).waitFor();
        const originalRecord = await page.evaluate(async ({ id, occurrenceId }) => (await window.electronAPI.listTaskOccurrences(id, Date.now() - 4 * 86400000, Date.now() + 1)).find((row) => row.id === occurrenceId), { id: daily.id, occurrenceId: missed.id });
        await missedRow.getByLabel('End time (local)', { exact: true }).fill(`${dates.past}T08:30`);
        await missedRow.getByRole('button', { name: 'Save correction', exact: true }).click();
        await waitFor(async () => {
            const corrected = await page.evaluate(async ({ id, occurrenceId }) => (await window.electronAPI.listTaskOccurrences(id, Date.now() - 4 * 86400000, Date.now() + 1)).find((row) => row.id === occurrenceId), { id: daily.id, occurrenceId: missed.id });
            return corrected.endedAt !== originalRecord.endedAt && corrected.startedAt === originalRecord.startedAt && corrected.recordedAt === originalRecord.recordedAt && corrected.progressSource === 'corrected';
        });
        await missedRow.getByRole('button', { name: 'Clear times', exact: true }).click();
        await missedRow.getByRole('button', { name: 'Save backfill', exact: true }).waitFor();
        const clearedRecord = await page.evaluate(async ({ id, occurrenceId }) => (await window.electronAPI.listTaskOccurrences(id, Date.now() - 4 * 86400000, Date.now() + 1)).find((row) => row.id === occurrenceId), { id: daily.id, occurrenceId: missed.id });
        assert.equal(clearedRecord.startedAt, null);
        assert.equal(clearedRecord.endedAt, null);
        assert.equal(clearedRecord.recordedAt, originalRecord.recordedAt);
        await missedRow.getByLabel('Start time (local)', { exact: true }).fill(dates.past + 'T07:00');
        await missedRow.getByLabel('End time (local)', { exact: true }).fill(dates.past + 'T08:30');
        await missedRow.getByRole('button', { name: 'Save backfill', exact: true }).click();
        await missedRow.getByRole('button', { name: 'Save correction', exact: true }).waitFor();
        await page.screenshot({ path: path.join(evidence, 'task-history.png') });
        await details.getByRole('button', { name: 'Edit planned task', exact: true }).click();
        const editDialog = page.getByRole('dialog', { name: 'Edit Task', exact: true });
        await editDialog.getByLabel('Task title', { exact: true }).fill('Edited daily task');
        await clockField(editDialog, 'Start Time').selectOption('10:00');
        await clockField(editDialog, 'End Time').selectOption('10:30');
        await application.evaluate(({ ipcMain }) => {
            globalThis.__slowEditHandler = ipcMain._invokeHandlers.get('task:update-occurrence-plan');
            ipcMain.removeHandler('task:update-occurrence-plan');
            ipcMain.handle('task:update-occurrence-plan', async (event, ...args) => {
                await new Promise((resolve) => setTimeout(resolve, 650));
                return globalThis.__slowEditHandler(event, ...args);
            });
        });
        await editDialog.getByRole('button', { name: 'Save Task', exact: true }).click();
        await page.keyboard.press('Escape');
        assert.equal(await editDialog.isVisible(), true);
        assert.equal(await editDialog.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
        await page.getByText('Task saved.', { exact: true }).waitFor();
        await application.evaluate(({ ipcMain }) => { ipcMain.removeHandler('task:update-occurrence-plan'); ipcMain.handle('task:update-occurrence-plan', globalThis.__slowEditHandler); delete globalThis.__slowEditHandler; });
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Add Task');
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        await page.getByLabel('Task title', { exact: true }).fill('Installed weekly task');
        await page.getByLabel('Schedule type', { exact: true }).selectOption('recurring');
        await page.getByLabel('Repeat', { exact: true }).selectOption('weekly');
        await page.getByLabel('Start date', { exact: true }).fill(dates.monday);
        await clockField(page, 'Start Time').selectOption('22:00');
        await clockField(page, 'End Time').selectOption('22:30');
        await page.getByLabel('Wednesday', { exact: true }).check();
        await page.getByLabel('Friday', { exact: true }).check();
        await page.getByLabel('Notifications enabled', { exact: true }).uncheck();
        await page.getByRole('button', { name: 'Create Task', exact: true }).click();
        await board.getByRole('heading', { name: 'Installed weekly task', exact: true }).first().waitFor();
        const weekly = await page.evaluate(async () => (await window.electronAPI.listTasks()).find((task) => task.title === 'Installed weekly task'));
        assert.equal(await board.locator(`[data-task-id="${weekly.id}"]`).count(), 3);
        await page.getByLabel('Completion filter', { exact: true }).selectOption('completed');
        assert.equal(await board.locator(`[data-task-id="${weekly.id}"]`).count(), 0);
        await page.getByLabel('Completion filter', { exact: true }).selectOption('all');
        await page.getByRole('button', { name: 'Next week', exact: true }).click();
        await board.waitFor();
        assert.equal(await board.locator(`[data-task-id="${oneTime.id}"]`).count(), 0);
        assert.equal(await board.locator(`[data-task-id="${daily.id}"]`).count(), 7);
        await page.getByRole('button', { name: 'Previous week', exact: true }).click();
        await board.getByRole('heading', { name: 'Installed one-time task', exact: true }).waitFor();
        const samples = await page.evaluate(async (date) => {
            const at = (time) => new Date(date + 'T' + time).getTime();
            const create = (title, a, b) => window.electronAPI.createTask({ title, scheduleType: 'one-time', scheduledStartAt: at(a), scheduledEndAt: at(b), enabled: false });
            return [await create('Morning study', '09:00', '10:30'), await create('Afternoon workout', '14:15', '16:00'), await create('Five-minute pause', '13:00', '13:05'), await create('Paired pause', '13:00', '13:05'), await create('Shared start A', '20:00', '21:00'), await create('Bridge B', '20:00', '21:30'), await create('Shared end C', '20:30', '21:30'), await create('Containing block', '16:00', '18:00'), await create('Contained block', '17:00', '17:30'), await create('Partial overlap block', '17:15', '18:25'), await create('Short planning block', '18:45', '19:10'), await create('Midnight pause', '00:00', '00:05')];
        }, dates.today);
        await page.reload(); await board.waitFor();
        for (const [index, startMinute, duration] of [[0, 540, 90], [1, 855, 105], [2, 780, 5]]) {
            const sampleCard = board.locator('[data-task-id="' + samples[index].id + '"]');
            await verifyGeometry(sampleCard, startMinute, duration);
        }
        const largeCard = board.locator('[data-task-id="' + samples[0].id + '"]');
        await scrollToMinute(7 * 60 + 30);
        await page.mouse.move(10, 70);
        const normalCard = board.locator('[data-task-id="' + samples[1].id + '"]');
        const normalHeight = (await normalCard.boundingBox()).height;
        assert.equal(await normalCard.locator('time').isVisible(), normalHeight >= 60);
        assert.equal(await normalCard.locator('.lifecycle-status').isVisible(), normalHeight >= 44);
        assert.equal(await normalCard.locator('.card-action-hint').isVisible(), false);
        await largeCard.click({ position: { x: 10, y: (await largeCard.boundingBox()).height / 2 } });
        await waitFor(async () => await largeCard.getAttribute('data-state') === 'in-progress');
        await largeCard.getByRole('button', { name: 'Details for Morning study', exact: true }).click();
        await cardDetails.waitFor();
        await cardDetails.getByRole('button', { name: 'Close details', exact: true }).click();
        const tinyCard = board.locator('[data-task-id="' + samples[2].id + '"]');
        assert.equal(await tinyCard.getAttribute('data-group-size'), '2');
        const tinyUsable = await tinyCard.locator('xpath=..').evaluate((element) => element.clientWidth - 10);
        assert.ok(Math.abs((await tinyCard.boundingBox()).width - tinyUsable / 1.62) < 1);
        assert.equal(await tinyCard.locator('h3').evaluate((heading) => getComputedStyle(heading).lineHeight), '8px');
        await scrollToMinute(11 * 60 + 30);
        await hoverCard(tinyCard);
        await tinyCard.getByText('[ ▶ Start ]', { exact: true }).waitFor();
        assert.equal(await tinyCard.locator('h3').isVisible(), true);
        assert.equal(await tinyCard.locator('.card-details-button').isVisible(), true);
        await page.screenshot({ path: path.join(evidence, 'card-affordance-short.png') });
        const tinyBox = await tinyCard.boundingBox();
        assert.ok((await tinyCard.locator('.card-primary-button').boundingBox()).height >= 24, 'tiny cards retain a usable hit area');
        await page.mouse.click(tinyBox.x + 3, tinyBox.y - 4);
        await page.waitForFunction((id) => document.querySelector('[data-task-id="' + id + '"]').getAttribute('aria-label') === 'End Five-minute pause', samples[2].id);
        const shortPreview = await tinyCard.locator('.card-content').boundingBox();
        await page.mouse.click(shortPreview.x + 10, shortPreview.y + 30);
        await page.waitForFunction((id) => document.querySelector('[data-task-id="' + id + '"]').getAttribute('aria-label') === 'Reset Five-minute pause', samples[2].id);
        await hoverCard(tinyCard);
        await tinyCard.getByRole('button', { name: 'Details for Five-minute pause', exact: true }).click();
        await cardDetails.waitFor();
        assert.equal(await resetDialog.isVisible(), false, 'short-card details do not reset');
        await cardDetails.getByRole('button', { name: 'Close details', exact: true }).click();
        await verifyGeometry(tinyCard, 13 * 60, 5);
        assert.equal(await cardDetails.isVisible(), false);
        const shortCard = board.locator('[data-task-id="' + samples[10].id + '"]');
        await shortCard.scrollIntoViewIfNeeded();
        await page.mouse.move(10, 70);
        const shortHeight = (await shortCard.boundingBox()).height;
        assert.equal(await shortCard.locator('.lifecycle-status').isVisible(), shortHeight >= 44, 'state has priority over time when the card has room');
        assert.equal(await shortCard.locator('time').isVisible(), shortHeight >= 60);
        await hoverCard(shortCard);
        await shortCard.getByText('[ ▶ Start ]', { exact: true }).waitFor();
        const midnightCard = board.locator('[data-task-id="' + samples[11].id + '"]');
        await board.evaluate((element) => { element.scrollTop = 0; });
        await hoverCard(midnightCard);
        await midnightCard.getByText('[ ▶ Start ]', { exact: true }).waitFor();
        const midnightPreview = await midnightCard.locator('.card-content').boundingBox();
        const heading = await midnightCard.locator('xpath=ancestor::section[1]').locator('h2').boundingBox();
        assert.ok(midnightPreview.y >= heading.y + heading.height, 'midnight preview avoids sticky heading');
        assert.equal(await midnightCard.locator('h3').isVisible(), true);
        await midnightCard.getByRole('button', { name: 'Details for Midnight pause', exact: true }).click();
        await cardDetails.waitFor();
        assert.equal(await midnightCard.getAttribute('data-state'), 'planned', 'midnight details does not start');
        await cardDetails.getByRole('button', { name: 'Close details', exact: true }).click();
        const groupedCards = samples.slice(4, 7).map((task) => board.locator('[data-task-id="' + task.id + '"]'));
        await page.mouse.move(10, 70);
        await scrollToMinute(19 * 60);
        const defaultGroup = [];
        for (let index = 0; index < groupedCards.length; index++) {
            const card = groupedCards[index];
            assert.equal(await card.getAttribute('data-group-size'), '3');
            assert.equal(await card.getAttribute('data-group-column'), String(index));
            const box = await card.boundingBox();
            const usable = await card.locator('xpath=..').evaluate((element) => element.clientWidth - 10);
            const width = 1 / (1 + .62 * 2);
            assert.ok(Math.abs(box.width - usable * width) < 1);
            const parentBox = await card.locator('xpath=..').boundingBox();
            assert.ok(Math.abs(box.x - parentBox.x - 5 - usable * index * (1 - width) / 2) < 1, 'intersecting cards retain a visible staggered edge');
            defaultGroup.push({ box, z: await card.evaluate((element) => getComputedStyle(element).zIndex) });
            assert.equal(await card.locator('time').isVisible(), false);
        }
        await page.screenshot({ path: path.join(evidence, 'overlap-default.png') });
        await groupedCards[1].hover({ position: { x: 3, y: 5 } });
        const expandedBox = await groupedCards[1].boundingBox();
        assert.equal(expandedBox.y, defaultGroup[1].box.y);
        assert.equal(expandedBox.height, defaultGroup[1].box.height);
        assert.ok(Math.abs(expandedBox.width / defaultGroup[1].box.width - (1 + .62 * 2)) < .02);
        assert.equal(await groupedCards[1].evaluate((element) => getComputedStyle(element).zIndex), '10000');
        assert.equal(await groupedCards[1].locator('time').isVisible(), true);
        assert.equal(await groupedCards[1].getByText('[ ▶ Start ]', { exact: true }).isVisible(), true);
        await page.screenshot({ path: path.join(evidence, 'overlap-hover.png') });
        await page.mouse.move(10, 70);
        for (let index = 0; index < groupedCards.length; index++) {
            assert.deepEqual(await groupedCards[index].boundingBox(), defaultGroup[index].box);
            assert.equal(await groupedCards[index].evaluate((element) => getComputedStyle(element).zIndex), defaultGroup[index].z);
            assert.equal(await groupedCards[index].locator('time').isVisible(), false);
        }
        await page.screenshot({ path: path.join(evidence, 'overlap-restored.png') });
        const layeredCards = samples.slice(7, 10).map((task) => board.locator('[data-task-id="' + task.id + '"]'));
        await scrollToMinute(15 * 60);
        const defaultLayers = [];
        for (const card of layeredCards) {
            assert.equal(await card.getAttribute('data-group-size'), '3');
            const usable = await card.locator('xpath=..').evaluate((element) => element.clientWidth - 10);
            assert.ok(Math.abs((await card.boundingBox()).width - usable / (1 + .62 * 2)) < 1);
            defaultLayers.push(Number(await card.evaluate((element) => getComputedStyle(element).zIndex)));
        }
        assert.ok(defaultLayers[1] > defaultLayers[0], 'strictly contained block is above containing block');
        assert.ok(defaultLayers[2] > defaultLayers[1], 'later partial overlap starts above earlier block');
        const outerBefore = await layeredCards[0].boundingBox();
        await layeredCards[0].hover({ position: { x: 3, y: 5 } });
        assert.equal(await layeredCards[0].evaluate((element) => getComputedStyle(element).zIndex), '10000');
        const outerExpanded = await layeredCards[0].boundingBox();
        assert.equal(outerExpanded.y, outerBefore.y); assert.equal(outerExpanded.height, outerBefore.height);
        assert.ok(outerExpanded.width > outerBefore.width * 2);
        await page.mouse.move(10, 70);
        assert.equal(Number(await layeredCards[0].evaluate((element) => getComputedStyle(element).zIndex)), defaultLayers[0]);
        assert.deepEqual(await layeredCards[0].boundingBox(), outerBefore);
        report.checks.push('strict containment and partial overlap share staggered groups, deterministic layers and reversible hover expansion');
        report.checks.push('2/3/4-task staggered transitive groups, title-only compact cards, keyboard actions, whole-capsule hover and deterministic mouse-leave restoration');
        report.checks.push('example ranges preserve true planned geometry, with fifteen-minute visual minimum; blank card surface starts occurrence');
        await scrollToMinute(8 * 60);
        await page.setViewportSize({ width: 600, height: 700 });
        assert.ok(await board.evaluate((element) => element.scrollWidth > element.clientWidth));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'only the board scrolls horizontally');
        await page.screenshot({ path: path.join(evidence, 'weekly-narrow.png') });
        await page.setViewportSize({ width: 320, height: 700 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'toolbar wraps at minimum window width');
        await page.setViewportSize({ width: 1280, height: 800 });
        await scrollToMinute(8 * 60);
        await page.screenshot({ path: path.join(evidence, 'weekly-desktop.png') });
        await scrollToMinute(13 * 60);
        await page.screenshot({ path: path.join(evidence, 'weekly-afternoon.png') });
        await application.evaluate(() => { Date.now = globalThis.__fixtureRealNow; delete globalThis.__fixtureRealNow; });
        const notificationTask = await page.evaluate(() => {
            const start = new Date(); start.setMinutes(Math.floor(start.getMinutes() / 5) * 5, 0, 0);
            const end = new Date(start); end.setMinutes(end.getMinutes() + 5);
            if (end.getDate() !== start.getDate()) { start.setMinutes(start.getMinutes() - 5); end.setTime(start.getTime() + 5 * 60000); }
            const localDate = [start.getFullYear(), String(start.getMonth() + 1).padStart(2, '0'), String(start.getDate()).padStart(2, '0')].join('-');
            const localTime = (value) => `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
            // A recurring rule can expose today's due slot without creating a
            // forbidden past one-time plan or waiting for a future five-minute slot.
            return window.electronAPI.createTask({ title: 'Installed scheduler check', scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: localDate, startTime: localTime(start), endTime: localTime(end), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, weekdays: [] } });
        });
        report.checks.push('muted gray/blue/green state colors, primary-only hover hints and keyboard focus, preserved titles and reserved details space, no mutation from hover, compact and short-card action previews');
        report.checks.push('card Start/End/reset confirmation and cancellation, details isolation, compact and short-card hit targets, stable hover geometry, weekly placement/navigation/filtering, shared Add/Edit modal, focus containment/restoration, Cancel, pending-save dismissal guard, Start/End lifecycle, details/history/backfill/correction/clear, history-preserving edit, fourteen semantic APIs, 1280px/600px/320px layout');

        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
        const second = spawnSync(executable, [`--user-data-dir=${userData}`], { env, cwd: evidence, timeout: 15000, encoding: 'utf8' });
        if (second.error) throw second.error;
        assert.equal(second.status, 0);
        await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
        await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()));
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        report.checks.push('close hides to tray; second process exits and restores/focuses existing window');
        console.log('PASS: weekly Task UI/edit/history, tray hiding and single-instance focus. Waiting for the real thirty-second scheduler...');

        await waitFor(() => application.evaluate(() => globalThis.__installedCheck.attempts > 0), 70000);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        report.scheduler = await application.evaluate(() => globalThis.__installedCheck);
        assert.equal(report.scheduler.attempts, 1);
        assert.ok(report.scheduler.bodies.every((body) => body === 'Time to start: Installed scheduler check'));
        // Starting stops later slots while restart and cleanup checks run.
        await page.evaluate((task) => window.electronAPI.startTaskOccurrence({ taskId: task.id, scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt }), notificationTask);
        report.checks.push('real thirty-second scheduler invokes native Notification.show once for due task occurrence');
        console.log('PASS: real scheduler called native notification API; toast event evidence:', JSON.stringify(report.scheduler));
        await page.bringToFront();
        await page.screenshot({ path: path.join(evidence, 'installed-app.png') });
        assert.deepEqual(errors, []);
        await application.close();
        application = undefined;

        application = await launch();
        page = await application.firstWindow();
        page.on('pageerror', (error) => errors.push(error.message));
        await page.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        await page.getByRole('heading', { name: 'Edited daily task', exact: true }).first().waitFor();
        const persisted = await page.evaluate(() => window.electronAPI.listTasks());
        assert.equal(persisted.find((task) => task.id === oneTime.id).currentOccurrence.startedAt, ended.startedAt);
        assert.equal(persisted.find((task) => task.id === oneTime.id).currentOccurrence.endedAt, ended.endedAt);
        assert.ok(persisted.find((task) => task.id === daily.id).nextOccurrenceAt > Date.now());
        const persistedHistory = await page.evaluate(async (id) => window.electronAPI.listTaskOccurrences(id, Date.now() - 4 * 86400000, Date.now() + 1), daily.id);
        assert.equal(persistedHistory.find((row) => row.id === missed.id).recordedAt, originalRecord.recordedAt);
        for (const task of persisted) {
            await page.getByRole('button', { name: 'Manage tasks', exact: true }).click();
            await page.locator('.task-picker').getByRole('button', { name: task.title, exact: true }).click();
            const deleteDetails = page.getByRole('dialog', { name: 'Task details', exact: true });
            await deleteDetails.getByRole('button', { name: 'Delete task', exact: true }).click();
            const confirmation = deleteDetails.getByRole('region', { name: 'Confirm task deletion', exact: true });
            await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
            assert.ok((await page.evaluate(() => window.electronAPI.listTasks())).some((saved) => saved.id === task.id), 'cancel keeps the task');
            await deleteDetails.getByRole('button', { name: 'Delete task', exact: true }).click();
            await confirmation.getByRole('button', { name: 'Confirm delete', exact: true }).click();
            await waitFor(() => page.evaluate(async (id) => !(await window.electronAPI.listTasks()).some((task) => task.id === id), task.id));
        }
        assert.equal((await page.evaluate(() => window.electronAPI.listTasks())).length, 0);
        assert.deepEqual(errors, []);
        report.checks.push('full restart preserves one-time completion, recurring schedules/occurrence IDs and corrected backfill history; task deletion works');
        await application.close();
        application = undefined;
        report.passed = true;
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(evidenceRoot, 'latest.json'), JSON.stringify(report, null, 2));
        console.log('PASS: installed application verification. Evidence:', evidence);
    } catch (error) {
        if (application) {
            const failedPage = await application.firstWindow();
            await failedPage.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
            fs.writeFileSync(path.join(evidence, 'failure.html'), await failedPage.content().catch(() => 'Unavailable'));
        }
        report.passed = false;
        report.error = error.stack || String(error);
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
        throw error;
    } finally {
        if (application) await application.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
