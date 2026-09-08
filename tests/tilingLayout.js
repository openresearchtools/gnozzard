// SPDX-License-Identifier: GPL-3.0-or-later
import * as T from '../extension/gnozzard@openresearchtools/tilingLayout.js';

let count = 0;
function assert(value, message) {
    count++;
    if (!value) throw new Error(message);
}
function equal(a, b, message) {
    assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}
const area = {x: 20, y: 40, width: 1600, height: 1000};
const sizes = new Map(Array.from({length: 120}, (_, id) => [id, {width: 160, height: 100}]));
const leaves = (tree, bounds = area) => T.layout(tree, bounds, sizes).regions.filter(r => r.node.id !== undefined);
const rects = tree => Object.fromEntries(leaves(tree).map(r => [r.node.id, r.rect]));
function valid(tree, bounds = area) {
    const nodes = leaves(tree, bounds);
    equal(nodes.reduce((sum, r) => sum + r.rect.width * r.rect.height, 0), bounds.width * bounds.height,
        'Tiles cover the entire work area with no inner or outer gaps');
    assert(new Set(T.ids(tree)).size === T.ids(tree).length, 'No duplicate windows');
    for (const {node, rect: r} of nodes) {
        const min = T.minimum(node, sizes);
        assert(r.width >= min.width && r.height >= min.height, 'Respect application minimum');
        assert(r.x >= bounds.x && r.y >= bounds.y &&
            r.x + r.width <= bounds.x + bounds.width && r.y + r.height <= bounds.y + bounds.height,
        'Within native work area');
        for (const other of nodes) {
            if (other.node === node) continue;
            const s = other.rect;
            assert(r.x + r.width <= s.x || s.x + s.width <= r.x ||
                r.y + r.height <= s.y || s.y + s.height <= r.y, 'Tiles do not overlap');
        }
    }
}

const workplaces = [null];
for (let id = 0; id < 120; id++) {
    let placed = false;
    for (let index = 0; index < workplaces.length; index++) {
        const next = T.insert(workplaces[index], id, area, sizes);
        if (next) { workplaces[index] = next; placed = true; break; }
    }
    if (!placed) workplaces.push(T.leaf(id));
    workplaces.forEach(tree => valid(tree));
    equal(workplaces.flatMap(T.ids).sort((a, b) => a - b), Array.from({length: id + 1}, (_, n) => n), 'Insertion never loses a window');
}
assert(workplaces.length > 1, 'Overflow requires another workplace, never a stack');
equal(T.layout(T.leaf(0), area, sizes).regions[0].rect, area, 'First window fills work area');

const rows = T.preset([0, 1, 2, 3], 'rows', area, sizes).tree;
const before = rects(rows);
const resized = T.resize(rows, area, sizes, [], 80, false);
const after = rects(resized);
equal(before[0], after[0], 'Four rows: A untouched when B/C divider moves');
equal(before[3], after[3], 'Four rows: D untouched when B/C divider moves');
equal(after[1].height, before[1].height + 80, 'B grows');
equal(after[2].height, before[2].height - 80, 'C shrinks');
valid(resized);
valid(T.resize(rows, area, sizes, [], 100000, false));
valid(T.resize(rows, area, sizes, [], -100000, false));

const grid = T.split('x', T.split('y', T.leaf(0), T.leaf(1)), T.split('y', T.leaf(2), T.leaf(3)));
const gridBefore = rects(grid);
const independent = T.resize(grid, area, sizes, ['a'], 75, false);
equal(rects(independent)[2], gridBefore[2], 'Independent divider leaves other column alone');
const linked = T.resize(grid, area, sizes, ['a'], 75, true);
equal(rects(linked)[0].height, rects(linked)[2].height, 'Linked dividers stay aligned');
valid(independent); valid(linked);

const top = T.dock(grid, 3, [0, 1, 2, 3], 'top', area, sizes);
equal(rects(top)[3].width, area.width, 'Whole desktop top edge makes full-width row');
const nested = T.dock(grid, 3, [0, 1], 'left', area, sizes);
valid(nested);
equal(rects(nested)[2], {...gridBefore[2], height: area.height}, 'Source sibling closes gap');
const swapped = T.dock(grid, 0, [3], 'centre', area, sizes);
equal(rects(swapped)[0], gridBefore[3], 'Centre drop swaps target');
equal(rects(swapped)[3], gridBefore[0], 'Centre drop swaps origin');
equal(rects(swapped)[1], gridBefore[1], 'Swap leaves unrelated windows unchanged');
valid(swapped);

