// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the actual controller with native-window doubles, outside Shell.
import GLib from 'gi://GLib';
import * as Layout from '../extension/gnozzard@openresearchtools/tilingLayout.js';

const [, bytes] = GLib.file_get_contents('extension/gnozzard@openresearchtools/tiling.js');
const source = new TextDecoder().decode(bytes).replace(/^import .+;\n/gm, '')
    .replace('export class AutoTiler', 'class AutoTiler');
const AutoTiler = new Function('GLib', 'Meta', 'Main', 'Layout', 'global',
    `${source}\nreturn AutoTiler;`)(GLib, {WindowType: {NORMAL: 0}, GrabOp: {}},
    {wm: {skipNextEffect() {}}, layoutManager: {monitors: [{}]}}, Layout,
    {get_pointer: () => [640, 400], stage: {connect: () => 1, disconnect() {}}});
let count = 0;
function assert(value, message) {
    count++;
    if (!value) throw new Error(message);
}
const area = {x: 0, y: 32, width: 1280, height: 728};
const workspace = {get_work_area_for_monitor: () => area, index: () => 0};
const tiler = Object.create(AutoTiler.prototype);
tiler._windows = new Map();
tiler._sizes = new Map();
tiler._disabled = new Set();
tiler._grab = null;
let queued = 0;
tiler._queue = () => queued++;
const group = {workspace, monitor: 0, tree: Layout.leaf(1), revision: 0};
const listeners = new Map();
let frame = {x: 50, y: 60, width: 700, height: 500};
let moves = 0;
let unmaximizes = 0;
const window = {
    get_stable_sequence: () => 1,
    get_window_type: () => 0,
    is_override_redirect: () => false,
    is_fullscreen: () => false,
    get_workspace: () => workspace,
    get_compositor_private: () => ({}),
    get_frame_rect: () => frame,
    connect: (signal, callback) => { listeners.set(signal, callback); return signal; },
    minimized: false,
    unminimize() { this.minimized = false; },
    unmaximize() {
        unmaximizes++;
        this.maximized_horizontally = this.maximized_vertically = false;
        // Mutter 46 notifies even when unmaximize does not change anything.
        listeners.get('notify::maximized-horizontally')();
        listeners.get('notify::maximized-vertically')();
    },
    move_resize_frame(_user, x, y, width, height) {
        moves++;
        frame = {x, y, width, height};
        listeners.get('position-changed')();
        listeners.get('size-changed')();
    },
};
tiler._watch(window, true);
const record = tiler._windows.get(1);
record.group = group;
queued = 0;
tiler._apply(group);
assert(moves === 1, 'Initial placement moves the window');
assert(JSON.stringify(frame) === JSON.stringify({x: 4, y: 36, width: 1272, height: 720}),
    'A single window has exactly four pixels on every work-area edge');
assert(queued === 0, 'Synchronous placement acknowledgements do not queue another reflow');
tiler._apply(group);
assert(moves === 1, 'Unchanged geometry does not issue another move');
assert(unmaximizes === 0 && queued === 0,
    'GNOME 46: an already unmaximized window does not create a notification/reflow loop');
frame = {...frame, x: 100};
listeners.get('position-changed')();
assert(queued === 1, 'Application position change queues the existing reflow path');
tiler._apply(group);
assert(moves === 2 && frame.x === 4, 'Reflow puts the app back into its assigned tile');
queued = 0;
tiler._grab = {};
frame = {...frame, width: 900};
listeners.get('size-changed')();
assert(queued === 0, 'Native drag owns geometry until the grab ends');
tiler._grab = null;
listeners.get('size-changed')();
assert(queued === 1, 'Post-grab size change is reconciled');
window.minimized = true;
listeners.get('notify::minimized')();
assert(!window.minimized, 'Minimize is undone while tiled');
window.maximized_horizontally = window.maximized_vertically = true;
listeners.get('notify::maximized-horizontally')();
assert(!window.maximized_horizontally && !window.maximized_vertically, 'Maximize is undone while tiled');
assert(unmaximizes === 1, 'Only a real maximize request calls unmaximize');
frame = {...record.target, height: 850};
record.requests = [{...record.target}];
listeners.get('position-changed')();
assert(record.minimum.height === 0, 'Position events cannot turn a stale buffer into a minimum size');
listeners.get('size-changed')();
assert(record.minimum.height === 850, 'GNOME 46: a client refusing the requested height supplies its actual minimum');
frame = {...frame, height: 720};
record.requests = [{...record.target}];
listeners.get('size-changed')();
assert(record.minimum.height === 720, 'An application accepting a smaller size lowers its observed constraint');
record.minimum = {width: 0, height: 497};
record.requests = [{width: 764, height: 497}, {width: 634, height: 752}];
record.target = {x: 4, y: 44, width: 634, height: 752};
frame = {...record.target, width: 764, height: 497};
listeners.get('size-changed')();
assert(record.minimum.width === 0 && record.requests.length === 1,
    'A delayed older resize acknowledgement is not misread as the minimum width of the latest tile');
frame = {...record.target};
listeners.get('size-changed')();
assert(record.minimum.width === 0 && record.requests.length === 0,
    'The latest acknowledged configure retires the remaining request without inventing constraints');
record.requests = [{width: 634, height: 374}, {width: 764, height: 251}];
frame = {...frame, width: 764, height: 294};
listeners.get('size-changed')();
assert(record.minimum.height === 294 && record.minimum.width === 0,
    'A genuine height constraint is associated with its compatible configure, not an older taller request');
record.requests = [{width: 764, height: 752}];
frame = {...frame, width: 634, height: 374};
listeners.get('size-changed')();
assert(record.requests.length === 1,
    'An earlier smaller frame cannot retire a newer outstanding grow request');
tiler._remove(record);
assert(record.requests.length === 1,
    'Configure requests belong to the window lifetime and survive workplace reassignment');
queued = 0;
listeners.get('size-changed')();
assert(queued === 0 && record.target === null, 'Removed windows do not retain a placement target');
group.tree = Layout.leaf(1);
const releaseTree = Layout.split('x', Layout.leaf(1), Layout.leaf(2));
tiler._grab = {moving: true, group, record, tree: group.tree, signals: [], candidate: null};
tiler._preview = () => { tiler._grab.candidate = {group, tree: releaseTree}; };
tiler._end();
assert(group.tree === releaseTree && tiler._grab === null,
    'Release uses the final pointer position and clears the native grab');
record.group = group;
tiler._groups = [group];
tiler._eligible = () => true;
tiler._group = () => group;
tiler._drawChrome = () => {};
window.get_monitor = () => 0;
window.get_min_size = () => [true, 200, 150];
window.resizeable = true;
group.tree = Layout.leaf(1);
tiler._sync();
assert(JSON.stringify(tiler._sizes.get(1)) === JSON.stringify({width: 204, height: 154}),
    'Controller includes the gap when passing native minimum sizes to the layout engine');
group.tree = releaseTree;
tiler._apply(group);
tiler._hideChrome = () => {};
tiler._trackGrab = () => {};
tiler._begin(window, 8193);
assert(tiler._grab.cuts.length === 1, 'Native right-edge resize finds the divider two pixels into the gap');
tiler._end(true);
print(`Tiling controller: ${count} assertions passed`);
