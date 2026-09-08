// SPDX-License-Identifier: GPL-3.0-or-later
// Exercise the extension's real bar lifecycle without a Shell compositor.
import GLib from 'gi://GLib';
let count = 0;
function assert(value, message) {
    count++;
    if (!value) throw new Error(message);
}
const [, bytes] = GLib.file_get_contents('extension/gnozzard@openresearchtools/extension.js');
const text = new TextDecoder().decode(bytes);
const source = text.slice(text.indexOf('export default class GnozzardExtension'))
    .replace('export default class', 'class');
const policy = text.slice(text.indexOf('function showTaskbar('), text.indexOf('function popupSide('));
const workspace = {tiling: true};
const monitor = {x: 0, y: 0, width: 1280, height: 800};
const second = {x: -1920, y: 100, width: 1920, height: 1080};
const panelBox = {height: 32, set_position(x, y) { this.x = x; this.y = y; }};
const layout = {monitors: [monitor, second], primaryMonitor: monitor, panelBox};
const live = new Set();
class Control {
    constructor(actor, settings, key, edge, getMonitor) {
        Object.assign(this, {actor, key, edge, getMonitor}); live.add(this);
    }
    relayout() {}
    destroy() { live.delete(this); }
}
class Panel {
    constructor(settings, index, shared, manager, changed, order, edge, height) {
        Object.assign(this, {monitorIndex: index, manager, edge, height});
        this.control = new Control({}, settings, 'autohide-taskbar', edge, () => layout.monitors[index]);
        live.add(this);
    }
    destroy() { this.control.destroy(); live.delete(this); }
}
class Applications {
    constructor(settings, index, manager, edge, height, control) {
        Object.assign(this, {index, manager, edge, height, control});
        this._menu = {relayout() {}};
        live.add(this);
    }
    destroy() { live.delete(this); }
}
const main = {layoutManager: layout, panel: {height: 32,
    addToStatusArea(role, actor, position, box) {
        assert(position === 0 && box === 'left', 'Applications goes before workplaces');
    }}};
const native = {workspace_manager: {get_active_workspace: () => workspace}};
const ExtensionClass = new Function('Extension', 'Main', 'global', 'BarAutoHide', 'ClassicPanel',
    'SystemApplicationsButton', 'APPLICATIONS_BUTTON_ROLE', 'PANEL_HEIGHT',
    policy + source + '\nreturn GnozzardExtension;')(
    class {}, main, native, Control, Panel, Applications, 'applications', 40);
const values = new Map([['taskbar-mode', 'automatic'], ['swap-bars', false], ['taskbars-all-displays', true]]);
const e = new ExtensionClass();
Object.assign(e, {_desktopStarted: true, _panels: [], _applicationsMenuManager: {},
    _settings: {get_string: k => values.get(k), get_boolean: k => values.get(k),
        set_boolean: (k, v) => values.set(k, v)},
    _autoTiler: {isWorkspaceEnabled: w => w.tiling}});

for (let repeat = 0; repeat < 3; repeat++) {
    for (const mode of ['automatic', 'always', 'never']) {
        for (const tiling of [true, false]) {
            for (const swapped of [false, true]) {
                values.set('taskbar-mode', mode); values.set('swap-bars', swapped); workspace.tiling = tiling;
                e._syncBarLayout();
                const show = mode === 'always' || mode === 'automatic' && !tiling;
                assert(e._panels.length === (show ? 2 : 0), 'Taskbar mode creates actual panels or none');
                assert(values.get('taskbar-present') === show,
                    'Settings sensitivity follows actual taskbar presence on this workplace');
                assert(Boolean(e._systemApplications) === !show, 'Exactly one Applications placement is active');
                assert(panelBox.y === (swapped ? 768 : 0), 'System bar moves to its selected edge');
                assert(e._topBarAutoHide.edge === (swapped ? 'bottom' : 'top'), 'System reveal follows the swapped edge');
                assert(live.size === (show ? 5 : 2), 'Repeated switches leave no orphan taskbars, sensors or buttons');
                for (const panel of e._panels) {
                    assert(panel.edge === (swapped ? 'top' : 'bottom'), 'Taskbar and its trigger use the opposite edge');
                    assert(panel.manager === e._applicationsMenuManager, 'Taskbar keeps the shared menu manager');
                }
                if (!show) {
                    assert(![...live].some(x => x.key === 'autohide-taskbar'), 'No hidden-taskbar edge sensor survives');
                    assert(e._systemApplications.manager === e._applicationsMenuManager, 'System Applications keeps the same manager');
                }
                const control = e._topBarAutoHide;
                e._syncBarLayout();
                assert(control === e._topBarAutoHide, 'Unchanged workplace mode does not rebuild bars');
                assert(e._menuHeight(0) === (show ? 728 : 768), 'Menu uses the space between existing bars');
                assert(e._menuHeight(1) === (show ? 1040 : 1080), 'Secondary monitor has no phantom system-bar margin');
            }
        }
    }
}
values.set('taskbar-mode', 'automatic'); e._autoTiler = null; e._syncBarLayout();
assert(e._panels.length === 2, 'Automatic shows taskbars when auto-tiling is off globally');
values.set('taskbars-all-displays', false); e._rebuildPanels();
assert(e._panels.length === 1 && e._primaryPanel() === e._panels[0], 'Primary-only taskbar routing is preserved');
values.set('swap-bars', true); e._syncBarLayout();
panelBox.height = 36; main.panel.height = 36; e._positionSystemBar();
assert(panelBox.y === 764, 'Bottom system bar follows theme/font height changes');
layout.primaryMonitor = second; e._rebuildPanels();
assert(panelBox.x === -1920 && panelBox.y === 1144, 'Swapped system bar follows primary-monitor changes');
e._systemApplications?.destroy(); e._topBarAutoHide.destroy(); e._panels.forEach(p => p.destroy());
assert(live.size === 0, 'All owned bar objects are removable');
const panelSource = text.slice(text.indexOf('class ClassicPanel {'), text.indexOf('class WorkspaceContextMenu {'));
const RealPanel = new Function('Main', 'PANEL_HEIGHT', panelSource + '\nreturn ClassicPanel;')(main, 40);
const p = Object.create(RealPanel.prototype);
Object.assign(p, {_monitorIndex: 1, actor: {set_position(x, y) { this.x = x; this.y = y; }, set_size() {}},
    _autoHide: {relayout() {}}, _menu: {relayout() {}}});
for (const edge of ['top', 'bottom']) {
    p._edge = edge; p.relayout();
    assert(p.actor.x === -1920 && p.actor.y === (edge === 'top' ? 100 : 1140),
        'Actual taskbar relayout anchors to the requested monitor edge');
}
let signalsCleared = false;
let controllerDestroyed = false;
let menuDestroyed = false;
main.layoutManager.removeChrome = () => {};
Object.assign(p, {
    _signals: {clear() { signalsCleared = true; }},
    _menu: {destroy() {
        assert(signalsCleared, 'Disconnect menu callbacks before closing a removed taskbar menu');
        assert(!controllerDestroyed, 'Close the menu while its auto-hide controller is still alive');
        menuDestroyed = true;
    }},
    _autoHide: {destroy() { controllerDestroyed = true; }},
    _tasks: [], actor: {destroy() {}},
});
p.destroy();
assert(menuDestroyed && controllerDestroyed, 'Both menu and controller are destroyed');
print(`Bar layout: ${count} assertions passed`);
