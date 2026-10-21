const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
require('./register-typescript.cjs');
const { loadWindowGeometry, trackWindowGeometry } = require('../electron/window/windowGeometry.ts');

const primary = { x: 0, y: 0, width: 1920, height: 1080 };
const secondary = { x: -1600, y: 0, width: 1600, height: 900 };
const fallback = { x: 240, y: 40, width: 1440, height: 1000, minWidth: 760, minHeight: 500 };
function fixture(t) {
    const directory = fs.mkdtempSync(path.join(__dirname, '.window-geometry-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return path.join(directory, 'window-state.json');
}

test('missing, corrupt and invalid state falls back without throwing', (t) => {
    const file = fixture(t);
    assert.deepEqual(loadWindowGeometry(file, [primary], fallback), { bounds: fallback, maximized: false });
    for (const value of ['{', 'null', '[]', JSON.stringify({ x: 0, y: 0, width: -1, height: 800, maximized: false }), JSON.stringify({ x: 0, y: 0, width: 900, height: 800, maximized: 'yes' }), JSON.stringify({ x: 1e20, y: 0, width: 900, height: 800, maximized: false }), ' '.repeat(5000)]) {
        fs.writeFileSync(file, value);
        assert.deepEqual(loadWindowGeometry(file, [primary], fallback), { bounds: fallback, maximized: false });
    }
});

test('restores normal rectangle on a secondary monitor and the maximized flag', (t) => {
    const file = fixture(t);
    const saved = { x: -1500, y: 80, width: 1100, height: 700, maximized: true };
    fs.writeFileSync(file, JSON.stringify(saved));
    const result = loadWindowGeometry(file, [primary, secondary], fallback);
    assert.deepEqual(result, { bounds: { x: -1500, y: 80, width: 1100, height: 700, minWidth: 760, minHeight: 500 }, maximized: true });
});

test('tiny saved rectangles regain usable minimums, except on smaller work areas', (t) => {
    const file = fixture(t);
    for (const saved of [
        { x: 100, y: 100, width: 1, height: 1, maximized: false },
        { x: -500, y: 0, width: 400, height: 300, maximized: true },
    ]) {
        fs.writeFileSync(file, JSON.stringify(saved));
        const { bounds, maximized } = loadWindowGeometry(file, [primary], fallback);
        assert.equal(bounds.width, 760);
        assert.equal(bounds.height, 500);
        assert.equal(bounds.minWidth, 760);
        assert.equal(bounds.minHeight, 500);
        assert.ok(bounds.x >= primary.x && bounds.x + bounds.width <= primary.width);
        assert.equal(maximized, saved.maximized);
        const tinyArea = { x: -500, y: 0, width: 400, height: 300 };
        assert.deepEqual(loadWindowGeometry(file, [tinyArea], fallback).bounds,
            { ...tinyArea, minWidth: 400, minHeight: 300 });
    }
});

test('disconnected displays and oversized or partly offscreen windows fit an available work area', (t) => {
    const file = fixture(t);
    for (const saved of [
        { x: -1500, y: 80, width: 1100, height: 700 },
        { x: 1800, y: 1000, width: 1000, height: 800 },
        { x: 0, y: 0, width: 32000, height: 32000 },
    ]) {
        fs.writeFileSync(file, JSON.stringify({ ...saved, maximized: false }));
        const { bounds } = loadWindowGeometry(file, [primary], fallback);
        assert.ok(bounds.x >= 0 && bounds.y >= 0);
        assert.ok(bounds.x + bounds.width <= primary.width);
        assert.ok(bounds.y + bounds.height <= primary.height);
    }
});

test('saving a minimized hidden maximized window preserves its last normal rectangle', (t) => {
    const file = fixture(t);
    const window = new EventEmitter();
    let normal = { x: 100, y: 80, width: 1000, height: 700 };
    let minimized = false;
    let maximized = false;
    Object.assign(window, {
        isDestroyed: () => false, isMinimized: () => minimized, isMaximized: () => maximized,
        getNormalBounds: () => normal, setMinimumSize: () => {}, setBounds: (bounds) => { normal = bounds; },
    });
    const displays = new EventEmitter();
    displays.getAllDisplays = () => [{ workArea: primary }];
    const save = trackWindowGeometry(window, file, displays);
    window.emit('move');
    maximized = true;
    window.emit('maximize');
    minimized = true;
    normal = { x: -32000, y: -32000, width: 1, height: 1 };
    window.emit('resize');
    save();
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { x: 100, y: 80, width: 1000, height: 700, maximized: true });
});

test('display removal repositions a normal window and releases listeners when closed', (t) => {
    const file = fixture(t);
    const window = new EventEmitter();
    let normal = { x: -1500, y: 80, width: 1100, height: 700 };
    Object.assign(window, { isDestroyed: () => false, isMinimized: () => false, isMaximized: () => false,
        getNormalBounds: () => normal, setMinimumSize: () => {}, setBounds: (bounds) => { normal = bounds; } });
    const displays = new EventEmitter();
    displays.getAllDisplays = () => [{ workArea: primary }];
    trackWindowGeometry(window, file, displays);
    displays.emit('display-removed');
    assert.ok(normal.x >= 0);
    assert.ok(normal.x + normal.width <= primary.width);
    window.emit('closed');
    assert.equal(displays.listenerCount('display-removed'), 0);
});

test('display removal while minimized applies safe bounds when the window restores', (t) => {
    const file = fixture(t);
    const window = new EventEmitter();
    let normal = { x: -1500, y: 80, width: 1100, height: 700 };
    let minimized = true;
    Object.assign(window, { isDestroyed: () => false, isMinimized: () => minimized, isMaximized: () => false,
        getNormalBounds: () => normal, setMinimumSize: () => {}, setBounds: (bounds) => { normal = bounds; } });
    const displays = new EventEmitter();
    displays.getAllDisplays = () => [{ workArea: primary }];
    trackWindowGeometry(window, file, displays);
    displays.emit('display-removed');
    minimized = false;
    window.emit('restore');
    assert.ok(normal.x >= 0);
});
