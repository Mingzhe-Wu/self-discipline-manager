const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');

test('IPC accepts only the intended main window and its trusted top-level URL', () => {
    const { createSenderValidator } = require('../electron/ipc/validateSender.ts');
    const mainFrame = { url: 'file:///C:/app/out/renderer/index.html' };
    const webContents = { mainFrame };
    const window = { webContents, isDestroyed: () => false };
    const validate = createSenderValidator(() => window, mainFrame.url);
    assert.doesNotThrow(() => validate({ sender: webContents, senderFrame: mainFrame }));
    assert.throws(() => validate({ sender: {}, senderFrame: mainFrame }), /Untrusted IPC sender/);
    assert.throws(() => validate({ sender: webContents, senderFrame: { url: mainFrame.url } }), /Untrusted IPC sender/);
    assert.throws(() => validate({ sender: webContents, senderFrame: null }), /Untrusted IPC sender/);
    mainFrame.url = 'file:///C:/app/other.html';
    assert.throws(() => validate({ sender: webContents, senderFrame: mainFrame }), /Untrusted IPC sender/);
    mainFrame.url = 'https://example.com/';
    assert.throws(() => validate({ sender: webContents, senderFrame: mainFrame }), /Untrusted IPC sender/);
    mainFrame.url = 'file:///C:/app/out/renderer/index.html#local';
    assert.doesNotThrow(() => validate({ sender: webContents, senderFrame: mainFrame }));
    const unavailable = createSenderValidator(() => null, mainFrame.url);
    assert.throws(() => unavailable({ sender: webContents, senderFrame: mainFrame }), /Untrusted IPC sender/);
});

test('development IPC accepts the configured URL and rejects another local port or path', () => {
    const { createSenderValidator } = require('../electron/ipc/validateSender.ts');
    const mainFrame = { url: 'http://localhost:5173/' };
    const webContents = { mainFrame };
    const window = { webContents, isDestroyed: () => false };
    const validate = createSenderValidator(() => window, mainFrame.url);
    assert.doesNotThrow(() => validate({ sender: webContents, senderFrame: mainFrame }));
    for (const url of ['http://localhost:5174/', 'http://localhost:5173/other', 'about:blank']) {
        mainFrame.url = url;
        assert.throws(() => validate({ sender: webContents, senderFrame: mainFrame }), /Untrusted IPC sender/);
    }
});

test('window-shown subscription exposes no Electron event and removes exactly its own listener',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');let bridge,listener,removed;
 const electron={contextBridge:{exposeInMainWorld:(_name,value)=>bridge=value},ipcRenderer:{on:(channel,fn)=>{assert.equal(channel,'app:shown');listener=fn;},removeListener:(channel,fn)=>{removed={channel,fn};},invoke(){}}};
 const source=ts.transpileModule(fs.readFileSync(path.resolve('electron/preload.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText;
 vm.runInNewContext(source,{require:(name)=>{assert.equal(name,'electron');return electron;},exports:{}});
 let args;const unsubscribe=bridge.onWindowShown((...values)=>args=values);listener({sender:'must stay private'},123);assert.equal(args.length,0);unsubscribe();assert.equal(removed.channel,'app:shown');assert.equal(removed.fn,listener);assert.equal(bridge.ipcRenderer,undefined);
});

test('mini preload exposes only Today/lifecycle/window operations and event-only invalidation', () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
    let bridge, listener, removed;
    const electron = { contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'miniAPI'); bridge = value; } }, ipcRenderer: { invoke() {}, on(channel, fn) { assert.equal(channel, 'data:changed'); listener = fn; }, removeListener(channel, fn) { removed = { channel, fn }; } } };
    const source = ts.transpileModule(fs.readFileSync(path.resolve('electron/miniPreload.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 } }).outputText;
    vm.runInNewContext(source, { require(name) { assert.equal(name, 'electron'); return electron; }, exports: {} });
    assert.deepEqual(Object.keys(bridge).sort(), ['beginDrag', 'beginResize', 'collapse', 'endDrag', 'endResize', 'expand', 'finish', 'getToday', 'getWindowState', 'moveDrag', 'moveResize', 'onDataChanged', 'onWindowStateChanged', 'openMain', 'openTask', 'showBallMenu', 'start']);
    let args; const unsubscribe = bridge.onDataChanged((...values) => { args = values; });
    listener({ sender: 'private' }, 'untrusted payload'); assert.equal(args.length, 0); unsubscribe();
    assert.equal(removed.fn, listener); assert.equal(removed.channel, 'data:changed');
});

test('mini document and sender cannot use the main window trust boundary', () => {
    const { createSenderValidator } = require('../electron/ipc/validateSender.ts');
    const mainFrame = { url: 'file:///C:/app/out/renderer/index.html' }, miniFrame = { url: 'file:///C:/app/out/renderer/mini.html' };
    const main = { isDestroyed: () => false, webContents: { mainFrame } }, mini = { isDestroyed: () => false, webContents: { mainFrame: miniFrame } };
    const validateMain = createSenderValidator(() => main, mainFrame.url), validateMini = createSenderValidator(() => mini, miniFrame.url);
    assert.throws(() => validateMain({ sender: mini.webContents, senderFrame: miniFrame }), /Untrusted/);
    assert.throws(() => validateMini({ sender: main.webContents, senderFrame: mainFrame }), /Untrusted/);
    assert.doesNotThrow(() => validateMini({ sender: mini.webContents, senderFrame: miniFrame }));
});

test('task-details navigation subscription forwards only the DTO and unsubscribes its own listener', () => {
    const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'); let bridge, listener, removed;
    const electron = { contextBridge: { exposeInMainWorld(_name, value) { bridge = value; } }, ipcRenderer: {
        invoke() {}, on(channel, fn) { assert.equal(channel, 'task:open-details'); listener = fn; }, removeListener(channel, fn) { removed = { channel, fn }; }
    } };
    const source = ts.transpileModule(fs.readFileSync('electron/preload.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { require() { return electron; }, exports: {} });
    const dto = { task: { id: 1 }, occurrence: { taskId: 1 } }; let received;
    const unsubscribe = bridge.onOpenTaskDetails((...args) => { received = args; });
    listener({ sender: 'private' }, dto); assert.deepEqual(received, [dto]); unsubscribe();
    assert.equal(removed.channel, 'task:open-details'); assert.equal(removed.fn, listener);
});
