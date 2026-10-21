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
