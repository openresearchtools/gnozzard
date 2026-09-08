// SPDX-License-Identifier: GPL-3.0-or-later
// Actual shared menu/action implementation, with Shell-native test doubles.
import GLib from 'gi://GLib';

let count = 0;
function assert(value, message) { count++; if (!value) throw new Error(message); }
function load(name) {
    const [, bytes] = GLib.file_get_contents(`extension/gnozzard@openresearchtools/${name}.js`);
    return new TextDecoder().decode(bytes).replace(/^import .+;\n/gm, '').replace(/^export /gm, '');
}
class Item {
    constructor(text) {
        this.label = {text, add_style_class_name: value => { this.style = value; }};
        this.sensitive = true;
    }
    setSensitive(value) { this.sensitive = value; }
    destroy() { this.parent.items.splice(this.parent.items.indexOf(this), 1); }
}
class Menu {
    constructor() { this.items = []; this.signals = new Map(); }
    addMenuItem(item, position = this.items.length) {
        item.parent = this; this.items.splice(position, 0, item);
    }
    addAction(label, callback) {
        const item = new Item(label); item.activate = callback; this.addMenuItem(item); return item;
    }
    _getMenuItems() { return [...this.items]; }
    connect(signal, callback) {
        const handlers = this.signals.get(signal) ?? [];
        handlers.push(callback); this.signals.set(signal, handlers);
    }
    close() {
        this.destroyed = true;
        // Shell's JS signals stop propagation when a handler returns true.
        for (const callback of this.signals.get('destroy') ?? []) {
            if (callback(this) === true)
                break;
        }
    }
}
class Submenu extends Item { constructor(label) { super(label); this.menu = new Menu(); } }
class Separator extends Item { constructor() { super(null); } }
class InjectionManager {
    overrideMethod(proto, name, create) {
        this.proto = proto; this.name = name; this.original = proto[name]; proto[name] = create(this.original);
    }
    clear() { this.proto[this.name] = this.original; }
}
let locale = '';
const Gettext = {dgettext(domain, text) {
    assert(domain === 'gnome-shell', 'Native action labels use the Shell gettext domain');
    return locale + text;
}};
let workspaces, active, focus, hides, trace;
function workspace() {
    return {activate_with_focus(window, time) {
        trace.push('focus'); active = this; focus = window;
        assert(time === 123, 'Focus and move share the native event timestamp');
    }};
}
const manager = {
    get_n_workspaces: () => workspaces.length,
    get_workspace_by_index: index => workspaces[index],
    append_new_workspace(activate, time) {
        trace.push('create'); assert(!activate && time === 123, 'Create through Mutter before focus');
        const next = workspace(); workspaces.push(next); return next;
    },
};
const native = {workspace_manager: manager, get_current_time: () => 123};
const Main = {overview: {hide() { trace.push('overview'); hides++; }}};
const helpers = new Function('Main', 'global', load('workplaces') + '\nreturn {workspaceLabel,moveWindowToWorkplace};')(Main, native);
let nativeDirections = [];
class NativeMenu extends Menu {
    constructor(window) { super(); this._buildMenu(window); }
    _buildMenu(window) {
        this.window = window; this.nativeBuilds = (this.nativeBuilds ?? 0) + 1;
        for (const title of ['Take Screenshot', 'Hide', 'Maximize', 'Move', 'Resize', 'Always on Top', 'Always on Visible Workspace', ...nativeDirections, 'Move to Monitor Left'])
            this.addAction(locale + title, () => {});
        this.addMenuItem(new Separator());
        this.addAction(locale + 'Close', () => {});
    }
}
const {addWorkplaceMenu, addForceKillAction, NativeWindowMenus} = new Function(
    'Gettext', 'PopupMenu', 'WindowMenu', 'InjectionManager', 'moveWindowToWorkplace', 'workspaceLabel', 'global',
    load('windowActions') + '\nreturn {addWorkplaceMenu,addForceKillAction,NativeWindowMenus};')(
    Gettext, {PopupSubMenuMenuItem: Submenu, PopupSeparatorMenuItem: Separator},
    {WindowMenu: NativeMenu}, InjectionManager, helpers.moveWindowToWorkplace, helpers.workspaceLabel, native);
