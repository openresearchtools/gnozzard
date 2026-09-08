// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnozzardPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Desktop',
            icon_name: 'preferences-desktop-symbolic',
        });
        const addSwitch = (group, key, title) => {
            const row = new Adw.SwitchRow({title});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
            return row;
        };
        const arrangement = new Adw.PreferencesGroup({title: 'Windows'});
        addSwitch(arrangement, 'auto-tile-windows', 'Auto-arrange windows');
        const linked = addSwitch(arrangement, 'tiling-linked-dividers', 'Link aligned dividers');
        settings.bind('auto-tile-windows', linked, 'sensitive', Gio.SettingsBindFlags.GET);
        page.add(arrangement);

        const workplaces = new Adw.PreferencesGroup({title: 'Workplaces'});
        addSwitch(workplaces, 'edge-switch-workplaces', 'Switch workplaces at screen edges');
        page.add(workplaces);

        const bars = new Adw.PreferencesGroup({title: 'Bars'});
        const modes = ['automatic', 'always', 'never'];
        const mode = new Adw.ComboRow({title: 'Taskbar',
            model: Gtk.StringList.new(['Off while tiling', 'Always show', 'Never show']),
            selected: modes.indexOf(settings.get_string('taskbar-mode'))});
        mode.connect('notify::selected', () => settings.set_string('taskbar-mode', modes[mode.selected]));
        bars.add(mode);
        addSwitch(bars, 'swap-bars', 'Swap taskbar with system bar places');
        addSwitch(bars, 'autohide-top-bar', 'Auto-hide system bar');
        const hideTaskbar = addSwitch(bars, 'autohide-taskbar', 'Auto-hide taskbar');
        addSwitch(bars, 'show-resources-button', 'Resources launcher');
        page.add(bars);

        const group = new Adw.PreferencesGroup({title: 'Taskbar windows'});
        addSwitch(group, 'taskbars-all-displays', 'All displays');
        addSwitch(group, 'taskbar-all-workspaces', 'Windows from all workplaces');
        addSwitch(group, 'capped-task-buttons', 'Limit button width');
        const colour = new Adw.ActionRow({title: 'Taskbar colour'});
        const colourButton = new Gtk.ColorButton({valign: Gtk.Align.CENTER});
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string('panel-color')))
            colourButton.set_rgba(rgba);
        colourButton.connect('color-set', button =>
            settings.set_string('panel-color', button.get_rgba().to_string()));
        colour.add_suffix(colourButton);
        group.add(colour);

        page.add(group);
        for (const widget of [group, hideTaskbar])
            settings.bind('taskbar-present', widget, 'sensitive', Gio.SettingsBindFlags.GET);
        const syncMode = () => {
            const value = settings.get_string('taskbar-mode');
            mode.selected = modes.indexOf(value);
        };
        const modeSignal = settings.connect('changed::taskbar-mode', syncMode);
        window.connect('close-request', () => {
            settings.disconnect(modeSignal);
            return false;
        });
        syncMode();
        window.add(page);
    }
}
