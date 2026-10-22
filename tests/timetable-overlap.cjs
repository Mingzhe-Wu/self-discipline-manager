const assert = require('node:assert/strict');
const { test } = require('node:test');
require('./register-typescript.cjs');
const { layoutOverlaps, rangeGeometry, displayRangeGeometry } = require('../src/timetableLayout.ts');
const range = (taskId, startMinute, endMinute) => ({ taskId, startMinute, endMinute });
test('overlap groups use partially overlapping deterministic widths', () => {
    for (const count of [2, 3, 4, 8]) {
        const ranges = Array.from({ length: count }, (_, i) => range(i + 1, 600, 660 + i * 5));
        const layout = layoutOverlaps(ranges);
        assert.ok(layout.every((row) => row.groupSize === count && Math.abs(row.widthFraction - 1.05 / count) < 1e-10));
        assert.deepEqual(layout.map((row) => row.column), ranges.map((_, i) => i));
    }
});
test('shared end boundaries group without sharing a start', () => {
    const rows = layoutOverlaps([range(1, 600, 780), range(2, 660, 780)]);
    assert.deepEqual(rows.map((row) => row.groupSize), [2, 2]);
});
test('shared boundaries are transitive and input permutation cannot change column assignment', () => {
    const ranges = [range(30, 660, 780), range(10, 600, 720), range(20, 600, 780)];
    const expected = layoutOverlaps(ranges);
    assert.deepEqual(expected.map((row) => row.groupSize), [3, 3, 3]);
    assert.deepEqual(expected.map((row) => row.column), [2, 0, 1]);
    for (const order of [ranges.toReversed(), [ranges[1], ranges[0], ranges[2]]]) {
        const actual = layoutOverlaps(order);
        for (let i = 0; i < order.length; i++) assert.deepEqual(actual[i], expected[ranges.indexOf(order[i])]);
    }
    assert.deepEqual(layoutOverlaps(ranges), expected);
});
test('stable task IDs break equal-boundary ties without depending on array order', () => {
    const a = range(9, 600, 720), b = range(3, 600, 720);
    assert.deepEqual(layoutOverlaps([a, b]).map((row) => row.column), [1, 0]);
    assert.deepEqual(layoutOverlaps([b, a]).map((row) => row.column), [0, 1]);
});
test('shared starts use the same staggered width policy as other overlaps', () => {
    const layout = layoutOverlaps([range(1, 600, 840), range(2, 600, 720)]);
    assert.ok(layout.every((row) => row.widthFraction === .525));
});
test('strict containment narrows both cards and places the contained task above', () => {
    const layout = layoutOverlaps([range(1, 600, 840), range(2, 660, 720)]);
    assert.ok(layout.every((row) => row.widthFraction === .525));
    assert.ok(layout[1].zIndex > layout[0].zIndex);
});
test('ordinary partial overlap narrows cards and puts the later start above', () => {
    const layout = layoutOverlaps([range(1, 600, 720), range(2, 660, 780)]);
    assert.deepEqual(layout.map((row) => row.groupSize), [2, 2]);
    assert.ok(layout[1].zIndex > layout[0].zIndex);
});
test('touching end-to-start boundaries do not form a layout group', () => {
    assert.deepEqual(layoutOverlaps([range(1, 600, 720), range(2, 720, 780)]).map((row) => row.groupSize), [1, 1]);
});
test('layout never mutates order, times or planned vertical geometry', () => {
    const ranges = [range(3, 660, 780), range(1, 600, 720), range(2, 600, 780)];
    const original = structuredClone(ranges);
    const before = ranges.map((row) => rangeGeometry(row.startMinute, row.endMinute));
    layoutOverlaps(ranges);
    assert.deepEqual(ranges, original);
    assert.deepEqual(ranges.map((row) => rangeGeometry(row.startMinute, row.endMinute)), before);
});
test('visually intersecting midnight segments remain individually selectable', () => {
    const layout = layoutOverlaps([
        { ...range(1, 0, 60), scheduledStartAt: -60, scheduledEndAt: 60 },
        { ...range(2, 0, 90), scheduledStartAt: -30, scheduledEndAt: 90 },
    ]);
    assert.deepEqual(layout.map((row) => row.groupSize), [2, 2]);
});

