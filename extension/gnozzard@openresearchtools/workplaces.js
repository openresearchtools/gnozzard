// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export function workspaceLabel(index) {
    return index === 0 ? 'Desktop' : `Workplace ${index + 1}`;
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
