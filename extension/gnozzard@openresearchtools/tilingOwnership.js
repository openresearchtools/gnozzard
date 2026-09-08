// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

// Explicit identities, not guesses based on translated extension names.
const TILERS = new Set(['tiling-assistant@ubuntu.com', 'tiling-assistant@leleat-on-github',
    'tilingshell@ferrarodomenico.com', 'forge@jmmaranan.com', 'pop-shell@system76.com',
    'material-shell@papyelgringo', 'paperwm@paperwm.github.com', 'gTile@vibou',
    'shellshape@gfxmonk.net', 'o-tiling@oliwebd.github.com']);
const OWN_UUID = 'gnozzard@openresearchtools';
const NATIVE = [
    ['org.gnome.mutter', 'edge-tiling', false],
    ['org.gnome.mutter', 'auto-maximize', false],
    ['org.gnome.mutter.keybindings', 'toggle-tiled-left', []],
    ['org.gnome.mutter.keybindings', 'toggle-tiled-right', []],
];

export class TilingOwnership {
    constructor(settings) {
        this._settings = settings;
        this._signals = [];
        this._native = [];
        this._source = 0;
        this._saved = JSON.parse(settings.get_string('tiling-previous-state'));
        this._connect(Main.extensionManager, 'extension-state-changed', () => this._queue());
        this._connect(global.settings, 'changed::enabled-extensions', () => this._queue());
        this._queue();
    }

    _connect(object, signal, callback) {
        this._signals.push([object, object.connect(signal, callback)]);
    }

    _save() {
        this._settings.set_string('tiling-previous-state', JSON.stringify(this._saved));
    }

    _queue() {
        if (this._source)
            return;
        this._source = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._source = 0;
            this._takeOwnership();
            return GLib.SOURCE_REMOVE;
        });
    }

    _takeOwnership() {
        let waiting = false;
        for (const uuid of TILERS) {
            const extension = Main.extensionManager.lookup(uuid);
            if (!extension)
                continue;
            if (extension.enabled || global.settings.get_strv('enabled-extensions').includes(uuid)) {
                this._saved.extensions ??= [];
                if (!this._saved.extensions.includes(uuid)) {
                    this._saved.extensions.push(uuid);
                    this._save();
                }
                Main.extensionManager.disableExtension(uuid);
            }
            // Wait for the other extension's disable() to restore its overrides.
            // GNOME may rebase (temporarily disable/re-enable) us in that process.
            waiting ||= [ExtensionState.ACTIVE ?? ExtensionState.ENABLED,
                ExtensionState.ACTIVATING, ExtensionState.DEACTIVATING].includes(extension.state);
        }
        if (waiting || this._native.length)
            return;
        const source = Gio.SettingsSchemaSource.get_default();
        for (const [schemaId, key, value] of NATIVE) {
            const schema = source.lookup(schemaId, true);
            if (!schema?.has_key(key))
                continue;
            const settings = Gio.Settings.new_full(schema, null, null);
            const id = `${schemaId}/${key}`;
            this._saved.native ??= {};
            if (!(id in this._saved.native)) {
                this._saved.native[id] = settings.get_value(key).print(true);
                this._save();
            }
            const variant = new GLib.Variant(Array.isArray(value) ? 'as' : 'b', value);
            const enforce = () => {
                if (!settings.get_value(key).equal(variant))
                    settings.set_value(key, variant);
            };
            this._connect(settings, `changed::${key}`, enforce);
            this._native.push(settings);
            enforce();
        }
    }

    destroy() {
        if (this._source)
            GLib.source_remove(this._source);
        for (const [object, id] of this._signals)
            object.disconnect(id);
        this._signals = [];
        // Preserve ownership through screen locking and extension-manager rebases.
        const stillEnabled = global.settings.get_strv('enabled-extensions').includes(OWN_UUID) &&
            !global.settings.get_strv('disabled-extensions').includes(OWN_UUID) &&
            !global.settings.get_boolean('disable-user-extensions');
        if (stillEnabled)
            return;
        const source = Gio.SettingsSchemaSource.get_default();
        for (const [id, value] of Object.entries(this._saved.native ?? {})) {
            const [schemaId, key] = id.split('/');
            const schema = source.lookup(schemaId, true);
            if (schema?.has_key(key))
                Gio.Settings.new_full(schema, null, null).set_value(key,
                    GLib.Variant.parse(null, value, null, null));
        }
        const extensions = this._saved.extensions ?? [];
        this._settings.set_string('tiling-previous-state', '{}');
        for (const uuid of extensions)
            Main.extensionManager.enableExtension(uuid);
    }
}
