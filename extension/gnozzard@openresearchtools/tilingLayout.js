// SPDX-License-Identifier: GPL-3.0-or-later
// Geometry only: native windows and Shell actors belong to tiling.js.
export const GAP = 4;
// Each layout cell includes half the shared gap on each side. Insetting the
// work area by the other half gives the same four pixels at the outer edges.
export function inset(rect, amount = GAP / 2) {
    return {x: rect.x + amount, y: rect.y + amount,
        width: Math.max(1, rect.width - 2 * amount), height: Math.max(1, rect.height - 2 * amount)};
}

export const copy = tree => tree ? JSON.parse(JSON.stringify(tree)) : null;
export const ids = tree => !tree ? [] : tree.id !== undefined ? [tree.id] : [...ids(tree.a), ...ids(tree.b)];
export const leaf = id => ({id});
export const split = (axis, a, b, ratio = 0.5) => ({axis, a, b, ratio});

export function minimum(tree, sizes) {
    if (tree.id !== undefined)
        return sizes.get(tree.id) ?? {width: 160, height: 100};
    const a = minimum(tree.a, sizes), b = minimum(tree.b, sizes);
    return tree.axis === 'x'
        ? {width: a.width + b.width, height: Math.max(a.height, b.height)}
        : {width: Math.max(a.width, b.width), height: a.height + b.height};
}

export function layout(tree, area, sizes = new Map()) {
    const regions = [], cuts = [];
    function walk(node, rect, path) {
        if (!node)
            return;
        regions.push({node, rect, path});
        if (node.id !== undefined)
            return;
        const horizontal = node.axis === 'x', dimension = horizontal ? 'width' : 'height';
        const available = Math.max(1, rect[dimension]);
        const amin = minimum(node.a, sizes)[dimension], bmin = minimum(node.b, sizes)[dimension];
        const desired = Math.round(available * node.ratio);
        const extent = amin + bmin <= available
            ? Math.max(amin, Math.min(available - bmin, desired)) : desired;
        const a = {...rect}, b = {...rect};
        a[dimension] = extent;
        b[node.axis] += extent;
        b[dimension] = available - extent;
        const cut = {...rect};
        cut[node.axis] += extent;
        cut[dimension] = 0;
        cuts.push({path, axis: node.axis, rect: cut});
        walk(node.a, a, [...path, 'a']);
        walk(node.b, b, [...path, 'b']);
    }
    walk(tree, area, []);
    return {regions, cuts};
}

export const at = (tree, path) => path.reduce((node, branch) => node[branch], tree);
export function replace(tree, path, value) {
    if (!path.length)
        return value;
    const [branch, ...tail] = path;
    return {...tree, [branch]: replace(tree[branch], tail, value)};
}

export function remove(tree, id) {
    if (!tree)
        return null;
    if (tree.id !== undefined)
        return tree.id === id ? null : tree;
    const a = remove(tree.a, id), b = remove(tree.b, id);
    return a && b ? {...tree, a, b} : a || b;
}

export function insert(tree, id, area, sizes) {
    if (!tree)
        return leaf(id);
    // Prefer splitting a window, then its containing groups. A wide new app
    // may fit below two columns even when neither column can contain it.
    const candidates = layout(tree, area, sizes).regions.sort((a, b) =>
        Number(b.node.id !== undefined) - Number(a.node.id !== undefined) ||
        (a.node.id === undefined ? b.path.length - a.path.length :
            b.rect.width * b.rect.height - a.rect.width * a.rect.height));
    for (const r of candidates) {
        const axes = r.rect.width >= r.rect.height ? ['x', 'y'] : ['y', 'x'];
        for (const axis of axes) {
            const candidate = replace(copy(tree), r.path, split(axis, copy(r.node), leaf(id)));
            const min = minimum(candidate, sizes);
            if (min.width <= area.width && min.height <= area.height)
                return candidate;
        }
    }
    // No stacking or overlapping layout. The controller moves this window to
    // another native workplace using the same operation as the taskbar menu.
    return null;
}