test('five and ten minute cards render fifteen minute height without changing their true planned geometry',()=>{
 for(const duration of [5,10,15,25]){const g=displayRangeGeometry(540,540+duration,1.25);assert.equal(g.top,675);assert.equal(g.height,Math.max(duration,15)*1.25);assert.equal(g.plannedHeight,duration*1.25);}
});
test('staggered cards expose every column, overlap their neighbors and fill the usable width',()=>{
 for(const count of [2,3,4,8]){const layout=layoutOverlaps(Array.from({length:count},(_,i)=>range(i+1,600,660)));assert.equal(layout[0].offsetFraction,0);for(let i=1;i<count;i++){assert.ok(layout[i].offsetFraction>layout[i-1].offsetFraction);assert.ok(layout[i].offsetFraction<layout[i-1].offsetFraction+layout[i-1].widthFraction);}assert.ok(Math.abs(layout.at(-1).offsetFraction+layout.at(-1).widthFraction-1)<1e-10);}
});
test('minimum visual duration groups adjacent short cards without changing planned endpoints',()=>{
 const ranges=[range(1,540,545),range(2,545,550),range(3,550,555)];const before=structuredClone(ranges);assert.deepEqual(layoutOverlaps(ranges,15).map(r=>r.groupSize),[3,3,3]);assert.deepEqual(ranges,before);
});

test('hover expansion anchors downward and only flips upward when the visible bottom cannot fit it', () => {
    const { hoverExpansionOffset } = require('../src/timetableLayout.ts');
    assert.equal(hoverExpansionOffset(200, 20, 120, 600), 0);
    assert.equal(hoverExpansionOffset(480, 20, 120, 600), 0);
    assert.equal(hoverExpansionOffset(540, 20, 120, 600), -100);
    assert.equal(hoverExpansionOffset(200, 180, 180, 600), 0);
});

test('a long task with many sequential short tasks needs only two reusable columns', () => {
    const ranges = [range(1, 0, 1440), ...Array.from({ length: 10 }, (_, i) => range(i + 2, 60 + i * 90, 90 + i * 90))];
    const before = structuredClone(ranges), layout = layoutOverlaps(ranges, 15);
    assert.ok(layout.every(row => row.groupSize === 2 && row.widthFraction === .525));
    assert.equal(layout[0].column, 0); assert.ok(layout.slice(1).every(row => row.column === 1));
    assert.deepEqual(ranges, before);
    const reversed = layoutOverlaps(ranges.toReversed(), 15).toReversed();
    assert.deepEqual(reversed, layout);
});

test('a chained overlap reuses an ended task column instead of narrowing every member', () => {
    const layout = layoutOverlaps([range(1, 600, 720), range(2, 660, 780), range(3, 720, 840)]);
    assert.deepEqual(layout.map(row => row.column), [0, 1, 0]);
    assert.ok(layout.every(row => row.groupSize === 2));
});

test('a brief three-way overlap uses three columns and later tasks reuse released columns', () => {
    const layout = layoutOverlaps([range(1, 0, 1440), range(2, 60, 120), range(3, 90, 150), range(4, 300, 360), range(5, 500, 560)], 15);
    assert.ok(layout.every(row => row.groupSize === 3));
    assert.ok(layout.slice(0, 3).every(row => Math.abs(row.widthFraction - .35) < 1e-10));
    assert.ok(layout.slice(3).every(row => Math.abs(row.widthFraction - .675) < 1e-10));
    assert.deepEqual(layout.map(row => row.column), [0, 1, 2, 1, 1]);
});

test('a short task fills consecutive free columns to its right while later overlapping cards stay separate', () => {
    const rows = [range(1, 0, 1440), range(2, 540, 600), range(3, 720, 840), range(4, 780, 840)];
    const layout = layoutOverlaps(rows, 15);
    assert.ok(Math.abs(layout[1].widthFraction + layout[1].offsetFraction - 1) < 1e-10);
    assert.ok(Math.abs(layout[1].widthFraction - .675) < 1e-10);
    assert.ok(Math.abs(layout[2].widthFraction - .35) < 1e-10);
    assert.deepEqual(layoutOverlaps(rows.toReversed(), 15).toReversed(), layout);
});

test('rightward fill cannot cover a column occupied during even part of the task visual interval', () => {
    const layout = layoutOverlaps([range(1, 0, 1440), range(2, 540, 600), range(3, 595, 620)], 15);
    assert.ok(layout.every(row => Math.abs(row.widthFraction - .35) < 1e-10));
    const floor = layoutOverlaps([range(1, 0, 1440), range(2, 540, 545), range(3, 550, 555)], 15);
    assert.ok(floor.every(row => Math.abs(row.widthFraction - .35) < 1e-10));
});
