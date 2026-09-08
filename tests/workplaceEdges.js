// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';

let checks = 0;
function assert(value, message) { checks++; if (!value) throw new Error(message); }
class Signals {
    constructor() { this.signals = new Map(); this.next = 1; }
    connect(name, callback) { const id = this.next++; this.signals.set(id, {name, callback}); return id; }
    disconnect(id) { this.signals.delete(id); }
    emit(name, event) {
        for (const signal of [...this.signals.values()])
            if (signal.name === name) signal.callback(this, event);
    }
}
class Actor extends Signals {
    constructor(properties) { super(); Object.assign(this, properties); this.visible = true; }
    destroy() { this.destroyed = true; this.signals.clear(); }
}
const monitor = {x: 0, y: 0, width: 1280, height: 800};
const area = {x: 0, y: 32, width: 1280, height: 728};
const settings = new Signals(); settings.enabled = false; settings.get_boolean = () => settings.enabled;
let pointer = [600, 400], active = 0;
const workspaces = Array.from({length: 3}, (_, index) => ({index,
    get_work_area_for_monitor: () => area}));
const native = {display: new Signals(), stage: new Signals(), get_pointer: () => pointer,
    workspace_manager: {get_active_workspace: () => workspaces[active],
        get_active_workspace_index: () => active, get_n_workspaces: () => workspaces.length,
        get_workspace_by_index: index => workspaces[index]}};
native.stage.is_grabbed = false;
const layout = new Signals(); layout.monitors = [monitor];
const chrome = new Set();
layout.addChrome = (actor, options) => {
    assert(!options.affectsStruts, 'Edge sensors never reserve window space'); chrome.add(actor);
};
layout.removeChrome = actor => chrome.delete(actor);
const overview = new Signals(); overview.visible = false;
const sessionMode = new Signals(); sessionMode.hasWindows = true; sessionMode.isLocked = false;
let moves = 0;
const Main = {layoutManager: layout, overview, sessionMode, modalCount: 0,
    wm: {actionMoveWorkspace(workspace) { moves++; active = workspace.index; }}};
const Clutter = {EVENT_PROPAGATE: 0, EventType: {MOTION: 1, LEAVE: 2}};
const [, bytes] = GLib.file_get_contents('extension/gnozzard@openresearchtools/workplaceEdges.js');
const source = new TextDecoder().decode(bytes).replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
const {edgeSegments, WorkplaceEdges} = new Function('Clutter', 'St', 'Main', 'global',
    source + '\nreturn {edgeSegments,WorkplaceEdges};')(Clutter, {Widget: Actor}, Main, native);

const edges = new WorkplaceEdges(settings);
assert(chrome.size === 0, 'Default-off feature creates no sensors');
settings.enabled = true; settings.emit('changed::edge-switch-workplaces');
assert(chrome.size === 2, 'One monitor has two exposed side sensors');
assert([...chrome].every(a => a.y === 32 && a.height === 728), 'Fixed bars are excluded from the side sensors');
const enter = direction => {
    pointer = [direction < 0 ? 0 : 1279, 400];
    [...chrome].find(a => (direction < 0) === (a.x === 0)).emit('enter-event');
};
const leave = () => {
    pointer = [600, 400];
    [...chrome][0].emit('leave-event', {get_coords: () => pointer});
};
enter(-1);
assert(active === 0 && moves === 0 && workspaces.length === 3, 'Left edge on Desktop neither wraps nor creates a workplace');
leave(); enter(1);
assert(active === 1 && moves === 1, 'Right edge uses the native workspace action');
for (let i = 0; i < 5; i++) enter(1);
assert(active === 1 && moves === 1, 'Holding at an edge and synthetic re-entries do not skip workplaces');
leave(); enter(1);
assert(active === 2 && moves === 2, 'Leaving and re-entering advances exactly once again');
leave(); enter(1);
assert(active === 2 && moves === 2 && workspaces.length === 3, 'Last workplace never wraps or appends');
leave(); enter(-1);
assert(active === 1, 'Left edge returns to the existing previous workplace');

for (const [object, property, signal] of [[overview, 'visible', 'showing'],
    [sessionMode, 'isLocked', 'updated'], [native.stage, 'is_grabbed', null]]) {
    leave(); object[property] = true;
    if (signal) object.emit(signal); else native.stage.emit('notify::is-grabbed');
    const before = moves; enter(-1);
    assert(moves === before && [...chrome].every(a => !a.visible), 'Overview, lock and modal menus suppress edge switching');
    object[property] = false;
    if (signal) object.emit(signal === 'showing' ? 'hidden' : signal);
    else native.stage.emit('notify::is-grabbed');
    enter(-1);
    assert(moves === before, 'Closing a menu/overview or unlocking at an edge does not switch');
}
leave(); native.stage.is_grabbed = true; native.stage.emit('notify::is-grabbed');
assert(Main.modalCount === 0 && [...chrome].every(a => !a.visible),
    'The native grab hides sensors before Shell increments modalCount');
pointer = [0, 400];
native.stage.is_grabbed = false;
const beforeDismiss = moves;
for (const actor of chrome)
    if (actor.visible) actor.emit('enter-event');
native.stage.emit('notify::is-grabbed'); enter(-1);
assert(moves === beforeDismiss, 'Grab dismissal cannot expose an armed sensor before its notify callback');
leave(); native.display.emit('grab-op-begin'); enter(1);
const beforeDragEnd = moves;
native.display.emit('grab-op-end'); enter(1);
assert(moves === beforeDragEnd, 'Window drag-to-tile and release at an edge never switch workplaces');
leave(); enter(1);
assert(moves === beforeDragEnd + 1, 'A fresh edge visit after the drag works normally');

const adjacent = [monitor, {x: 1280, y: 200, width: 1280, height: 600}];
const pieces = edgeSegments(adjacent);
assert(!pieces.some(r => r.x === 1280), 'Moving into the left edge of an adjacent monitor never switches');
assert(pieces.filter(r => r.x === 1278).every(r => r.y + r.height <= 200),
    'Only the exposed section of a partially shared monitor edge switches');
assert(edgeSegments([monitor]).every(r => r.y === 4 && r.height === 792),
    'Auto-hidden bars retain their four-pixel top and bottom corner triggers');

settings.enabled = false; settings.emit('changed::edge-switch-workplaces');
assert(chrome.size === 0, 'Turning the setting off removes all sensors');
edges.destroy();
assert([settings, native.display, native.stage, layout, overview, sessionMode]
    .every(object => object.signals.size === 0), 'Disable disconnects every native signal');
print(`Workplace edges: ${checks} assertions passed`);
