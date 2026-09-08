// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// The second pixel accommodates absolute-pointer rounding in VM consoles.
const EDGE_SIZE = 2;

export function edgeSegments(monitors, areas = monitors) {
    const edges = [];
    monitors.forEach((monitor, index) => {
        const area = areas[index];
        const start = Math.max(monitor.y + 4, area.y);
        const end = Math.min(monitor.y + monitor.height - 4, area.y + area.height);
        for (const direction of [-1, 1]) {
            const boundary = direction < 0 ? monitor.x : monitor.x + monitor.width;
            let spans = [[start, end]];
            for (const other of monitors) {
                if (other === monitor || (direction < 0
                    ? other.x + other.width !== boundary : other.x !== boundary))
                    continue;
                spans = spans.flatMap(([a, b]) => [[a, Math.min(b, other.y)],
                    [Math.max(a, other.y + other.height), b]].filter(([top, bottom]) => bottom > top));
            }
            for (const [y, bottom] of spans) {
                if (bottom > y)
                    edges.push({x: direction < 0 ? boundary : boundary - EDGE_SIZE,
                        y, width: EDGE_SIZE, height: bottom - y, direction});
            }
        }
    });
    return edges;
}

export class WorkplaceEdges {
    constructor(settings) {
        this._settings = settings;
        this._signals = [];
        this._actors = [];
        this._latched = false;
        this._dragging = false;
        this._connect(settings, 'changed::edge-switch-workplaces', () => this._rebuild());
        this._connect(Main.layoutManager, 'monitors-changed', () => this._rebuild());
        this._connect(global.display, 'workareas-changed', () => this._rebuild());
        this._connect(global.display, 'grab-op-begin', () => {
            this._dragging = true;
            this._syncVisibility();
        });
        this._connect(global.display, 'grab-op-end', () => {
            this._dragging = false;
            this._syncVisibility();
        });
        for (const signal of ['showing', 'hidden'])
            this._connect(Main.overview, signal, () => this._syncVisibility());
        this._connect(Main.sessionMode, 'updated', () => this._syncVisibility());
        this._connect(global.stage, 'notify::is-grabbed', () => this._syncVisibility());
        this._connect(global.stage, 'captured-event', (_stage, event) => {
            if (this._latched && [Clutter.EventType.MOTION, Clutter.EventType.LEAVE].includes(event.type()))
                this._checkPointer(event.get_coords());
            return Clutter.EVENT_PROPAGATE;
        });
        this._rebuild();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _atEdge([x, y]) {
        return edgeSegments(Main.layoutManager.monitors).some(r =>
            x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
    }

    _checkPointer(position) {
        if (!this._atEdge(position))
            this._latched = false;
    }

    _available() {
        return this._settings.get_boolean('edge-switch-workplaces') &&
            Main.sessionMode.hasWindows && !Main.sessionMode.isLocked &&
            !Main.overview.visible && !global.stage.is_grabbed && !this._dragging;
    }

    _enter(direction) {
        if (!this._available() || this._latched)
            return;
        this._latched = true;
        const manager = global.workspace_manager;
        const index = manager.get_active_workspace_index() + direction;
        if (index >= 0 && index < manager.get_n_workspaces())
            Main.wm.actionMoveWorkspace(manager.get_workspace_by_index(index));
    }

    _syncVisibility() {
        const available = this._available();
        // Revealing a sensor underneath a stationary pointer is not an edge visit.
        this._latched = this._atEdge(global.get_pointer());
        for (const actor of this._actors)
            actor.visible = available;
    }

    _clearActors() {
        for (const actor of this._actors) {
            Main.layoutManager.removeChrome(actor);
            actor.destroy();
        }
        this._actors = [];
    }

    _rebuild() {
        this._clearActors();
        if (!this._settings.get_boolean('edge-switch-workplaces')) {
            this._latched = false;
            return;
        }
        const monitors = Main.layoutManager.monitors;
        const workspace = global.workspace_manager.get_active_workspace();
        const areas = monitors.map((_monitor, index) => workspace.get_work_area_for_monitor(index));
        for (const rect of edgeSegments(monitors, areas)) {
            const actor = new St.Widget({name: 'gnozzard-workplace-edge', reactive: true,
                x: rect.x, y: rect.y, width: rect.width, height: rect.height});
            actor.connect('enter-event', () => {
                this._enter(rect.direction);
                return Clutter.EVENT_PROPAGATE;
            });
            actor.connect('leave-event', (_actor, event) => {
                this._checkPointer(event.get_coords());
                return Clutter.EVENT_PROPAGATE;
            });
            Main.layoutManager.addChrome(actor, {affectsStruts: false, trackFullscreen: false});
            this._actors.push(actor);
        }
        this._syncVisibility();
    }

    destroy() {
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        this._clearActors();
    }
}