export function fit(tree, area, sizes) {
    if (!tree || tree.id !== undefined)
        return {tree, overflow: []};
    const min = minimum(tree, sizes);
    if (min.width <= area.width && min.height <= area.height)
        return {tree, overflow: []};
    // A newly committed minimum can invalidate the original split. Use the
    // same insertion operation with the real sizes, keeping older windows
    // first. Geometric tree order must not evict an arbitrary older neighbour.
    const overflow = [];
    let fitted = null;
    for (const id of ids(tree).sort((a, b) => a - b)) {
        const next = insert(fitted, id, area, sizes);
        if (next) fitted = next;
        else overflow.push(id);
    }
    return {tree: fitted, overflow};
}

export function dock(tree, id, targetIds, side, area, sizes) {
    if (side === 'centre') {
        const other = targetIds.find(value => value !== id);
        if (other === undefined)
            return tree;
        const result = copy(tree);
        function swap(node) {
            if (node.id !== undefined) {
                node.id = node.id === id ? other : node.id === other ? id : node.id;
            } else { swap(node.a); swap(node.b); }
        }
        swap(result);
        return result;
    }
    let result = remove(copy(tree), id);
    if (!result)
        return leaf(id);
    const wanted = targetIds.filter(value => value !== id).sort((a, b) => a - b).join(',');
    const target = layout(result, area, sizes).regions.find(r =>
        ids(r.node).sort((a, b) => a - b).join(',') === wanted);
    if (!target)
        return tree;
    const axis = side === 'left' || side === 'right' ? 'x' : 'y';
    const parts = target.node.axis === axis ? ids(target.node).length + 1 : 2;
    const next = side === 'left' || side === 'top'
        ? split(axis, leaf(id), target.node, 1 / parts)
        : split(axis, target.node, leaf(id), 1 - 1 / parts);
    const min = minimum(next, sizes);
    if (min.width > target.rect.width || min.height > target.rect.height)
        return null;
    return replace(result, target.path, next);
}

export function hit(tree, area, sizes, x, y, scope = 0) {
    const {regions} = layout(tree, area, sizes);
    if (!tree)
        return null;
    // The controller has already selected the pointer's monitor. Its panel and
    // taskbar lie outside the work area but must still accept screen-edge drops.
    x = Math.max(area.x, Math.min(area.x + area.width, x));
    y = Math.max(area.y, Math.min(area.y + area.height, y));
    function edge(rect) {
        return [{side: 'left', distance: x - rect.x},
            {side: 'right', distance: rect.x + rect.width - x},
            {side: 'top', distance: y - rect.y},
            {side: 'bottom', distance: rect.y + rect.height - y}]
            .sort((a, b) => a.distance - b.distance)[0];
    }
    const under = regions.find(r => r.node.id !== undefined && x >= r.rect.x && y >= r.rect.y &&
        x <= r.rect.x + r.rect.width && y <= r.rect.y + r.rect.height);
    const horizontal = x - area.x <= 24 ? 'left' : area.x + area.width - x <= 24 ? 'right' : null;
    const vertical = y - area.y <= 24 ? 'top' : area.y + area.height - y <= 24 ? 'bottom' : null;
    if (horizontal && vertical && under && !scope && ids(tree).length >= 3) {
        // A corner splits the window already occupying it. For example, split
        // a full-width row sideways to put this app in its left/right quarter.
        return {node: under.node, side: under.rect.width >= under.rect.height ? horizontal : vertical,
            label: `${vertical}-${horizontal} window`};
    }
    const outer = edge(area);
    if (outer.distance <= 24)
        return {node: tree, side: outer.side, label: 'Whole desktop'};
    if (!under)
        return null;
    const path = under.path.slice(0, Math.max(0, under.path.length - scope));
    const region = regions.find(r => r.path.join('/') === path.join('/'));
    const near = edge(region.rect);
    const side = region.node.id !== undefined && near.distance > Math.min(region.rect.width, region.rect.height) * 0.27
        ? 'centre' : near.side;
    return {node: region.node, side, label: !path.length ? 'Whole desktop' :
        region.node.id !== undefined ? 'Window' : 'Window group'};
}

