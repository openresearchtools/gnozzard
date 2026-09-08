// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function workspaceLabel(index) {
    return index === 0 ? 'Desktop' : `Workplace ${index + 1}`;
}

export function reorderWorkplace(workspace, offset, settings) {
    const manager = global.workspace_manager;
    const index = workspace.index();
    const target = index + offset;
    // Desktop remains the fixed home for windows from closed workplaces.
    if (![-1, 1].includes(offset) || index < 1 || target < 1 ||
        target >= manager.get_n_workspaces())
        return false;
    const disabled = settings.get_value('tiling-disabled-workplaces').deepUnpack()
        .map(i => manager.get_workspace_by_index(i)).filter(Boolean);
    manager.reorder_workspace(workspace, target);
    // Persist by the new indices even when the optional tiler is turned off.
    settings.set_value('tiling-disabled-workplaces', new GLib.Variant('ai',
        disabled.map(w => w.index()).sort((a, b) => a - b)));
    return true;
}

// One move operation for both window menus and automatic allocation. GNOME owns the
// workplace objects, creation, focus and switching; there is no parallel model.
export function moveWindowToWorkplace(window, workspace = null) {
    const time = global.get_current_time();
    workspace ??= global.workspace_manager.append_new_workspace(false, time);
    if (window.is_on_all_workspaces())
        window.unstick();
    window.change_workspace(workspace);
    workspace.activate_with_focus(window, time);
    Main.overview.hide();
    return workspace;
}
