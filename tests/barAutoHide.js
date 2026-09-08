// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';

let count = 0;
function assert(value, message) {
    count++;
    if (!value) throw new Error(message);
}
class Emitter {
    constructor() { this.signals = new Map(); this.nextId = 1; }
    connect(signal, callback) { const id = this.nextId++; this.signals.set(id, {signal, callback}); return id; }
    disconnect(id) { this.signals.delete(id); }
    emit(signal, ...args) {
        for (const item of [...this.signals.values()])
            if (item.signal === signal) item.callback(this, ...args);
    }
}
class Actor extends Emitter {
    constructor(properties = {}) { super(); Object.assign(this, {visible: true, reactive: false}, properties); }
    set_position(x, y) { this.x = x; this.y = y; }
    set_size(width, height) { this.width = width; this.height = height; }
    get_transformed_position() { return [this.x, this.y]; }
    get_transformed_size() { return [this.width, this.height]; }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    get has_clip() { return Boolean(this.clip); }
    get_clip() { return this.clip; }
    set_clip(...clip) { this.clip = clip; }
    remove_clip() { this.clip = null; }
    get painted() { return this.visible && (!this.clip || this.clip[2] > 0 && this.clip[3] > 0); }
    destroy() { this.destroyed = true; }
}
const settings = new Emitter();
const values = new Map([['autohide-top-bar', false], ['autohide-taskbar', false]]);
settings.get_boolean = key => values.get(key);
function set(key, value) { values.set(key, value); settings.emit(`changed::${key}`); }
let pointer = [500, 400];
const stage = new Emitter();
stage.get_grab_actor = () => stage.grabActor ?? null;
function grab(actor) {
    const wasGrabbed = Boolean(stage.grabActor);
    stage.grabActor = actor;
    if (Boolean(actor) !== wasGrabbed) stage.emit('notify::is-grabbed');
    // Native menus change keyboard focus when replacing a still-active grab;
    // no is-grabbed notification or stage pointer event occurs in that case.
    stage.emit('notify::key-focus');
}
function motion() {
    if (stage.grabActor) {
        stage.grabActor.emit('captured-event', {type: () => clutter.EventType.MOTION, get_coords: () => pointer});
        return;
    }
    // Moving into a Wayland client does not provide stage motion events.
    // Native crossing goes to the bar (including across its children).
    for (const [actor, control] of [[top, topControl], [bottom, bottomControl]]) {
        if (actor.painted) actor.emit('leave-event', {get_coords: () => pointer});
        const sensor = control._sensor;
        if (sensor.visible && pointer[0] >= sensor.x && pointer[0] < sensor.x + sensor.width &&
            pointer[1] >= sensor.y && pointer[1] < sensor.y + sensor.height)
            sensor.emit('enter-event');
    }
}
const native = {stage, get_pointer: () => pointer};
const layout = new Emitter();
const tracked = new Map();
let strutChanges = 0;
layout.addChrome = (actor, params) => tracked.set(actor, params);
layout.removeChrome = actor => tracked.delete(actor);
layout.untrackChrome = actor => { if (tracked.get(actor)?.affectsStruts) strutChanges++; tracked.delete(actor); };
layout.trackChrome = (actor, params) => { if (params.affectsStruts) strutChanges++; tracked.set(actor, params); };
const overview = Object.assign(new Emitter(), {visible: false});
const sessionMode = Object.assign(new Emitter(), {hasWindows: true, isLocked: false});
const main = {layoutManager: layout, overview, sessionMode};
const clutter = {EVENT_PROPAGATE: 0, EventType: {MOTION: 1, LEAVE: 2, ENTER: 3}};
const [, bytes] = GLib.file_get_contents('extension/gnozzard@openresearchtools/barAutoHide.js');
const source = new TextDecoder().decode(bytes).replace(/^import .+;\n/gm, '')
    .replace('export class BarAutoHide', 'class BarAutoHide');
const BarAutoHide = new Function('Clutter', 'St', 'Main', 'global', `${source}\nreturn BarAutoHide;`)(
    clutter, {Widget: Actor}, main, native);
const monitor = {x: 0, y: 0, width: 1280, height: 800};
const top = new Actor({x: 0, y: 0, width: 1280, height: 32});
const bottom = new Actor({x: 0, y: 760, width: 1280, height: 40, reactive: true});
for (const actor of [top, bottom]) tracked.set(actor, {affectsStruts: true, trackFullscreen: true});
const topControl = new BarAutoHide(top, settings, 'autohide-top-bar', 'top', () => monitor);
const bottomControl = new BarAutoHide(bottom, settings, 'autohide-taskbar', 'bottom', () => monitor);
assert(top.visible && bottom.visible, 'Both bars stay visible by default');
assert(topControl._sensor.height === 4 && topControl._sensor.y === 0, 'Top trigger spans four pixels');
assert(bottomControl._sensor.height === 4 && bottomControl._sensor.y === 796, 'Bottom trigger spans four pixels');