export function resize(tree, area, sizes, path, delta, linked) {
    const original = layout(tree, area, sizes);
    const cut = original.cuts.find(c => c.path.join('/') === path.join('/'));
    if (!cut)
        return tree;
    const axis = cut.axis, dimension = axis === 'x' ? 'width' : 'height';
    const otherAxis = axis === 'x' ? 'y' : 'x', otherDimension = axis === 'x' ? 'height' : 'width';
    const cuts = linked ? original.cuts.filter(c => c.axis === axis &&
        Math.abs(c.rect[axis] - cut.rect[axis]) <= 1) : [cut];
    const leaves = original.regions.filter(r => r.node.id !== undefined);
    const touching = new Map();
    for (const c of cuts) {
        for (const r of leaves) {
            const overlap = Math.min(r.rect[otherAxis] + r.rect[otherDimension],
                c.rect[otherAxis] + c.rect[otherDimension]) - Math.max(r.rect[otherAxis], c.rect[otherAxis]);
            if (overlap <= 0)
                continue;
            if (Math.abs(r.rect[axis] + r.rect[dimension] - c.rect[axis]) <= 1)
                touching.set(r, true);
            else if (Math.abs(r.rect[axis] - c.rect[axis]) <= 1)
                touching.set(r, false);
        }
    }
    let low = -Infinity, high = Infinity;
    for (const [r, before] of touching) {
        const min = minimum(r.node, sizes)[dimension];
        if (before) low = Math.max(low, min - r.rect[dimension]);
        else high = Math.min(high, r.rect[dimension] - min);
    }
    delta = Math.round(Math.max(low, Math.min(high, delta)));
    const rects = new Map(leaves.map(r => [r.node.id, {...r.rect}]));
    for (const [r, before] of touching) {
        const rect = rects.get(r.node.id);
        rect[dimension] += before ? delta : -delta;
        if (!before) rect[axis] += delta;
    }
    const result = copy(tree);
    function rebuild(node) {
        if (node.id !== undefined)
            return rects.get(node.id);
        const a = rebuild(node.a), b = rebuild(node.b);
        const r = {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y)};
        r.width = Math.max(a.x + a.width, b.x + b.width) - r.x;
        r.height = Math.max(a.y + a.height, b.y + b.height) - r.y;
        node.ratio = node.axis === 'x' ? a.width / r.width : a.height / r.height;
        return r;
    }
    rebuild(result);
    return result;
}

export function preset(windowIds, kind, area, sizes) {
    function divide(values, axis) {
        if (values.length === 1)
            return leaf(values[0]);
        const middle = Math.ceil(values.length / 2);
        return split(axis, divide(values.slice(0, middle), axis),
            divide(values.slice(middle), axis), middle / values.length);
    }
    if (!windowIds.length)
        return {tree: null, overflow: []};
    let tree;
    if (kind === 'rows' || kind === 'columns')
        tree = divide(windowIds, kind === 'rows' ? 'y' : 'x');
    else if (kind === 'top' || kind === 'side')
        tree = windowIds.length === 1 ? leaf(windowIds[0]) : split(kind === 'top' ? 'y' : 'x',
            leaf(windowIds[0]), divide(windowIds.slice(1), kind === 'top' ? 'x' : 'y'));
    else {
        const overflow = [];
        tree = null;
        for (const id of windowIds) {
            const next = insert(tree, id, area, sizes);
            if (next) tree = next;
            else overflow.push(id);
        }
        return {tree, overflow};
    }
    return fit(tree, area, sizes);
}