const hit = T.hit(grid, area, sizes, 450, 300, 0);
equal(hit.node.id, 0, 'Pointer finds target window');
const scope = T.hit(grid, area, sizes, 450, 300, 1);
equal(T.ids(scope.node), [0, 1], 'Expanded scope finds containing column');
equal(T.hit(grid, area, sizes, 21, 300).side, 'left', 'Outer edge targets whole desktop');
equal(T.hit(grid, area, sizes, 0, 300).side, 'left', 'Actual monitor edge remains a drop target outside the inset work area');
equal(T.hit(grid, area, sizes, 450, 0).side, 'top', 'Drop over top panel targets the top work-area edge');
equal(T.remove(T.leaf(0), 0), null, 'Last close empties layout');
equal(T.ids(T.remove(grid, 1)).sort(), [0, 2, 3], 'Remove closes only source gap');

const small = {x: 0, y: 0, width: 320, height: 240};
const smallLayout = T.preset([0, 1, 2, 3], 'columns', small, sizes);
equal([...T.ids(smallLayout.tree), ...smallLayout.overflow].sort(), [0, 1, 2, 3], 'Overflow explicitly identifies every displaced window');
valid(smallLayout.tree, small);
const wide = {x: 0, y: 0, width: 7680, height: 2160};
const columns = T.preset(Array.from({length: 24}, (_, i) => i), 'columns', wide, sizes).tree;
equal(leaves(columns, wide).length, 24, 'Ultrawide is not capped at four windows');
valid(columns, wide);
for (const kind of ['rows', 'columns', 'top', 'side', 'auto'])
    valid(T.preset([0, 1, 2, 3], kind, area, sizes).tree);

const desktop = {x: 8, y: 40, width: 1264, height: 712};
const gtkSizes = new Map([[0, {width: 410, height: 430}], [1, {width: 410, height: 250}],
    [2, {width: 410, height: 344}]]);
const premature = T.split('x', T.split('y', T.leaf(0), T.leaf(2)), T.leaf(1));
const recovered = T.fit(premature, desktop, gtkSizes);
equal([...T.ids(recovered.tree), ...recovered.overflow].sort(), [0, 1, 2],
    'A changed minimum displaces windows explicitly, without overlapping or losing them');
equal(recovered.overflow, [], 'Client minimum negotiation rearranges a split when all three windows still fit');
assert(T.fit(recovered.tree, desktop, gtkSizes).tree === recovered.tree,
    'A valid user layout is preserved without rebuilding or resetting divider ratios');
const oversized = new Map(gtkSizes);
oversized.set(2, {width: 1200, height: 650});
equal(T.fit(premature, desktop, oversized).overflow, [2],
    'A new window that cannot fit moves out, not the older neighbour at the end of tree order');
const readyLayout = [0, 1, 2].reduce((tree, id) => T.insert(tree, id, desktop, gtkSizes), null);
equal(T.layout(readyLayout, desktop, gtkSizes).regions.filter(r => r.node.id !== undefined).length, 3,
    'Wait for real GTK minimums: all three windows fit without overlap');

const constrained = new Map([[0, {width: 400, height: 200}], [1, {width: 400, height: 200}],
    [2, {width: 980, height: 352}]]);
const twoColumns = T.split('x', T.leaf(0), T.leaf(1));
const fullWidthRow = T.insert(twoColumns, 2, desktop, constrained);
assert(fullWidthRow !== null, 'Wide app fits below existing columns without a new workplace');
equal(fullWidthRow.axis, 'y', 'Existing columns become a group above the new full-width row');
equal(T.layout(fullWidthRow, desktop, constrained).regions.find(r => r.node.id === 2).rect.width,
    desktop.width, 'New wide app gets the full desktop width');
equal(twoColumns, T.split('x', T.leaf(0), T.leaf(1)), 'Insertion does not mutate the original tree');

const boundary = T.layout(grid, area, sizes).cuts[0];
equal(boundary.rect.width, 0, 'Shared boundary takes no width from either application');

const twoRows = T.split('y', T.leaf(0), T.leaf(1));
for (const side of ['left', 'right']) {
    const columns = T.dock(twoRows, 0, [0, 1], side, area, sizes);
    equal(columns.axis, 'x', `${side} edge changes two rows into columns`);
    valid(columns);
}
for (const side of ['top', 'bottom']) {
    const rows = T.dock(twoColumns, 0, [0, 1], side, area, sizes);
    equal(rows.axis, 'y', `${side} edge changes two columns into rows`);
    valid(rows);
}
const topPair = T.split('y', T.split('x', T.leaf(0), T.leaf(1)), T.split('x', T.leaf(2), T.leaf(3)));
const rowTarget = T.hit(topPair, area, sizes, 1580, 290, 1);
equal(T.ids(rowTarget.node), [0, 1], 'Expanded pointer scope selects the top row');
equal(rowTarget.side, 'right', 'Pointer next to row edge selects insertion on its right');
const threeOnTop = T.dock(topPair, 3, T.ids(rowTarget.node), rowTarget.side, area, sizes);
equal(T.ids(threeOnTop.a), [0, 1, 3], 'Drop at a row group edge makes three across the top');
const topRects = rects(threeOnTop);
assert(Math.abs(topRects[0].width - topRects[3].width) <= 1,
    'Adding to a row gives the new app one third, not half of the entire row');
