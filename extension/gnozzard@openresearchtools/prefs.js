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
        const group = new Adw.PreferencesGroup({title: 'Classic desktop'});

        const allWorkspaces = new Adw.SwitchRow({
            title: 'Windows from all workplaces',
            subtitle: 'Selecting another workplace’s window switches to that workplace',
        });
        settings.bind('taskbar-all-workspaces', allWorkspaces, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(allWorkspaces);

        const resources = new Adw.SwitchRow({
            title: 'Resources launcher',
            subtitle: 'Show an icon beside top-bar status items',
        });
        settings.bind('show-resources-button', resources, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(resources);

        const colour = new Adw.ActionRow({
            title: 'Taskbar colour',
            subtitle: 'A single solid colour',
        });
        const colourButton = new Gtk.ColorButton({valign: Gtk.Align.CENTER});
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string('panel-color')))
            colourButton.set_rgba(rgba);
        colourButton.connect('color-set', button =>
            settings.set_string('panel-color', button.get_rgba().to_string()));
        colour.add_suffix(colourButton);
        group.add(colour);

        page.add(group);
        window.add(page);
    }
}
