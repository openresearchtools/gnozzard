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

        const singleWorkspace = new Adw.SwitchRow({
            title: 'Use one workspace',
            subtitle: 'Disable GNOME dynamic workspaces while the extension is active',
        });
        settings.bind('force-single-workspace', singleWorkspace, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(singleWorkspace);

        const resources = new Adw.SwitchRow({
            title: 'Resources button',
            subtitle: 'Replace Activities at the top left with Resources',
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
