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
        await page.getByText('No reminders yet.', { exact: true }).waitFor();
        assert.ok(page.url().includes('app.asar/out/renderer/index.html'));
        const runtime = await application.evaluate(async ({ app, BrowserWindow, Tray, Notification }) => {
            const { createRequire } = process.getBuiltinModule('node:module');
            const { queryObjects } = process.getBuiltinModule('node:v8');
            const requireApp = createRequire(app.getAppPath() + '/package.json');
            const Database = requireApp('better-sqlite3');
            const db = new Database(app.getPath('userData') + '/data.db', { readonly: true });
            const migrations = db.prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations').get().count;
            db.close();
            globalThis.__installedCheck = { attempts: 0, shows: 0, failures: [] };
            const originalShow = Notification.prototype.show;
            Notification.prototype.show = function () {
                globalThis.__installedCheck.attempts++;
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
        assert.equal(runtime.migrations, 2);
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
        assert.equal(bridge.keys.length, 7);
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
        await page.getByText('No reminders yet.', { exact: true }).waitFor();

        await page.locator('input').first().fill('Installed task');
        await page.getByRole('button', { name: 'Add Task', exact: true }).click();
        await page.getByText('Installed task', { exact: true }).waitFor();
        await page.getByRole('checkbox').check();
        await waitFor(() => page.getByRole('checkbox').isChecked());
        await page.getByLabel('Reminder title', { exact: true }).fill('Installed reminder');
        await page.getByLabel('Remind me at', { exact: true }).fill('2030-10-18T12:00');
        await page.getByRole('button', { name: 'Add Reminder', exact: true }).click();
        await page.getByRole('listitem').filter({ hasText: 'Installed reminder' }).waitFor();
        await page.evaluate(() => window.electronAPI.createReminder({ title: 'Installed scheduler check', dueAt: Date.now() - 1000 }));
        report.checks.push('Task create/toggle and Reminder create through installed renderer/preload/IPC');

        await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
        const second = spawnSync(executable, [`--user-data-dir=${userData}`], { env, cwd: evidence, timeout: 15000, encoding: 'utf8' });
        if (second.error) throw second.error;
        assert.equal(second.status, 0);
        await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
        await waitFor(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()));
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        report.checks.push('close hides to tray; second process exits and restores/focuses existing window');
        console.log('PASS: Task/Reminder operations, tray hiding, and single-instance restoration. Waiting for the real minute scheduler...');

        await waitFor(() => application.evaluate(() => globalThis.__installedCheck.attempts > 0), 70000);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        report.scheduler = await application.evaluate(() => globalThis.__installedCheck);
        assert.equal(report.scheduler.attempts, 1);
        report.checks.push('real one-minute scheduler invokes native Notification.show once for due reminder');
        console.log('PASS: real scheduler called native notification API; toast event evidence:', JSON.stringify(report.scheduler));
        await page.screenshot({ path: path.join(evidence, 'installed-app.png') });
        assert.deepEqual(errors, []);
        await application.close();
        application = undefined;

        application = await launch();
        page = await application.firstWindow();
        await page.getByText('Installed task', { exact: true }).waitFor();
        assert.equal(await page.getByRole('checkbox').isChecked(), true);
        await page.getByRole('listitem').filter({ hasText: 'Installed reminder' }).waitFor();
        await page.getByRole('button', { name: 'Delete reminder: Installed reminder', exact: true }).click();
        await page.getByRole('button', { name: 'Delete reminder: Installed scheduler check', exact: true }).click();
        await page.getByText('No reminders yet.', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Delete', exact: true }).click();
        await page.getByText('No tasks yet.', { exact: true }).waitFor();
        report.checks.push('full process restart preserves SQLite data; Task/Reminder deletion works');
        await application.close();
        application = undefined;
        report.passed = true;
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
        fs.writeFileSync(path.join(evidenceRoot, 'latest.json'), JSON.stringify(report, null, 2));
        console.log('PASS: installed application verification. Evidence:', evidence);
    } catch (error) {
        report.passed = false;
        report.error = error.stack || String(error);
        fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
        throw error;
    } finally {
        if (application) await application.close();
    }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
