const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const ts = require('typescript');
require('./register-typescript.cjs');

async function boot({ lock = true, databaseError = false, loadError = false, closeToTray = true } = {}) {
    const calls = [];
    const app = new EventEmitter();
    Object.assign(app, {
        isPackaged: true,
        requestSingleInstanceLock: () => lock,
        whenReady: () => Promise.resolve(),
        getAppPath: () => path.resolve(__dirname, '..'),
        getPath: () => path.resolve(__dirname, '../release/test-profile'),
        setAppUserModelId: () => {},
        quit: () => { calls.push('quit'); app.emit('before-quit'); },
        exit: (code) => calls.push(`exit:${code}`),
    });
    let window;
    class BrowserWindow extends EventEmitter {
        constructor() {
            super();
            window = this;
            this.visible = true;
            this.minimized = true;
            this.webContents = new EventEmitter();
            this.webContents.send = () => {};
            this.webContents.setWindowOpenHandler = (handler) => { this.windowOpenHandler = handler; };
        }
        removeMenu() {}
        maximize() { calls.push('maximize-window'); }
        isVisible() { return this.visible; }
        isDestroyed() { return false; }
        isMinimized() { return this.minimized; }
        restore() { this.minimized = false; }
        show() { this.visible = true; }
        hide() { this.visible = false; }
        focus() { calls.push('focus'); }
        async loadURL() {
            calls.push('renderer');
            if (loadError) throw new Error('renderer failed');
        }
    }
    class Tray extends EventEmitter {
        constructor() { super(); calls.push('tray'); }
        setToolTip() {}
        setContextMenu(menu) { this.menu = menu; }
        destroy() { calls.push('destroy-tray'); }
    }
    const modules = {
        electron: { app, BrowserWindow, Tray, screen: { getPrimaryDisplay: () => ({ workArea: {x:0,y:0,width:1920,height:1080} }), getAllDisplays: () => [{ workArea: {x:0,y:0,width:1920,height:1080} }] }, Menu: { buildFromTemplate: (items) => items }, dialog: { showErrorBox: () => calls.push('fatal-dialog') } },
        './db/database': {
            initializeDatabase: () => { calls.push('database'); if (databaseError) throw new Error('migration failed'); },
            closeDatabase: () => calls.push('close-database'),
        },
        './window/windowSizing': require('../electron/window/windowSizing.ts'),
        './window/windowGeometry': {
            loadWindowGeometry: (_file, _areas, bounds) => ({ bounds, maximized: true }),
            trackWindowGeometry: () => () => calls.push('save-window'),
        },
        './services/settingsService': { getLocalPreferences: () => { calls.push('preferences'); return {}; }, getUserSettings: () => ({ closeToTray }) },
        './ipc/settingsIpc': { registerSettingsIpc: () => {} },
        './ipc/taskIpc': { registerTaskIpc: () => calls.push('task-ipc') },
        './ipc/validateSender': { createSenderValidator: () => () => {} },
        './scheduler/taskScheduler': {
            startTaskScheduler: () => calls.push('start-scheduler'),
            stopTaskScheduler: () => calls.push('stop-scheduler'),
        },
    };
    const filename = path.resolve(__dirname, '../electron/main.ts');
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.resolve(__dirname, '../out/main/index.js')).href));
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
    });
    vm.runInNewContext(outputText, {
        require: (name) => modules[name] ?? require(name), exports: {},
        process, URL, console: { error: () => {} },
    }, { filename });
    await new Promise((resolve) => setImmediate(resolve));
    return { app, calls, window };
}

test('second process exits before database/IPC/scheduler initialization', async () => {
    const { calls } = await boot({ lock: false });
    assert.deepEqual(calls, ['quit']);
});

test('startup orders migrations before consumers, blocks navigation, and restores the existing window', async () => {
    const { app, calls, window } = await boot();
    assert.deepEqual(calls, ['database', 'preferences', 'task-ipc', 'maximize-window', 'renderer', 'tray', 'start-scheduler']);
    assert.equal(window.windowOpenHandler().action, 'deny');
    let prevented = 0;
    window.webContents.emit('will-navigate', { preventDefault: () => prevented++ });
    window.webContents.emit('will-redirect', { preventDefault: () => prevented++ });
    window.emit('close', { preventDefault: () => prevented++ });
    assert.equal(prevented, 3);
    assert.equal(window.visible, false);
    app.emit('second-instance');
    assert.equal(window.visible, true);
    assert.equal(window.minimized, false);
    assert.ok(calls.includes('focus'));
    app.emit('before-quit');
    assert.ok(calls.includes('save-window'));
    assert.ok(calls.indexOf('stop-scheduler') < calls.indexOf('close-database'));
});

for (const failure of ['databaseError', 'loadError']) {
    test(`fatal ${failure} reports an error, cleans up, and never starts scheduling`, async () => {
        const { calls } = await boot({ [failure]: true });
        assert.ok(calls.includes('fatal-dialog'));
        assert.ok(calls.includes('exit:1'));
        assert.ok(calls.includes('close-database'));
        assert.ok(!calls.includes('start-scheduler'));
        assert.ok(!calls.includes('save-window'));
    });
}

test('Close to tray preference takes effect without restart and off uses normal quit cleanup', async () => {
    const { window, calls } = await boot({ closeToTray: false });
    window.emit('close', { preventDefault() {} });
    assert.ok(calls.includes('quit'));
    assert.ok(calls.includes('save-window'));
    assert.ok(calls.indexOf('stop-scheduler') < calls.indexOf('close-database'));
});
