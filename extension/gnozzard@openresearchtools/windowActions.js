// SPDX-License-Identifier: GPL-3.0-or-later
import Gettext from 'gettext';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as WindowMenu from 'resource:///org/gnome/shell/ui/windowMenu.js';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import {moveWindowToWorkplace, workspaceLabel} from './workplaces.js';

// The titlebar and taskbar share these actions, including destination focus.
export function addWorkplaceMenu(menu, window, position) {
    const manager = global.workspace_manager;
    const current = window.is_on_all_workspaces() ? null : window.get_workspace();
    const move = new PopupMenu.PopupSubMenuMenuItem('Move to Workplace');
    for (let index = 0; index < manager.get_n_workspaces(); index++) {
        const workspace = manager.get_workspace_by_index(index);
        const item = move.menu.addAction(workspaceLabel(index), () =>
            moveWindowToWorkplace(window, workspace));
        item.setSensitive(workspace !== current);
    }
    move.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    move.menu.addAction('New Workplace', () => moveWindowToWorkplace(window));
    move.setSensitive(!window.is_always_on_all_workspaces());
    menu.addMenuItem(move, position);
    return move;
}

export function addForceKillAction(menu, window) {
    const item = menu.addAction('Force Kill', () => window.kill());
    item.label.add_style_class_name('gnozzard-destructive-text');
    return item;
}

export class NativeWindowMenus {
    constructor() {
        this._menus = new Set();
        this._injections = new InjectionManager();
        // Shell exposes no IDs for these four native actions. Match its own
        // translations, never an English prefix or a hard-coded item index.
        const directions = new Set([
            'Move to Workspace Left', 'Move to Workspace Right',
            'Move to Workspace Up', 'Move to Workspace Down',
        ].map(label => Gettext.dgettext('gnome-shell', label)));
        const closeLabel = Gettext.dgettext('gnome-shell', 'Close');
        const menus = this._menus;
        this._injections.overrideMethod(WindowMenu.WindowMenu.prototype, '_buildMenu',
            original => function (window) {
                original.call(this, window);
                const items = this._getMenuItems();
                const oldMoves = items.filter(item => directions.has(item.label?.text));
                const position = items.findIndex(item =>
                    directions.has(item.label?.text) || item.label?.text === closeLabel);
                for (const item of oldMoves)
                    item.destroy();
                addWorkplaceMenu(this, window, position);
                addForceKillAction(this, window);
                menus.add(this);
                this.connect('destroy', () => {
                    menus.delete(this);
                });
            });
    }

    destroy() {
        this._injections.clear();
        for (const menu of this._menus)
            menu.close();
        this._menus.clear();
    }
}