function reset(size = 3, sticky = false) {
    workspaces = Array.from({length: size}, workspace); active = workspaces[0]; hides = 0; trace = [];
    return {current: active, sticky, always: false, killed: 0,
        get_workspace() { return this.current; },
        is_on_all_workspaces() { return this.sticky; },
        is_always_on_all_workspaces() { return this.always; },
        unstick() { trace.push('unstick'); this.sticky = false; },
        change_workspace(target) { trace.push('move'); this.current = target; },
        kill() { this.killed++; },
    };
}
for (const size of [1, 3, 24]) {
    for (const sticky of [false, true]) {
        const window = reset(size, sticky), menu = new Menu();
        const move = addWorkplaceMenu(menu, window);
        assert(move.menu.items.length === size + 2, 'List every existing workplace, separator and New Workplace');
        assert(move.menu.items[0].label.text === 'Desktop', 'The main workplace has the shared name');
        assert(move.menu.items[0].sensitive === sticky, 'Current workplace disabled except for a sticky window');
        if (size > 1) {
            move.menu.items[1].activate();
            assert(window.current === workspaces[1] && active === workspaces[1] && focus === window,
                'An existing destination receives the window and focus');
            assert(!window.sticky && hides === 1, 'Moving unsticks the window and leaves overview');
            assert(trace.join(',') === (sticky ? 'unstick,move,focus,overview' : 'move,focus,overview'),
                'Shared native move has one ordered path');
        }
        move.menu.items.at(-1).activate();
        assert(workspaces.length === size + 1 && window.current === workspaces.at(-1) && active === window.current,
            'New Workplace creates once, moves and follows the window');
        const kill = addForceKillAction(menu, window);
        assert(kill.style === 'gnozzard-destructive-text', 'Force Kill keeps its destructive styling');
        kill.activate(); assert(window.killed === 1, 'Force Kill uses the native window operation exactly once');
    }
}
const immovable = reset(); immovable.always = true;
assert(!addWorkplaceMenu(new Menu(), immovable).sensitive, 'Inherently sticky system windows cannot be moved');
const original = NativeMenu.prototype._buildMenu;
for (locale of ['', 'translated:']) {
    for (nativeDirections of [[], ['Move to Workspace Left'], ['Move to Workspace Left', 'Move to Workspace Right'],
        ['Move to Workspace Left', 'Move to Workspace Right', 'Move to Workspace Up', 'Move to Workspace Down']]) {
        const extension = new NativeWindowMenus(), window = reset();
        const menu = new NativeMenu(window), labels = menu.items.map(item => item.label.text);
        // WindowMenuManager registers its own cleanup after _buildMenu returns.
        const nativeTracked = new Set([menu]);
        menu.connect('destroy', () => { nativeTracked.delete(menu); });
        assert(menu.nativeBuilds === 1 && menu.window === window, 'Keep native construction and its window receiver');
        assert(labels.filter(label => label === 'Move to Workplace').length === 1, 'Exactly one full workplace submenu');
        assert(nativeDirections.every(label => !labels.includes(locale + label)), 'Replace all translated directional shortcuts');
        for (const title of ['Take Screenshot', 'Hide', 'Maximize', 'Move', 'Resize', 'Always on Top', 'Always on Visible Workspace', 'Move to Monitor Left', 'Close'])
            assert(labels.includes(locale + title), 'Preserve native action: ' + title);
        assert(labels.at(-1) === 'Force Kill', 'Force Kill follows native Close');
        const submenu = menu.items.find(item => item instanceof Submenu);
        submenu.menu.items[1].activate();
        assert(active === workspaces[1] && focus === window, 'The native menu uses the same move/follow action');
        menu.items.at(-1).activate(); assert(window.killed === 1, 'Native menu shares Force Kill');
        menu.close(); assert(extension._menus.size === 0, 'Closed native menus leave no tracked references');
        assert(nativeTracked.size === 0, 'Our cleanup must not stop native menu-manager cleanup');
        const open = new NativeMenu(window);
        nativeTracked.add(open);
        open.connect('destroy', () => { nativeTracked.delete(open); });
        extension.destroy();
        assert(open.destroyed && extension._menus.size === 0, 'Disabling closes an active modified native menu');
        assert(nativeTracked.size === 0, 'Disabling also releases the native menu-manager reference');
        assert(NativeMenu.prototype._buildMenu === original, 'Disabling restores the original native method');
        const restored = new NativeMenu(window);
        assert(restored.items.every(item => !['Force Kill', 'Move to Workplace'].includes(item.label.text)),
            'No custom entries remain after disable or accumulate across re-enable');
    }
}
print(`Window actions: ${count} assertions passed`);