for (const [topHidden, bottomHidden] of [[true, false], [false, true], [true, true], [false, false]]) {
    set('autohide-top-bar', topHidden);
    set('autohide-taskbar', bottomHidden);
    assert(top.painted === !topHidden && bottom.painted === !bottomHidden, 'Settings act independently');
    const reserved = (tracked.get(top)?.affectsStruts ? 32 : 0) + (tracked.get(bottom)?.affectsStruts ? 40 : 0);
    assert(800 - reserved === 800 - (topHidden ? 0 : 32) - (bottomHidden ? 0 : 40),
        'All four combinations reserve precisely the always-visible bars');
}
for (const [actor, control, key, edgeY, insideY, outsideY] of [
    [top, topControl, 'autohide-top-bar', 0, 31, 32],
    [bottom, bottomControl, 'autohide-taskbar', 799, 760, 759],
]) {
    set(key, true);
    const beforeStruts = strutChanges;
    pointer = [600, insideY];
    stage.emit('captured-event', {type: () => clutter.EventType.MOTION});
    assert(!actor.painted, 'Entering the old bar area does not reveal it');
    pointer = [600, edgeY];
    control._sensor.emit('enter-event');
    assert(actor.painted && !control._sensor.visible, 'Exact edge reveals the bar and removes the sensor from its input');
    for (const x of [0, 50, 640, 1279]) {
        pointer = [x, insideY];
        motion();
        assert(actor.painted, 'Crossing children anywhere within the full bar does not hide it');
    }
    pointer = [600, outsideY];
    motion();
    assert(!actor.painted && control._sensor.visible, 'Leaving bar geometry hides it');
    assert(actor.visible, 'The hidden bar stays mapped to preserve native popup menus');
    assert(!tracked.has(actor), 'The hidden bar leaves no invisible X11 input strip');
    assert(strutChanges === beforeStruts, 'Pointer reveal/hide never changes native struts');
}

const menu = new Actor();
const nestedMenu = new Actor();
for (const [control, actor, other, key] of [
    [topControl, top, bottom, 'autohide-top-bar'],
    [bottomControl, bottom, top, 'autohide-taskbar'],
]) {
    pointer = [500, 400]; motion();
    const beforeStruts = strutChanges;
    control.setMenuOpen(true);
    grab(menu); motion();
    assert(actor.painted && !other.painted, 'Applications keeps only its own bar visible');
    grab(nestedMenu); motion();
    assert(actor.painted, 'Applications context menu preserves the parent bar');
    assert(!tracked.get(actor)?.affectsStruts, 'An open menu does not reserve space');
    assert(beforeStruts === strutChanges, 'Menu opening never resizes application windows');
    control.setMenuOpen(false);
    assert(!actor.painted, 'Dismissing Applications hides its bar when pointer is outside');
    grab(null);
    set(key, false);
    control.setMenuOpen(true);
    set(key, true);
    assert(actor.painted, 'Turning on auto-hide keeps an already open Applications menu attached');
    control.setMenuOpen(false);
}
for (const root of [menu, nestedMenu, menu, null]) {
    pointer = [500, 0];
    topControl._sensor.emit('enter-event');
    grab(root);
    pointer = [500, 200];
    motion();
    assert(!top.painted && top.visible, 'Menu and nested grab motion hides the bar without unmapping its source');
    pointer = [500, 4];
    motion();
    assert(!top.painted, 'Menu grabs do not widen the edge activation area');
    pointer = [500, 3];
    motion();
    assert(top.painted, 'The fourth edge pixel also reveals the bar during a menu grab');
}
assert(menu.signals.size === 0 && nestedMenu.signals.size === 0, 'Dismissed grab roots retain no event handlers');
assert([...stage.signals.values()].every(s => s.signal !== 'captured-event'),
    'Normal bar crossing does not depend on global stage motion');
pointer = [500, 799];
bottomControl._sensor.emit('enter-event');
bottom.emit('leave-event', {get_coords: () => [500, 400]});
assert(!bottom.painted, 'Leave uses event coordinates even if the global pointer query is stale');

for (const [control, actor, outsideY, edgePixels] of [
    [topControl, top, 4, [3, 2, 1, 0]],
    [bottomControl, bottom, 795, [796, 797, 798, 799]],
]) {
    for (const y of edgePixels) {
        pointer = [500, 400]; motion();
        pointer = [500, outsideY]; motion();
        assert(!actor.painted, 'Moving outside the four-pixel edge strip does not reveal');
        pointer = [500, y]; motion();
        assert(actor.painted, 'Every pixel of the four-pixel strip reveals immediately');
    }
}

pointer = [500, 0];
topControl._sensor.emit('enter-event');
overview.visible = true;
overview.emit('showing');
assert(!top.painted && !topControl._sensor.visible, 'Overview suppresses the bar and edge trigger');
overview.visible = false;
overview.emit('hidden');
assert(!top.painted && topControl._sensor.visible, 'Returning from overview requires a new edge activation');
topControl._sensor.emit('enter-event');
sessionMode.isLocked = true;
sessionMode.emit('updated');
assert(!top.painted && !bottom.painted && !topControl._sensor.visible && !bottomControl._sensor.visible,
    'Lock screen has no active reveal triggers');
sessionMode.isLocked = false;
sessionMode.emit('updated');
assert(!top.painted && topControl._sensor.visible, 'Unlock does not restore a stale revealed state');
monitor.x = 1280; monitor.y = 100; monitor.width = 1920; monitor.height = 1080;
layout.emit('monitors-changed');
assert(topControl._sensor.x === 1280 && topControl._sensor.y === 100 && topControl._sensor.width === 1920,
    'Top sensor follows monitor geometry');
assert(bottomControl._sensor.x === 1280 && bottomControl._sensor.y === 1176,
    'Bottom sensor follows monitor geometry');
topControl.destroy(); bottomControl.destroy();
assert(top.painted && bottom.painted, 'Disabling restores both bars');
assert(!top.reactive && bottom.reactive, 'Original reactive properties are restored');
assert(tracked.get(top).affectsStruts && tracked.get(bottom).affectsStruts, 'Original native struts are restored');
assert(tracked.size === 2 && stage.signals.size === 0 && settings.signals.size === 0,
    'All sensors and event handlers are removed');
print(`Bar auto-hide: ${count} assertions passed`);
