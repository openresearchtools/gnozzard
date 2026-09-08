// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Match the four-pixel outer tile margin; no dwell time or reveal animation.
const EDGE_SIZE = 4;

// One controller for either edge. Only changing the setting changes struts;
// pointer reveal/hide never changes the work area or moves application windows.
export class BarAutoHide {
    constructor(actor, settings, key, edge, getMonitor) {
        this._actor = actor;
        this._settings = settings;
        this._key = key;
        this._edge = edge;
        this._getMonitor = getMonitor;
        this._signals = [];
        this._enabled = false;
        this._revealed = false;
        this._menuOpen = false;
        this._previousReactive = actor.reactive;
        this._previousClip = actor.has_clip ? actor.get_clip() : null;
        this._chromeMode = 'fixed';
        this._sensor = new St.Widget({
            name: `gnozzard-${edge}-edge`, reactive: true, visible: false,
        });
        Main.layoutManager.addChrome(this._sensor, {affectsStruts: false, trackFullscreen: false});
        this._connect(this._sensor, 'enter-event', () => {
            this.reveal();
            return Clutter.EVENT_PROPAGATE;
        });
        this._connect(actor, 'leave-event', (_actor, event) => {
            this.updatePointer(event.get_coords());
            return Clutter.EVENT_PROPAGATE;
        });
        this._connect(global.stage, 'notify::is-grabbed', () => this._syncPointerRoot());
        this._connect(global.stage, 'notify::key-focus', () => this._syncPointerRoot());
        this._connect(settings, `changed::${key}`, () => this._configure());
        this._connect(Main.layoutManager, 'monitors-changed', () => this.relayout());
        this._connect(Main.overview, 'showing', () => this._suspend());
        this._connect(Main.overview, 'hidden', () => this._syncVisibility());
        this._connect(Main.sessionMode, 'updated', () => this._syncVisibility());
        this.relayout();
        this._configure();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _configure() {
        const enabled = this._settings.get_boolean(this._key);
        if (enabled === this._enabled)
            return;
        this._enabled = enabled;
        this._revealed = false;
        this._actor.reactive = enabled || this._previousReactive;
        this._actor.show();
        this._syncPointerRoot();
        this._syncVisibility();
    }

    _syncPointerRoot() {
        // Normal crossing belongs to the bar itself, including departures to
        // Wayland clients. A modal menu redirects input to its own grab root.
        const root = this._enabled ? global.stage.get_grab_actor() : null;
        if (root === this._pointerRoot)
            return;
        if (this._pointerRoot)
            this._pointerRoot.disconnect(this._pointerSignal);
        this._pointerRoot = root;
        if (root)
            this._pointerSignal = root.connect('captured-event', (_actor, event) => {
                if ([Clutter.EventType.MOTION, Clutter.EventType.ENTER, Clutter.EventType.LEAVE].includes(event.type()))
                    this.updatePointer(event.get_coords());
                return Clutter.EVENT_PROPAGATE;
            });
    }

    _track(mode) {
        if (mode === this._chromeMode)
            return;
        if (this._chromeMode)
            Main.layoutManager.untrackChrome(this._actor);
        this._chromeMode = mode;
        if (mode)
            Main.layoutManager.trackChrome(this._actor, {
                affectsStruts: mode === 'fixed', trackFullscreen: mode === 'fixed',
            });
    }

    _restoreClip() {
        if (this._previousClip)
            this._actor.set_clip(...this._previousClip);
        else
            this._actor.remove_clip();
    }

    relayout() {
        const monitor = this._getMonitor();
        if (!monitor) {
            this._syncVisibility();
            return;
        }
        this._sensor.set_position(monitor.x,
            this._edge === 'top' ? monitor.y : monitor.y + monitor.height - EDGE_SIZE);
        this._sensor.set_size(monitor.width, EDGE_SIZE);
        this._syncVisibility();
        this.updatePointer();
    }

    _available() {
        return this._getMonitor() && Main.sessionMode.hasWindows &&
            !Main.sessionMode.isLocked && !Main.overview.visible;
    }

    reveal() {
        if (!this._enabled || !this._available())
            return;
        this._revealed = true;
        this._syncVisibility();
    }

    setMenuOpen(open) {
        this._menuOpen = open;
        if (open)
            this.reveal();
        else
            this.updatePointer();
    }

    updatePointer(position = global.get_pointer()) {
        if (!this._enabled)
            return;
        const [x, y] = position;
        const monitor = this._getMonitor();
        const edgeY = monitor && (this._edge === 'top' ? monitor.y : monitor.y + monitor.height - EDGE_SIZE);
        if (monitor && x >= monitor.x && x < monitor.x + monitor.width && y >= edgeY && y < edgeY + EDGE_SIZE) {
            this.reveal();
            return;
        }
        if (!this._revealed || this._menuOpen)
            return;
        const [ax, ay] = this._actor.get_transformed_position();
        const [width, height] = this._actor.get_transformed_size();
        if (x >= ax && x < ax + width && y >= ay && y < ay + height)
            return;
        this._revealed = false;
        this._syncVisibility();
    }

    _suspend() {
        this._revealed = false;
        if (this._enabled) {
            this._actor.set_clip(0, 0, 0, 0);
            this._track(null);
            this._sensor.hide();
        }
    }

    _syncVisibility() {
        if (!this._enabled) {
            this._restoreClip();
            this._track('fixed');
            this._sensor.hide();
            return;
        }
        const available = this._available();
        if (!available)
            this._revealed = false;
        else if (this._menuOpen)
            this._revealed = true;
        // Keep the source actor mapped so native popup menus remain anchored
        // and do not close when the pointer leaves the bar. Clipping removes
        // paint/picking; untracking also removes the hidden X11 input region.
        if (available && this._revealed) {
            this._restoreClip();
            this._track('overlay');
        } else {
            this._actor.set_clip(0, 0, 0, 0);
            this._track(null);
        }
        this._sensor.visible = Boolean(available && !this._revealed);
    }

    destroy() {
        if (this._pointerRoot)
            this._pointerRoot.disconnect(this._pointerSignal);
        this._pointerRoot = null;
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        Main.layoutManager.removeChrome(this._sensor);
        this._sensor.destroy();
        this._actor.reactive = this._previousReactive;
        if (this._enabled) {
            this._restoreClip();
            this._actor.show();
            this._track('fixed');
        }
    }
}
