const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');

test('mini bounds recover offscreen/negative-monitor positions and fit small displays', () => {
    const { fitMiniBounds } = require('../electron/window/miniGeometry.ts');
    const area = { x: 0, y: 0, width: 1280, height: 720 };
    const result = fitMiniBounds({ x: 5000, y: -200 }, [area]);
    assert.ok(result.x >= 0 && result.x + result.width <= 1280);
    assert.ok(result.y >= 0 && result.y + result.height <= 720);
    assert.ok(fitMiniBounds({ x: -1000, y: 100 }, [{ x: -1280, y: 0, width: 1280, height: 720 }, area]).x < 0);
    assert.deepEqual(fitMiniBounds(null, [{ x: 0, y: 0, width: 300, height: 350 }]), { x: 0, y: 0, width: 300, height: 350 });
});

test('mini projection groups running, upcoming, missed and completed separately', () => {
    const { miniSections } = require('../shared/scheduling/miniSchedule.ts');
    const now = Date.parse('2026-10-21T12:00Z');
    const row = (id, start, end, actual = {}) => ({ taskId: id, scheduledStartAt: now + start * 60000, scheduledEndAt: now + end * 60000, record: { id, startedAt: null, endedAt: null, ...actual } });
    const rows = [row(1, -60, 60, { startedAt: now - 30000 }), row(2, 30, 60), row(3, 90, 120), row(4, -120, -60), row(5, -180, -120, { startedAt: now - 10000, endedAt: now })];
    const result = miniSections(rows, now);
    assert.deepEqual(result.running.map(row => row.taskId), [1]);
    assert.deepEqual(result.upcoming.map(row => row.taskId), [2, 3]);
    assert.deepEqual(result.missed.map(row => row.taskId), [4]);
    assert.deepEqual(result.completed.map(row => row.taskId), [5]);
});

test('ball and edge tab fit their own dimensions after monitor changes', () => {
    const { fitMiniBounds } = require('../electron/window/miniGeometry.ts');
    const area = { x: -1280, y: 0, width: 1280, height: 720 };
    assert.deepEqual(fitMiniBounds({ x: 4000, y: 900 }, [area], { width: 56, height: 56 }), { x: -56, y: 664, width: 56, height: 56 });
    assert.deepEqual(fitMiniBounds({ x: -1280, y: 100 }, [area], { width: 32, height: 56 }), { x: -1280, y: 100, width: 32, height: 56 });
});

test('fullscreen observer handles split state output and stops cleanly without late visibility changes', () => {
    const fs = require('node:fs'), ts = require('typescript'), vm = require('node:vm'), { EventEmitter } = require('node:events');
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {}; let killed = false; child.kill = () => { killed = true; };
    const exports = {}, states = [];
    const source = ts.transpileModule(fs.readFileSync('electron/window/fullscreenObserver.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { exports, Buffer, process: { platform: 'win32' }, console, require(name) {
        assert.equal(name, 'node:child_process'); return { spawn(file, args, options) {
            assert.equal(file, 'powershell.exe'); assert.equal(options.windowsHide, true);
            assert.ok(args.includes('-EncodedCommand'));
            const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
            assert.ok(script.includes('GetForegroundWindow')); assert.ok(script.includes('SetProcessDPIAware'));
            return child;
        } };
    } });
    const stop = exports.observeFullscreen(state => states.push(state));
    child.stdout.emit('data', '0\r'); child.stdout.emit('data', '\n1\n0\n');
    assert.deepEqual(states, [false, true, false]);
    stop(); child.stdout.emit('data', '1\n'); child.emit('exit', 1);
    assert.equal(killed, true); assert.deepEqual(states, [false, true, false]);
});

test('single-day mini timetable uses shared planned/actual geometry and lifecycle colors', () => {
    const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
    const MiniDayTimetable = require('../src/components/MiniDayTimetable.tsx').default;
    const at = hour => Date.parse('2026-10-21T00:00Z') + hour * 3600000;
    const row = (taskId, start, end, record = null) => ({ taskId, scheduledStartAt: at(start), scheduledEndAt: at(end), record });
    const data = { date: '2026-10-21', timeZone: 'UTC', now: at(12), tasks: [1, 2, 3, 4].map(id => ({ id, title: 'Task ' + id, category: 'study' })),
        occurrences: [row(1, 14, 15), row(2, 10, 11.5, { startedAt: at(11), endedAt: null }), row(3, 8, 9, { startedAt: at(9), endedAt: at(9.5) }), row(4, 7, 8)] };
    const html = renderToStaticMarkup(React.createElement(MiniDayTimetable, { data, onOpenTask() {} }));
    const card = id => html.match(new RegExp('<button[^>]*data-task-id="' + id + '"[^>]*>'))[0];
    assert.match(card(1), /top:1008px;height:72px/); assert.match(card(1), /is-planned/);
    assert.match(card(2), /top:792px;height:72px/); assert.match(card(2), /is-in-progress/);
    assert.match(card(3), /top:648px;height:36px/); assert.match(card(3), /is-completed/); assert.match(card(3), /is-short/);
    assert.doesNotMatch(card(1), /is-short/); assert.match(html, /--mini-short-expanded-height:48px/);
    assert.match(card(4), /is-missed/); assert.match(html, /Today&#x27;s timetable/);
});

test('mini edge resize preserves opposite edge and clamps dimensions to the work area', () => {
    const { resizeMiniBounds } = require('../electron/window/miniGeometry.ts');
    const bounds = { x: 100, y: 100, width: 340, height: 480 }, area = { x: 0, y: 0, width: 1280, height: 720 };
    assert.deepEqual(resizeMiniBounds(bounds, 'se', -1000, -1000, area), { x: 100, y: 100, width: 260, height: 280 });
    assert.deepEqual(resizeMiniBounds(bounds, 'nw', 1000, 1000, area), { x: 180, y: 300, width: 260, height: 280 });
    assert.deepEqual(resizeMiniBounds(bounds, 'se', 2000, 2000, area), { x: 100, y: 100, width: 800, height: 620 });
});