equal(topRects[2].width, area.width, 'Remaining bottom window fills its row');
valid(threeOnTop);
const threeWindows = T.split('y', T.split('x', T.leaf(0), T.leaf(1)), T.leaf(2));
const bottomRight = T.hit(threeWindows, area, sizes, 1620, 1040);
equal(bottomRight.node.id, 2, 'Corner targets the window already in that corner');
equal(bottomRight.side, 'right', 'Corner splits a wide row into left/right quarters');
const cornerDock = T.dock(threeWindows, 0, T.ids(bottomRight.node), bottomRight.side, area, sizes);
equal(rects(cornerDock)[0], {x: 820, y: 540, width: 800, height: 500},
    'Corner drop produces the bottom-right quarter');
valid(cornerDock);
const zoteroFirefox = new Map([[0, {width: 979, height: 352}], [1, {width: 552, height: 172}]]);
equal(T.dock(twoRows, 0, [0, 1], 'left', desktop, zoteroFirefox), null,
    'App minimum widths exceeding the monitor reject a side-by-side layout, never overlap');

// Layout cells partition the area exactly; the app frames inside them have
// four-pixel shared gaps and four-pixel outer margins, never doubled gutters.
const paddedSizes = new Map([...sizes].map(([id, s]) =>
    [id, {width: s.width + T.GAP, height: s.height + T.GAP}]));
function validGaps(tree, workarea) {
    const cellArea = T.inset(workarea);
    const {regions, cuts} = T.layout(tree, cellArea, paddedSizes);
    const frames = regions.filter(r => r.node.id !== undefined)
        .map(r => ({id: r.node.id, rect: T.inset(r.rect)}));
    for (const {id, rect: r} of frames) {
        assert(r.width >= sizes.get(id).width && r.height >= sizes.get(id).height,
            'Padding never consumes the application minimum size');
        assert(r.x >= workarea.x + 4 && r.y >= workarea.y + 4 &&
            r.x + r.width <= workarea.x + workarea.width - 4 &&
            r.y + r.height <= workarea.y + workarea.height - 4, 'Outer margins are at least four pixels');
        assert(Object.values(r).every(Number.isInteger), 'Odd monitor dimensions still give integer app frames');
    }
    equal(Math.min(...frames.map(f => f.rect.x)), workarea.x + 4, 'Exact left margin');
    equal(Math.min(...frames.map(f => f.rect.y)), workarea.y + 4, 'Exact top margin');
    equal(Math.max(...frames.map(f => f.rect.x + f.rect.width)), workarea.x + workarea.width - 4, 'Exact right margin');
    equal(Math.max(...frames.map(f => f.rect.y + f.rect.height)), workarea.y + workarea.height - 4, 'Exact bottom margin');
    for (const cut of cuts) {
        const axis = cut.axis, dimension = axis === 'x' ? 'width' : 'height';
        const region = regions.find(r => r.path.join('/') === cut.path.join('/'));
        const aIds = T.ids(region.node.a), bIds = T.ids(region.node.b);
        const aEnd = Math.max(...frames.filter(f => aIds.includes(f.id)).map(f => f.rect[axis] + f.rect[dimension]));
        const bStart = Math.min(...frames.filter(f => bIds.includes(f.id)).map(f => f.rect[axis]));
        equal(bStart - aEnd, 4, 'Every nested split has exactly four pixels between frames');
        equal(cut.rect[axis] - aEnd, 2, 'Divider stays centred in the gap');
    }
}
for (const workarea of [area, {x: -1280, y: 32, width: 1281, height: 729}, wide]) {
    for (const kind of ['rows', 'columns', 'top', 'side', 'auto']) {
        const cellArea = T.inset(workarea);
        for (const n of [1, 2, 3, 4, 12, 24]) {
            const tree = T.preset(Array.from({length: n}, (_, i) => i), kind, cellArea, paddedSizes).tree;
            validGaps(tree, workarea);
            for (const cut of T.layout(tree, cellArea, paddedSizes).cuts) {
                for (const delta of [-100000, -37, 37, 100000])
                    validGaps(T.resize(tree, cellArea, paddedSizes, cut.path, delta, true), workarea);
            }
        }
    }
}
const exactFit = {x: 0, y: 0, width: 332, height: 108};
equal(T.ids(T.insert(T.leaf(0), 1, T.inset(exactFit), paddedSizes)), [0, 1],
    'Two 160px windows fit with 4px shared gap and 4px outer margins');
equal(T.insert(T.leaf(0), 1, T.inset({...exactFit, width: 331}), paddedSizes), null,
    'One pixel below the minimum including gaps uses existing overflow, never overlaps');

print(`Tiling geometry: ${count} assertions passed`);
