const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { _electron } = require('playwright-core');
const until = async (check, message) => { for (let n = 0; n < 160; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error(message); };

// Windows can deny programmatic foreground focus even when Electron says focused.
// This QA-only paired Alt input permits focusing the actual fullscreen window.
async function focusFullscreen(app) {
    const handle = await app.evaluate(() => globalThis.__miniFullscreenTest.getNativeWindowHandle().readBigUInt64LE().toString());
    const script = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class MiniTestFocus {
 [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@
[MiniTestFocus]::keybd_event(18,0,0,[UIntPtr]::Zero)
[MiniTestFocus]::SetForegroundWindow([IntPtr]${handle}) | Out-Null
[MiniTestFocus]::keybd_event(18,0,2,[UIntPtr]::Zero)
`;
    require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
}

async function resizeMini(mini, miniWindow, width, height) {
    const bounds = await miniWindow.evaluate(window => window.getBounds());
    await mini.evaluate(async ({ dx, dy }) => {
        await window.miniAPI.beginResize('se', { x: 0, y: 0 });
        await window.miniAPI.moveResize({ x: dx, y: dy });
        await window.miniAPI.endResize();
    }, { dx: width - bounds.width, dy: height - bounds.height });
}

(async () => {
    const evidence = fs.mkdtempSync(path.resolve('release/verification/mini-window-'));
    const profile = path.join(evidence, 'userData'), packaged = process.argv[2];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.ELECTRON_RENDERER_URL;
    const launch = () => _electron.launch({ executablePath: packaged ? path.resolve(packaged) : require('electron'), args: [...(packaged ? [] : [path.resolve('.')]), '--user-data-dir=' + profile], env }).then(app => { app.process().stderr.on('data', chunk => fs.appendFileSync(path.join(evidence, 'electron-stderr.log'), chunk)); return app; });
    let app;
    try {
        app = await launch(); let main = await app.firstWindow();
        await main.getByRole('region', { name: 'Weekly schedule', exact: true }).waitFor();
        assert.equal(app.windows().length, 1, 'disabled mini is not created');
        const now = await app.evaluate(({ Menu, ipcMain }) => {
            const value = new Date(); value.setHours(12, 0, 0, 0); const time = +value; Date.now = () => time;
            const build = Menu.buildFromTemplate;
            Menu.buildFromTemplate = (...args) => { const menu = build.apply(Menu, args); if (menu.getMenuItemById('toggle-mini')) globalThis.__miniTrayMenu = menu; if (menu.getMenuItemById('close-mini-ball')) globalThis.__miniBallMenu = menu; return menu; };
            const create = ipcMain._invokeHandlers.get('task:create'); ipcMain.removeHandler('task:create');
            ipcMain.handle('task:create', (event, input) => { Date.now = () => input.scheduledStartAt ? input.scheduledStartAt - 1 : time; try { return create(event, input); } finally { Date.now = () => time; } });
            return time;
        });
        await main.clock.install({ time: new Date(now) });
        const seeded = await main.evaluate(async now => {
            const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const one = (title, delta) => window.electronAPI.createTask({ title, category: 'study', enabled: false, scheduleType: 'one-time', timeZone: zone, scheduledStartAt: now + delta, scheduledEndAt: now + delta + 3600000 });
            const current = await one('Current focus', 0); await window.electronAPI.startTaskOccurrence({ taskId: current.id, occurrenceId: current.currentOccurrence.id });
            const date = new Date(now), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const next = await window.electronAPI.createTask({ title: 'Next recurring', category: 'exercise', enabled: false, scheduleType: 'recurring', recurrenceRule: { frequency: 'daily', startDate: day, startTime: '12:30', endTime: '13:00', timeZone: zone, weekdays: [] } });
            await one('Later task', 7200000); await one('Missed task', -7200000);
            return { current, next };
        }, now);
        await main.reload();
        const windowEvent = app.waitForEvent('window');
        await main.evaluate(() => window.electronAPI.updateUserSettings({ trayMiniEnabled: true }));
        let mini = await windowEvent;
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        assert.equal((await (await app.browserWindow(mini)).evaluate(window => window.getBounds())).width, 56);
        const ballWindow = await app.browserWindow(mini);
        const primaryArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
        await ballWindow.evaluate((window, area) => window.setPosition(area.x + area.width - 120, area.y + area.height - 80), primaryArea);
        const beforeExpand = await ballWindow.evaluate(window => window.getBounds());
        await mini.screenshot({ path: path.join(evidence, 'floating-ball.png') });
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click();
        await mini.getByRole('heading', { name: 'Today', exact: true }).waitFor();
        const afterExpand = await ballWindow.evaluate(window => window.getBounds());
        assert.equal(afterExpand.y + afterExpand.height, beforeExpand.y + beforeExpand.height, 'panel expands upward from ball bottom');
        await mini.getByRole('button', { name: 'Open details for Current focus', exact: true }).waitFor();
        assert.equal(await mini.evaluate(() => typeof window.electronAPI), 'undefined');
        assert.equal(await mini.evaluate(() => typeof require), 'undefined');
        assert.equal(await mini.evaluate(() => Object.hasOwn(window.miniAPI, 'ipcRenderer')), false);
        let miniWindow = await app.browserWindow(mini);
        await until(() => miniWindow.evaluate(window => window.isVisible()), 'mini is shown after renderer readiness');
        const native = await miniWindow.evaluate(window => ({ top: window.isAlwaysOnTop(), resizable: window.isResizable(), bounds: window.getBounds(), prefs: window.webContents.getLastWebPreferences() }));
        assert.equal(native.top, true, JSON.stringify(native)); assert.equal(native.resizable, false); assert.equal(native.bounds.width, 340);
        assert.equal(native.prefs.contextIsolation, true); assert.equal(native.prefs.nodeIntegration, false);
        assert.equal(await mini.locator('.mini-header').evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')), 'drag');
        assert.equal(await mini.getByRole('button', { name: 'Hide panel', exact: true }).evaluate(element => getComputedStyle(element).getPropertyValue('-webkit-app-region')), 'no-drag');
        assert.equal(await mini.locator('.mini-resize-grip.edge-e').evaluate(el => getComputedStyle(el).cursor), 'ew-resize');
        const initialBounds = await miniWindow.evaluate(window => window.getBounds());
        const grip = mini.locator('.mini-resize-grip.edge-se'); const gripBox = await grip.boundingBox();
        await mini.mouse.move(gripBox.x + 5, gripBox.y + 5); await mini.mouse.down();
        await mini.mouse.move(gripBox.x - 25, gripBox.y - 45, { steps: 4 }); await mini.mouse.up();
        await until(async () => (await miniWindow.evaluate(window => window.getBounds())).width < initialBounds.width, 'client edge grip really resizes');
        await resizeMini(mini, miniWindow, 340, 480);
        for (const title of ['Current focus', 'Next recurring']) {
            await mini.getByRole('button', { name: 'Open details for ' + title, exact: true }).click();
            await main.getByRole('dialog', { name: 'Task details', exact: true }).waitFor();
            await main.getByRole('dialog', { name: 'Task details', exact: true }).getByText(title, { exact: true }).first().waitFor();
            await main.getByRole('button', { name: 'Close details', exact: true }).click();
        }
        await mini.getByRole('button', { name: 'Start Next recurring', exact: true }).click();
        assert.equal(await main.getByRole('dialog', { name: 'Task details', exact: true }).count(), 0, 'Start does not open details');
        await main.locator(`[data-task-id="${seeded.next.id}"][data-state="in-progress"]`).first().waitFor({ timeout: 5000 });
        await mini.getByRole('button', { name: 'Finish Next recurring', exact: true }).waitFor();
        const afterStart = await main.evaluate(id => window.electronAPI.listTasks().then(tasks => tasks.find(task => task.id === id)), seeded.next.id);
        assert.equal(afterStart.scheduleType, 'recurring', 'normal mini start never detaches');
        await main.evaluate(task => window.electronAPI.updateTask(task.id, { title: 'Renamed focus', category: task.category, enabled: false, scheduleType: 'one-time', scheduledStartAt: task.scheduledStartAt, scheduledEndAt: task.scheduledEndAt, timeZone: task.timeZone }), seeded.current);
        await mini.getByRole('button', { name: 'Open details for Renamed focus', exact: true }).waitFor({ timeout: 5000 });
        await mini.getByRole('button', { name: 'Finish Next recurring', exact: true }).click();
        await main.locator(`[data-task-id="${seeded.next.id}"][data-state="completed"]`).first().waitFor({ timeout: 5000 });
        await until(async () => await mini.locator(`[data-task-id="${seeded.next.id}"][data-state="running"]`).count() === 0, 'finished row disappears from widget');
        await mini.locator('.mini-completed summary').waitFor();
        assert.equal(await mini.locator('.mini-completed').evaluate(el => el.open), false);
        await mini.locator('.mini-completed summary').click();
        await mini.locator('.mini-completed').getByRole('button', { name: 'Open details for Next recurring', exact: true }).click();
        await main.getByRole('dialog', { name: 'Task details', exact: true }).waitFor();
        await main.getByRole('button', { name: 'Close details', exact: true }).click();
        await mini.locator('.mini-completed summary').click();
        await mini.locator('.mini-missed summary').click(); await mini.getByRole('button', { name: 'Open details for Missed task', exact: true }).waitFor();
        await (await app.browserWindow(main)).evaluate(window => window.hide());
        await mini.getByRole('button', { name: 'Open details for Missed task', exact: true }).click();
        await main.getByRole('dialog', { name: 'Task details', exact: true }).waitFor();
        await main.getByRole('dialog', { name: 'Task details', exact: true }).getByText('Missed task', { exact: true }).first().waitFor();
        assert.equal(await (await app.browserWindow(main)).evaluate(window => window.isVisible()), true);
        await main.getByRole('button', { name: 'Close details', exact: true }).click();
        assert.equal(await mini.getByRole('button', { name: 'Review in main app' }).count(), 0);
        await mini.screenshot({ path: path.join(evidence, 'today-mini.png') });
        await mini.getByRole('button', { name: 'Today timetable', exact: true }).click();
        await mini.getByRole('region', { name: "Today's timetable", exact: true }).waitFor();
        assert.ok(await mini.locator('.mini-day-task').count() >= 4, 'single day includes finished/planned/running/missed records');
        await resizeMini(mini, miniWindow, 280, 330);
        await until(async () => (await miniWindow.evaluate(window => window.getBounds())).width === 280, 'expanded window can be reduced');
        assert.equal(await mini.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow day view has no horizontal overflow');
        await mini.getByRole('button', { name: 'Hide panel' }).click();
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click();
        await mini.getByRole('region', { name: "Today's timetable", exact: true }).waitFor();
        assert.equal((await miniWindow.evaluate(window => window.getBounds())).width, 280, 'panel keeps chosen compact size after collapsing');
        await mini.screenshot({ path: path.join(evidence, 'today-timetable.png') });
        await resizeMini(mini, miniWindow, 340, 480);
        await mini.getByRole('button', { name: 'Now & Next', exact: true }).click();
        const mainWindow = await app.browserWindow(main);
        await mainWindow.evaluate(window => window.close());
        assert.equal(await mainWindow.evaluate(window => window.isVisible()), false);
        assert.equal(await miniWindow.evaluate(window => window.isVisible()), true, 'mini remains independent');
        await mini.getByRole('button', { name: 'Open main app', exact: true }).click();
        await until(() => mainWindow.evaluate(window => window.isVisible()), 'main reopens');
        await miniWindow.evaluate(window => window.setPosition(45, 65));
        await mini.getByRole('button', { name: 'Hide panel', exact: true }).click();
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        assert.equal(await miniWindow.evaluate(window => window.isVisible()), true, 'hide panel leaves ball visible');
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click({ button: 'right' });
        await until(() => app.evaluate(() => !!globalThis.__miniBallMenu), 'ball right click opens native menu');
        await app.evaluate(() => { const menu = globalThis.__miniBallMenu; menu.getMenuItemById('close-mini-ball').click(); menu.closePopup(); });
        assert.equal(await miniWindow.evaluate(window => window.isVisible()), false, 'context menu closes floating ball');
        assert.equal(await main.evaluate(() => window.electronAPI.getLocalPreferences().then(prefs => prefs.settings.trayMiniEnabled)), true, 'hide keeps startup preference');
        const position = JSON.parse(fs.readFileSync(path.join(profile, 'mini-window-state.json')));
        await app.evaluate(() => { const item = globalThis.__miniTrayMenu.getMenuItemById('toggle-mini'); item.click(); });
        await until(() => miniWindow.evaluate(window => window.isVisible()), 'tray reopens same mini');
        assert.equal(app.windows().length, 2, 'no duplicate widget');
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click();
        await mini.getByRole('heading', { name: 'Today', exact: true }).waitFor();
        await miniWindow.evaluate(window => window.close());
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        assert.equal(await miniWindow.evaluate(window => window.isVisible()), true, 'native panel close leaves ball visible');
        await app.close();
        app = await launch(); main = await app.firstWindow();
        await until(async () => app.windows().some(page => page.url().includes('mini.html')), 'startup restores enabled widget');
        mini = app.windows().find(page => page.url().includes('mini.html'));
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click();
        await mini.getByRole('heading', { name: 'Today', exact: true }).waitFor();
        miniWindow = await app.browserWindow(mini);
        const restored = await miniWindow.evaluate(window => window.getBounds());
        assert.equal(restored.x, position.x + position.width - restored.width); assert.equal(restored.y, position.y + position.height - restored.height);
        await mini.getByRole('button', { name: 'Hide panel' }).click();
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        assert.equal((await miniWindow.evaluate(window => window.getBounds())).width, 56);
        const area = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
        await miniWindow.evaluate((window, area) => window.setPosition(area.x, area.y + 100), area);
        await mini.evaluate(() => window.miniAPI.endDrag());
        await until(async () => (await miniWindow.evaluate(window => window.getBounds())).width === 32, 'ball tucks into screen edge');
        assert.equal(await mini.evaluate(() => window.miniAPI.getWindowState().then(state => state.mode)), 'docked');
        assert.equal(await mini.locator('.mini-orb.is-docked').evaluate(el => el.getBoundingClientRect().width), 16, 'visible edge handle uses half width');
        await mini.screenshot({ path: path.join(evidence, 'docked-mini.png') });
        await app.close();
        app = await launch(); main = await app.firstWindow();
        await until(async () => app.windows().some(page => page.url().includes('mini.html')), 'docked widget restores on restart');
        mini = app.windows().find(page => page.url().includes('mini.html'));
        await mini.getByRole('button', { name: 'Expand Today mini view' }).waitFor();
        miniWindow = await app.browserWindow(mini);
        assert.equal((await miniWindow.evaluate(window => window.getBounds())).width, 32);
        assert.equal(await mini.evaluate(() => window.miniAPI.getWindowState().then(state => state.edge)), 'left');
        await mini.getByRole('button', { name: 'Expand Today mini view' }).click();
        await mini.getByRole('heading', { name: 'Today', exact: true }).waitFor();
        assert.equal((await miniWindow.evaluate(window => window.getBounds())).width, 340);
        await app.evaluate(async ({ BrowserWindow }) => {
            const full = new BrowserWindow({ width: 800, height: 600, show: false });
            await full.loadURL('data:text/html,<h1>Fullscreen verification</h1>');
            globalThis.__miniFullscreenTest = full; full.show(); full.setFullScreen(true); full.focus();
        });
        await focusFullscreen(app);
        await until(async () => !(await miniWindow.evaluate(window => window.isVisible())), 'foreground fullscreen hides widget');
        await app.evaluate(() => { globalThis.__miniFullscreenTest.destroy(); });
        await (await app.browserWindow(main)).evaluate(window => { window.show(); window.focus(); });
        await until(() => miniWindow.evaluate(window => window.isVisible()), 'exit fullscreen restores widget');
        await app.evaluate(async ({ BrowserWindow }) => {
            const full = new BrowserWindow({ show: false });
            await full.loadURL('data:text/html,<h1>Fullscreen verification</h1>');
            globalThis.__miniFullscreenTest = full; full.show(); full.setFullScreen(true); full.focus();
        });
        await focusFullscreen(app);
        await until(async () => !(await miniWindow.evaluate(window => window.isVisible())), 'second fullscreen hides widget');
        await main.evaluate(() => window.electronAPI.updateUserSettings({ trayMiniEnabled: false }));
        await app.evaluate(() => { globalThis.__miniFullscreenTest.destroy(); });
        await (await app.browserWindow(main)).evaluate(window => { window.show(); window.focus(); });
        await new Promise(resolve => setTimeout(resolve, 800));
        assert.equal(await miniWindow.evaluate(window => window.isVisible()), false, 'disabled mini view is not restored on fullscreen exit');
        await main.evaluate(() => window.electronAPI.updateUserSettings({ trayMiniEnabled: false }));
        await until(async () => !(await miniWindow.evaluate(window => window.isVisible())), 'disable hides immediately');
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ passed: true, packaged: !!packaged, position, restored, synchronizedWithinMs: 5000 }, null, 2));
        console.log('PASS floating Today window, both-way sync, lifecycle, tray reopen, hide/close, position and startup restore: ' + evidence);
    } finally { if (app) await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
