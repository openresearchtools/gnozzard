// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PANEL_HEIGHT = 40;
const MENU_WIDTH_RATIO = 0.28;
const MENU_MIN_WIDTH = 320;
const MENU_MAX_WIDTH = 480;
const CAPPED_TASK_BUTTON_WIDTH = 260;
const EXTENSION_UUID = 'gnozzard@openresearchtools';

function markSessionInitialized() {
    const stateDirectory = GLib.build_filenamev([
        GLib.get_user_state_dir(),
        'gnozzard',
    ]);
    if (GLib.mkdir_with_parents(stateDirectory, 0o700) !== 0)
        throw new Error(`Could not create ${stateDirectory}`);
    const marker = GLib.build_filenamev([stateDirectory, 'session-initialized']);
    if (!GLib.file_set_contents(marker, 'initialized\n'))
        throw new Error(`Could not write ${marker}`);
}

function turnOffGnozzard() {
    markSessionInitialized();
    const process = Gio.Subprocess.new(
        ['/usr/bin/gnome-extensions', 'disable', EXTENSION_UUID],
        Gio.SubprocessFlags.NONE
    );
    process.wait_check_async(null, (subprocess, result) => {
        try {
            subprocess.wait_check_finish(result);
        } catch (error) {
            Main.notifyError('Gnozzard', `Could not turn off the extension: ${error.message}`);
        }
    });
}

function stopEvent() {
    return Clutter.EVENT_STOP;
}

function managedAppForWindow(window) {
    const appSystem = Shell.AppSystem.get_default();
    const installed = appSystem.get_installed();
    const windowClasses = new Set([
        window.get_wm_class?.(),
        window.get_wm_class_instance?.(),
    ].filter(value => value).map(value => value.toLocaleLowerCase()));

    for (const appInfo of installed) {
        if (!appInfo.get_id()?.startsWith('gnozzard-launcher-'))
            continue;
        const startupClass = appInfo.get_startup_wm_class?.();
        if (startupClass && windowClasses.has(startupClass.toLocaleLowerCase()))
            return appSystem.lookup_app(appInfo.get_id());
    }

    const pid = window.get_pid();
    if (pid <= 0)
        return null;
    try {
        const [ok, contents] = GLib.file_get_contents(`/proc/${pid}/environ`);
        if (!ok)
            return null;
        const environment = new TextDecoder().decode(contents).split('\0');
        const appImage = environment
            .find(variable => variable.startsWith('APPIMAGE='))
            ?.slice('APPIMAGE='.length);
        if (!appImage)
            return null;

        for (const appInfo of installed) {
            if (!appInfo.get_id()?.startsWith('gnozzard-appimage-'))
                continue;
            if (appInfo.get_string?.('X-AppImage-Path') === appImage)
                return appSystem.lookup_app(appInfo.get_id());
        }
    } catch (_error) {
        // /proc can disappear while a window is closing.
    }
    return null;
}

class SignalStore {
    constructor() {
        this._signals = [];
    }

    connect(object, signal, callback) {
        const id = object.connect(signal, callback);
        this._signals.push([object, id]);
        return id;
    }

    clear() {
        for (const [object, id] of this._signals) {
            try {
                object.disconnect(id);
            } catch (_error) {
                // An object may already have been destroyed by GNOME Shell.
            }
        }
        this._signals = [];
    }
}

class AppContextMenu {
    constructor(source, app, settings, refresh) {
        this._app = app;
        this._settings = settings;
        this._refresh = refresh;
        this.menu = new PopupMenu.PopupMenu(source, 0.25, St.Side.BOTTOM);
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(source);
        this._manager.addMenu(this.menu);
        this._rebuild();
    }

    _rebuild() {
        this.menu.removeAll();
        const desktopId = this._app.get_id();
        const pinned = this._settings.get_strv('pinned-apps');
        const isPinned = pinned.includes(desktopId);

        const launch = new PopupMenu.PopupMenuItem('Open');
        launch.connect('activate', () => this._app.open_new_window(-1));
        this.menu.addMenuItem(launch);

        const pin = new PopupMenu.PopupMenuItem(isPinned ? 'Unpin' : 'Pin');
        pin.connect('activate', () => {
            const next = isPinned
                ? pinned.filter(id => id !== desktopId)
                : [...pinned, desktopId];
            this._settings.set_strv('pinned-apps', next);
            this._refresh();
        });
        this.menu.addMenuItem(pin);

        const desktop = new PopupMenu.PopupMenuItem('Add to Desktop');
        desktop.connect('activate', () => {
            try {
                Gio.Subprocess.new(
                    ['/usr/libexec/gnozzard', 'app-to-desktop', desktopId],
                    Gio.SubprocessFlags.NONE
                );
            } catch (error) {
                logError(error, `Could not create a desktop shortcut for ${desktopId}`);
            }
        });
        this.menu.addMenuItem(desktop);

        const isAppImage = desktopId.startsWith('gnozzard-appimage-');
        const isDesktopLauncher = desktopId.startsWith('gnozzard-launcher-');
        if (isAppImage || isDesktopLauncher) {
            const renameCommand = isAppImage ? 'rename-appimage' : 'rename-desktop';
            const removeCommand = isAppImage ? 'remove-appimage' : 'remove-desktop';
            const rename = new PopupMenu.PopupMenuItem('Rename…');
            rename.connect('activate', () => this._renameManaged(desktopId, renameCommand));
            this.menu.addMenuItem(rename);

            const remove = new PopupMenu.PopupMenuItem('Delete from Applications');
            remove.connect('activate', () => {
                const nextPinned = this._settings.get_strv('pinned-apps')
                    .filter(id => id !== desktopId);
                this._settings.set_strv('pinned-apps', nextPinned);
                try {
                    const process = Gio.Subprocess.new(
                        ['/usr/libexec/gnozzard', removeCommand, desktopId],
                        Gio.SubprocessFlags.NONE
                    );
                    process.wait_check_async(null, (subprocess, result) => {
                        try {
                            subprocess.wait_check_finish(result);
                            this._refresh();
                        } catch (error) {
                            logError(error, `Could not remove ${desktopId}`);
                        }
                    });
                } catch (error) {
                    logError(error, `Could not remove ${desktopId}`);
                }
            });
            this.menu.addMenuItem(remove);
        }
    }

    _renameManaged(desktopId, command) {
        const currentName = this._app.get_name();
        this._refresh(true);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            try {
                const dialog = Gio.Subprocess.new(
                    [
                        '/usr/bin/zenity',
                        '--entry',
                        '--title=Rename Application',
                        '--text=Name shown in Applications:',
                        `--entry-text=${currentName}`,
                        '--width=420',
                    ],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );
                dialog.communicate_utf8_async(null, null, (process, result) => {
                    try {
                        const [, output] = process.communicate_utf8_finish(result);
                        if (!process.get_successful())
                            return;
                        const name = output.trim();
                        if (!name)
                            return;
                        const rename = Gio.Subprocess.new(
                            ['/usr/libexec/gnozzard', command, desktopId, name],
                            Gio.SubprocessFlags.NONE
                        );
                        rename.wait_check_async(null, (subprocess, renameResult) => {
                            try {
                                subprocess.wait_check_finish(renameResult);
                                this._refresh();
                            } catch (error) {
                                logError(error, `Could not rename ${desktopId}`);
                            }
                        });
                    } catch (error) {
                        logError(error, `Could not read the new name for ${desktopId}`);
                    }
                });
            } catch (error) {
                logError(error, `Could not open the rename dialog for ${desktopId}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    open() {
        this._rebuild();
        this.menu.open(true);
    }

    destroy() {
        this.menu.destroy();
        this._manager = null;
    }
}

class ApplicationRow {
    constructor(app, settings, refresh) {
        this.app = app;
        this.actor = new St.Button({
            style_class: 'gnozzard-app-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            can_focus: true,
            reactive: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });
        const content = new St.BoxLayout({
            style_class: 'gnozzard-app-row-content',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
        });
        content.add_child(app.create_icon_texture(24));
        content.add_child(new St.Label({
            text: app.get_name(),
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        }));
        this.actor.set_child(content);
        this._context = null;
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) {
                // Most users never open a row's secondary menu. Build it only
                // on demand instead of allocating a PopupMenu per installed app.
                this._context ??= new AppContextMenu(this.actor, app, settings, refresh);
                this._context.open();
                return stopEvent();
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.actor.connect('clicked', () => {
            app.open_new_window(-1);
            refresh(true);
        });
    }

    destroy() {
        this._context?.destroy();
        this.actor.destroy();
    }

    get contextActor() {
        return this._context?.menu.actor ?? null;
    }
}

class ApplicationsMenu {
    constructor(settings, panel, monitorIndex) {
        this._settings = settings;
        this._panel = panel;
        this._monitorIndex = monitorIndex;
        this._rows = [];
        this._dirty = true;
        this._open = false;
        this._grab = null;
        this._searchTimeout = 0;
        this._signals = new SignalStore();
        this._overlay = new St.Widget({
            reactive: true,
            visible: false,
        });
        this._dismissArea = new St.Widget({reactive: true});
        this._overlay.add_child(this._dismissArea);
        this.actor = new St.BoxLayout({
            style_class: 'gnozzard-app-menu',
            vertical: true,
            reactive: true,
        });
        this._overlay.add_child(this.actor);
        this._search = new St.Entry({
            style_class: 'gnozzard-app-search',
            hint_text: 'Search applications',
            can_focus: true,
            track_hover: true,
            x_expand: true,
        });
        this._settingsButton = new St.Button({
            style_class: 'gnozzard-settings-button',
            can_focus: true,
            reactive: true,
            accessible_name: 'Gnozzard settings',
            child: new St.Icon({
                icon_name: 'preferences-system-symbolic',
                icon_size: 18,
            }),
        });
        this._scroll = new St.ScrollView({
            x_expand: true,
            y_expand: true,
            overlay_scrollbars: true,
        });
        this._scroll.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
        this._list = new St.BoxLayout({
            style_class: 'gnozzard-app-list',
            vertical: true,
            x_expand: true,
        });
        this._scroll.set_child(this._list);
        this.actor.add_child(this._scroll);
        this._pinned = new St.BoxLayout({
            style_class: 'gnozzard-pinned-section',
            vertical: true,
            x_expand: true,
        });
        this.actor.add_child(this._pinned);
        this._bottomBar = new St.BoxLayout({style_class: 'gnozzard-menu-bottom-bar'});
        this._bottomBar.add_child(this._search);
        this._bottomBar.add_child(this._settingsButton);
        this.actor.add_child(this._bottomBar);
        this._signals.connect(this._settingsButton, 'clicked', () => {
            this.close();
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                const dialog = new DisplaySettingsDialog(this._settings);
                dialog.connect('closed', () => dialog.destroy());
                dialog.open();
                return GLib.SOURCE_REMOVE;
            });
        });

        this._signals.connect(this._overlay, 'notify::visible', () => {
            if (this._overlay.visible && !this._open)
                this._overlay.hide();
        });
        this._signals.connect(this._dismissArea, 'button-press-event', () => {
            this.close();
            return Clutter.EVENT_STOP;
        });
        this._signals.connect(this._dismissArea, 'touch-event', (_actor, event) => {
            if (event.type() === Clutter.EventType.TOUCH_BEGIN) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        Main.layoutManager.addChrome(this._overlay, {
            affectsStruts: false,
            trackFullscreen: true,
        });
        // addChrome() may map an actor even when it was constructed hidden.
        // Keep the applications menu closed until the user asks for it.
        this._overlay.hide();
        this._signals.connect(this._search.clutter_text, 'text-changed', () => {
            if (this._searchTimeout)
                GLib.source_remove(this._searchTimeout);
            this._searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 90, () => {
                this._searchTimeout = 0;
                if (this._overlay.visible)
                    this._rebuild();
                else
                    this._dirty = true;
                return GLib.SOURCE_REMOVE;
            });
        });
        this._signals.connect(
            Shell.AppSystem.get_default(),
            'installed-changed',
            () => this._markDirty()
        );
        this._signals.connect(settings, 'changed::pinned-apps', () => this._markDirty());
        this._signals.connect(global.display, 'notify::focus-window', () => {
            if (this._overlay.visible)
                this.close();
        });
        this.relayout();
    }

    _markDirty() {
        this._dirty = true;
        if (this._overlay.visible)
            this._rebuild();
    }

    _clearRows() {
        for (const row of this._rows)
            row.destroy();
        this._rows = [];
        this._list.destroy_all_children();
        this._pinned.destroy_all_children();
    }

    _makeRow(app) {
        const row = new ApplicationRow(app, this._settings, close => {
            if (close === true)
                this.close();
            else
                this._rebuild();
        });
        this._rows.push(row);
        return row.actor;
    }

    _rebuild() {
        this._dirty = false;
        this._clearRows();
        const query = this._search.get_text().trim().toLocaleLowerCase();
        const pinnedIds = this._settings.get_strv('pinned-apps');
        const pinned = new Set(pinnedIds);
        const appSystem = Shell.AppSystem.get_default();
        const apps = appSystem.get_installed()
            .filter(appInfo => appInfo.should_show())
            .map(appInfo => appSystem.lookup_app(appInfo.get_id()))
            .filter(app => app !== null)
            .filter(app => !query ||
                app.get_name().toLocaleLowerCase().includes(query) ||
                (app.get_description() ?? '').toLocaleLowerCase().includes(query))
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));

        for (const app of apps.filter(item => !pinned.has(item.get_id())))
            this._list.add_child(this._makeRow(app));

        const pinnedApps = pinnedIds
            .map(id => appSystem.lookup_app(id))
            .filter(app => app !== null)
            .filter(app => !query || app.get_name().toLocaleLowerCase().includes(query));
        if (pinnedApps.length > 0) {
            this._pinned.add_child(new St.Label({
                style_class: 'gnozzard-pinned-title',
                text: 'Pinned',
            }));
            for (const app of pinnedApps)
                this._pinned.add_child(this._makeRow(app));
            this._pinned.show();
        } else {
            this._pinned.hide();
        }
    }

    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const top = Main.panel?.height ?? 0;
        const height = Math.max(240, monitor.height - top - PANEL_HEIGHT);
        this._overlay.set_position(monitor.x, monitor.y);
        this._overlay.set_size(monitor.width, monitor.height);
        this._dismissArea.set_position(0, 0);
        this._dismissArea.set_size(monitor.width, monitor.height);
        this.actor.set_position(0, monitor.height - PANEL_HEIGHT - height);
        const width = Math.min(
            MENU_MAX_WIDTH,
            Math.max(MENU_MIN_WIDTH, Math.floor(monitor.width * MENU_WIDTH_RATIO))
        );
        this.actor.set_size(Math.min(width, monitor.width), height);
    }

    toggle() {
        if (this._overlay.visible)
            this.close();
        else
            this.open();
    }

    open() {
        this._open = true;
        this.relayout();
        if (this._dirty)
            this._rebuild();
        this._overlay.show();
        this._overlay.get_parent()?.set_child_above_sibling(this._overlay, null);
        this._grab = Main.pushModal(this._overlay, {
            actionMode: Shell.ActionMode.NORMAL,
        });
        global.stage.set_key_focus(this._search.clutter_text);
    }

    close() {
        this._open = false;
        this._overlay.hide();
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        global.stage.set_key_focus(null);
        console.debug('gnozzard: Applications menu closed');
    }

    destroy() {
        if (this._searchTimeout)
            GLib.source_remove(this._searchTimeout);
        this._clearRows();
        this._signals.clear();
        Main.layoutManager.removeChrome(this._overlay);
        this._overlay.destroy();
    }
}

const TurnOffGnozzardDialog = GObject.registerClass(
class TurnOffGnozzardDialog extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'gnozzard-settings-dialog'});
        this.contentLayout.add_child(new St.Label({
            style_class: 'gnozzard-settings-title',
            text: 'Turn off Gnozzard?',
        }));
        const description = new St.Label({
            style_class: 'gnozzard-settings-description',
            text: 'The classic taskbar and Applications menu will close. To turn Gnozzard back on, open Extensions and enable Gnozzard.',
            x_expand: true,
        });
        description.clutter_text.set_line_wrap(true);
        this.contentLayout.add_child(description);
        this.setButtons([
            {
                label: 'Cancel',
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Turn Off Gnozzard',
                action: () => {
                    this.close();
                    try {
                        turnOffGnozzard();
                    } catch (error) {
                        Main.notifyError('Gnozzard', `Could not turn off the extension: ${error.message}`);
                    }
                },
            },
        ]);
    }
});

const DisplaySettingsDialog = GObject.registerClass(
class DisplaySettingsDialog extends ModalDialog.ModalDialog {
    _init(settings) {
        super._init({styleClass: 'gnozzard-settings-dialog'});
        this._settings = settings;
        this.contentLayout.add_child(new St.Label({
            style_class: 'gnozzard-settings-title',
            text: 'Taskbar displays',
        }));
        this.contentLayout.add_child(new St.Label({
            style_class: 'gnozzard-settings-description',
            text: 'Choose where the complete Gnozzard taskbar is shown.',
        }));
        const cappedRow = new St.BoxLayout({
            style_class: 'gnozzard-setting-row',
            x_expand: true,
        });
        const cappedCopy = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });
        cappedCopy.add_child(new St.Label({
            style_class: 'gnozzard-setting-label',
            text: 'Capped task buttons',
            x_align: Clutter.ActorAlign.START,
        }));
        const cappedDescription = new St.Label({
            style_class: 'gnozzard-settings-description',
            text: 'Keep task buttons packed beside Applications. They shrink evenly when space runs out.',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        cappedDescription.clutter_text.set_line_wrap(true);
        cappedCopy.add_child(cappedDescription);
        cappedRow.add_child(cappedCopy);
        const cappedToggle = new St.Button({
            style_class: 'gnozzard-setting-toggle',
            can_focus: true,
            reactive: true,
            toggle_mode: true,
            checked: settings.get_boolean('capped-task-buttons'),
        });
        const updateCappedLabel = () => {
            cappedToggle.set_label(cappedToggle.checked ? 'On' : 'Off');
        };
        updateCappedLabel();
        cappedToggle.connect('notify::checked', () => {
            this._settings.set_boolean('capped-task-buttons', cappedToggle.checked);
            updateCappedLabel();
        });
        cappedRow.add_child(cappedToggle);
        this.contentLayout.add_child(cappedRow);
        const turnOffButton = new St.Button({
            style_class: 'gnozzard-turn-off-button',
            label: 'Turn Off Gnozzard',
            can_focus: true,
            reactive: true,
            x_align: Clutter.ActorAlign.START,
        });
        turnOffButton.connect('clicked', () => {
            this.close();
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                const dialog = new TurnOffGnozzardDialog();
                dialog.connect('closed', () => dialog.destroy());
                dialog.open();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.contentLayout.add_child(turnOffButton);
        this.setButtons([
            {
                label: 'Cancel',
                action: () => this.close(),
                key: Clutter.KEY_Escape,
            },
            {
                label: 'Primary display only',
                action: () => this._select(false),
            },
            {
                label: 'All displays',
                action: () => this._select(true),
                default: settings.get_boolean('taskbars-all-displays'),
            },
        ]);
    }

    _select(allDisplays) {
        this._settings.set_boolean('taskbars-all-displays', allDisplays);
        this.close();
    }
});

class TaskContextMenu {
    constructor(source, window) {
        this._window = window;
        this.menu = new PopupMenu.PopupMenu(source, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(this.menu.actor);
        this.menu.actor.hide();
        this._manager = new PopupMenu.PopupMenuManager(source);
        this._manager.addMenu(this.menu);
        this._build();
    }

    _build() {
        const close = new PopupMenu.PopupMenuItem('Close');
        close.setSensitive(this._window.can_close());
        close.connect('activate', () => {
            if (this._window.can_close())
                this._window.delete(global.get_current_time());
        });
        this.menu.addMenuItem(close);

        const forceKill = new PopupMenu.PopupMenuItem('Force Kill');
        forceKill.label.add_style_class_name('gnozzard-destructive-text');
        forceKill.connect('activate', () => this._window.kill());
        this.menu.addMenuItem(forceKill);
    }

    open() {
        this.menu.open(true);
    }

    destroy() {
        this.menu.destroy();
        this._manager = null;
    }
}

class TaskButton {
    constructor(window, onChanged, onReorder) {
        this.window = window;
        this._onReorder = onReorder;
        this._signals = new SignalStore();
        this.actor = new St.Button({
            style_class: 'gnozzard-task-button',
            can_focus: true,
            reactive: true,
            x_expand: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        });
        this.actor._delegate = this;
        this._content = new St.BoxLayout({style_class: 'gnozzard-task-content'});
        this._icon = this._windowIcon();
        this._content.add_child(this._icon);
        this._label = new St.Label({
            text: window.get_title() || 'Application',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._content.add_child(this._label);
        this.actor.set_child(this._content);
        this._context = null;
        this.actor.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 3)
                return Clutter.EVENT_PROPAGATE;
            this._context ??= new TaskContextMenu(this.actor, this.window);
            this._context.open();
            return Clutter.EVENT_STOP;
        });
        this.actor.connect('clicked', () => this._activateOrMinimise());
        this._draggable = DND.makeDraggable(this.actor, {
            timeoutThreshold: 180,
            restoreOnSuccess: true,
            dragActorOpacity: 220,
        });
        this._signals.connect(window, 'notify::title', () => {
            const title = window.get_title() || 'Application';
            this._label.set_text(title);
            // DING maps its desktop surface before adding the @! marker used
            // to identify that surface. Remove the temporary task immediately.
            if (title.startsWith('@!'))
                onChanged();
        });
        this._signals.connect(window, 'notify::minimized', () => this.updateState());
        this._signals.connect(window, 'unmanaged', onChanged);
        this._iconRetryCount = 0;
        this._iconRetry = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            const resolved = this.refreshIcon();
            this._iconRetryCount++;
            if (resolved || this._iconRetryCount >= 8) {
                this._iconRetry = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
        this.updateState();
    }

    getDragActor() {
        return new Clutter.Clone({source: this.actor});
    }

    getDragActorSource() {
        return this.actor;
    }

    handleDragOver(source) {
        if (!(source instanceof TaskButton) || source === this)
            return DND.DragMotionResult.NO_DROP;
        return DND.DragMotionResult.MOVE_DROP;
    }

    acceptDrop(source, _actor, x) {
        if (!(source instanceof TaskButton) || source === this)
            return false;
        this._onReorder(source, this, x >= this.actor.width / 2);
        return true;
    }

    _windowApp() {
        const tracked = Shell.WindowTracker.get_default().get_window_app(this.window);
        if (!tracked || tracked.is_window_backed())
            return managedAppForWindow(this.window) ?? tracked;
        return tracked;
    }

    _windowIcon() {
        const app = this._windowApp();
        return app?.create_icon_texture(20) ?? new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: 20,
        });
    }

    refreshIcon() {
        const app = this._windowApp();
        const resolved = app !== null && !app.is_window_backed();
        const replacement = app?.create_icon_texture(20) ?? new St.Icon({
            icon_name: 'application-x-executable-symbolic',
            icon_size: 20,
        });
        this._content.insert_child_at_index(replacement, 0);
        this._icon.destroy();
        this._icon = replacement;
        return resolved;
    }

    _activateOrMinimise() {
        const focused = global.display.focus_window === this.window;
        if (focused && !this.window.minimized) {
            this.window.minimize();
            return;
        }
        if (this.window.minimized)
            this.window.unminimize();
        this.window.activate(global.get_current_time());
    }

    updateState() {
        if (global.display.focus_window === this.window)
            this.actor.add_style_class_name('focused');
        else
            this.actor.remove_style_class_name('focused');
        this.actor.opacity = this.window.minimized ? 150 : 255;
    }

    destroy() {
        if (this._iconRetry)
            GLib.source_remove(this._iconRetry);
        this._iconRetry = 0;
        this._context?.destroy();
        this._draggable = null;
        this._signals.clear();
        this.actor.destroy();
    }
}

class ClassicPanel {
    constructor(settings, monitorIndex, sharedState, onWindowsChanged, onOrderChanged) {
        this._settings = settings;
        this._monitorIndex = monitorIndex;
        this._sharedState = sharedState;
        this._onWindowsChanged = onWindowsChanged;
        this._onOrderChanged = onOrderChanged;
        this._signals = new SignalStore();
        this._tasks = [];
        this._desktopWindows = sharedState.desktopWindows;
        this.actor = new St.BoxLayout({
            style_class: 'gnozzard-panel',
            reactive: true,
            height: PANEL_HEIGHT,
        });
        this.applicationsButton = new St.Button({
            style_class: 'gnozzard-applications-button',
            label: 'Applications',
            can_focus: true,
        });
        this.actor.add_child(this.applicationsButton);
        this._taskBox = new St.BoxLayout({x_expand: true});
        this.actor.add_child(this._taskBox);
        this._showDesktop = new St.Button({
            style_class: 'gnozzard-show-desktop',
            accessible_name: 'Show Desktop',
            can_focus: true,
        });
        this.actor.add_child(this._showDesktop);
        this._menu = new ApplicationsMenu(settings, this, monitorIndex);
        this.applicationsButton.connect('clicked', () => this._menu.toggle());
        this._showDesktop.connect('clicked', () => this._toggleDesktop());

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this._signals.connect(settings, 'changed::panel-color', () => this._updateColour());
        this._signals.connect(settings, 'changed::capped-task-buttons', () =>
            this._updateTaskWidths());
        this._signals.connect(this._taskBox, 'notify::width', () =>
            this._updateTaskWidths());
        this._updateColour();
        this.relayout();
        this._refreshTasks();
    }

    _updateColour() {
        const colour = this._settings.get_string('panel-color');
        this.actor.set_style(`background-color: ${colour};`);
        Main.panel?.set_style(`background-color: ${colour};`);
    }

    _eligibleWindows() {
        const active = global.workspace_manager.get_active_workspace();
        const eligible = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, active)
            .filter(window => !window.skip_taskbar &&
                window.get_window_type() !== Meta.WindowType.DESKTOP &&
                !(window.get_title() ?? '').startsWith('@!'))
            .sort((a, b) => a.get_stable_sequence() - b.get_stable_sequence());
        const available = new Set(eligible);
        const ordered = this._sharedState.windowOrder
            .filter(window => available.has(window));
        for (const window of eligible) {
            if (!ordered.includes(window))
                ordered.push(window);
        }
        this._sharedState.windowOrder.splice(0, this._sharedState.windowOrder.length,
            ...ordered);
        return ordered;
    }

    _refreshTasks() {
        for (const task of this._tasks)
            task.destroy();
        this._tasks = [];
        this._taskBox.destroy_all_children();
        for (const window of this._eligibleWindows()) {
            const task = new TaskButton(
                window,
                () => this._onWindowsChanged(),
                (source, target, after) => this._reorderTask(source, target, after)
            );
            this._tasks.push(task);
            this._taskBox.add_child(task.actor);
        }
        this._updateTaskWidths();
        this._updateFocus();
    }

    _updateTaskWidths() {
        const capped = this._settings.get_boolean('capped-task-buttons');
        this._taskBox.layout_manager.homogeneous = !capped;
        if (!capped) {
            for (const task of this._tasks) {
                task.actor.set_x_expand(true);
                task.actor.set_width(-1);
            }
            return;
        }

        const count = this._tasks.length;
        if (count === 0)
            return;
        const available = Math.max(1, this._taskBox.width);
        const width = Math.max(1, Math.min(
            CAPPED_TASK_BUTTON_WIDTH,
            Math.floor(available / count)
        ));
        for (const task of this._tasks) {
            task.actor.set_x_expand(false);
            task.actor.set_width(width);
        }
    }

    _reorderTask(source, target, after) {
        const localSource = this._tasks.find(task => task.window === source.window);
        const sourceIndex = this._tasks.indexOf(localSource);
        if (sourceIndex < 0 || !this._tasks.includes(target))
            return;

        this._tasks.splice(sourceIndex, 1);
        const targetIndex = this._tasks.indexOf(target);
        const newIndex = targetIndex + (after ? 1 : 0);
        this._tasks.splice(newIndex, 0, localSource);
        this._taskBox.set_child_at_index(localSource.actor, newIndex);
        this._sharedState.windowOrder.splice(0, this._sharedState.windowOrder.length,
            ...this._tasks.map(task => task.window));
        this._onOrderChanged(this);
    }

    _updateFocus() {
        for (const task of this._tasks)
            task.updateState();
    }

    _toggleDesktop() {
        const restorable = [...this._desktopWindows].filter(window =>
            this._tasks.some(task => task.window === window) && window.minimized);
        if (restorable.length > 0) {
            for (const window of restorable)
                window.unminimize();
            restorable.at(-1)?.activate(global.get_current_time());
            this._desktopWindows.clear();
            return;
        }
        this._desktopWindows.clear();
        for (const task of this._tasks) {
            if (!task.window.minimized) {
                this._desktopWindows.add(task.window);
                task.window.minimize();
            }
        }
    }

    relayout() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        this.actor.set_position(monitor.x, monitor.y + monitor.height - PANEL_HEIGHT);
        this.actor.set_size(monitor.width, PANEL_HEIGHT);
        this._menu.relayout();
    }

    toggleApplications() {
        this._menu.toggle();
    }

    refreshTasks() {
        this._refreshTasks();
    }

    updateFocus() {
        this._updateFocus();
    }

    updateIcons() {
        for (const task of this._tasks)
            task.refreshIcon();
    }

    get monitorIndex() {
        return this._monitorIndex;
    }

    destroy() {
        this._menu.destroy();
        for (const task of this._tasks)
            task.destroy();
        this._tasks = [];
        this._signals.clear();
        Main.layoutManager.removeChrome(this.actor);
        this.actor.destroy();
    }
}

class ResourcesButton {
    constructor() {
        this.actor = new St.Button({
            style_class: 'panel-button gnozzard-resources-button',
            reactive: true,
            can_focus: true,
            accessible_name: 'Open Resources',
        });
        const content = new St.BoxLayout({style_class: 'gnozzard-resources-content'});
        content.add_child(new St.Icon({
            icon_name: 'net.nokyan.Resources-symbolic',
            icon_size: 16,
        }));
        content.add_child(new St.Label({
            text: 'Resources',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.actor.set_child(content);
        this.actor.connect('clicked', () => {
            const app = Shell.AppSystem.get_default().lookup_app('net.nokyan.Resources.desktop');
            if (app)
                app.activate();
            else
                Main.notifyError('Gnozzard', 'Resources is not installed correctly.');
        });
        Main.panel._leftBox.insert_child_at_index(this.actor, 0);
    }

    destroy() {
        this.actor.destroy();
    }
}

export default class GnozzardExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._signals = new SignalStore();
        this._previousTopPanelStyle = Main.panel?.get_style() ?? null;
        Main.panel?.add_style_class_name('gnozzard-top-panel');
        this._panelState = {
            windowOrder: [],
            desktopWindows: new Set(),
        };
        this._panels = [];
        this._applyClassicSettings();
        this._rebuildPanels();
        Main.wm.addKeybinding(
            'toggle-applications',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._primaryPanel()?.toggleApplications()
        );
        this._signals.connect(global.display, 'window-created', () =>
            this._refreshPanels());
        this._signals.connect(global.display, 'notify::focus-window', () =>
            this._updatePanelsFocus());
        this._signals.connect(Shell.WindowTracker.get_default(), 'tracked-windows-changed', () =>
            this._updatePanelIcons());
        this._signals.connect(global.window_manager, 'switch-workspace', () =>
            this._refreshPanels());
        this._signals.connect(Main.layoutManager, 'monitors-changed', () =>
            this._rebuildPanels());
        this._signals.connect(this._settings, 'changed::force-single-workspace', () =>
            this._applyWorkspaceSetting());
        this._signals.connect(this._settings, 'changed::show-resources-button', () =>
            this._syncResourcesButton());
        this._signals.connect(this._settings, 'changed::taskbars-all-displays', () =>
            this._rebuildPanels());
        this._syncResourcesButton();
    }

    _rebuildPanels() {
        for (const panel of this._panels)
            panel.destroy();
        const primaryIndex = Math.max(0, Main.layoutManager.monitors
            .indexOf(Main.layoutManager.primaryMonitor));
        const monitorIndexes = this._settings.get_boolean('taskbars-all-displays')
            ? Main.layoutManager.monitors.map((_monitor, index) => index)
            : [primaryIndex];
        this._panels = monitorIndexes.map(index =>
            new ClassicPanel(
                this._settings,
                index,
                this._panelState,
                () => this._refreshPanels(),
                source => this._syncPanelOrder(source)
            ));
    }

    _primaryPanel() {
        const index = Main.layoutManager.monitors
            .indexOf(Main.layoutManager.primaryMonitor);
        return this._panels.find(panel => panel.monitorIndex === index) ??
            this._panels[0] ?? null;
    }

    _refreshPanels() {
        for (const panel of this._panels)
            panel.refreshTasks();
    }

    _updatePanelsFocus() {
        for (const panel of this._panels)
            panel.updateFocus();
    }

    _updatePanelIcons() {
        for (const panel of this._panels)
            panel.updateIcons();
    }

    _syncPanelOrder(source) {
        for (const panel of this._panels) {
            if (panel !== source)
                panel.refreshTasks();
        }
    }

    _schema(id) {
        return new Gio.Settings({schema_id: id});
    }

    _applyClassicSettings() {
        const mutter = this._schema('org.gnome.mutter');
        const wm = this._schema('org.gnome.desktop.wm.preferences');
        const desktop = this._schema('org.gnome.desktop.interface');
        const background = this._schema('org.gnome.desktop.background');
        if (!this._settings.get_boolean('settings-owned')) {
            this._settings.set_boolean('previous-dynamic-workspaces',
                mutter.get_boolean('dynamic-workspaces'));
            this._settings.set_int('previous-num-workspaces', wm.get_int('num-workspaces'));
            this._settings.set_boolean('previous-hot-corners',
                desktop.get_boolean('enable-hot-corners'));
            this._settings.set_string('previous-button-layout', wm.get_string('button-layout'));
            this._settings.set_string('previous-overlay-key', mutter.get_string('overlay-key'));
            this._settings.set_boolean('settings-owned', true);
        }
        desktop.set_boolean('enable-hot-corners', false);
        desktop.set_string('accent-color', 'orange');
        desktop.set_string('color-scheme', 'prefer-dark');
        desktop.set_string('icon-theme', 'Gnozzard');
        wm.set_string('button-layout', ':minimize,maximize,close');
        mutter.set_string('overlay-key', '');
        background.set_string('picture-uri', '');
        background.set_string('picture-uri-dark', '');
        background.set_string('color-shading-type', 'solid');
        background.set_string('primary-color', '#202225');
        background.set_string('secondary-color', '#202225');
        this._applyLockBackground();
        this._applyWorkspaceSetting();
    }

    _applyLockBackground() {
        const lock = this._schema('org.gnome.desktop.screensaver');
        if (!this._settings.get_boolean('lock-settings-owned')) {
            this._settings.set_string('previous-lock-picture-uri',
                lock.get_string('picture-uri'));
            this._settings.set_string('previous-lock-picture-options',
                lock.get_string('picture-options'));
            this._settings.set_string('previous-lock-color-shading-type',
                lock.get_string('color-shading-type'));
            this._settings.set_string('previous-lock-primary-color',
                lock.get_string('primary-color'));
            this._settings.set_string('previous-lock-secondary-color',
                lock.get_string('secondary-color'));
            this._settings.set_boolean('lock-settings-owned', true);
        }
        lock.set_string('picture-uri', '');
        lock.set_string('picture-options', 'none');
        lock.set_string('color-shading-type', 'solid');
        lock.set_string('primary-color', '#202225');
        lock.set_string('secondary-color', '#202225');
    }

    _restoreLockBackground() {
        if (!this._settings?.get_boolean('lock-settings-owned'))
            return;
        const lock = this._schema('org.gnome.desktop.screensaver');
        lock.set_string('picture-uri',
            this._settings.get_string('previous-lock-picture-uri'));
        lock.set_string('picture-options',
            this._settings.get_string('previous-lock-picture-options'));
        lock.set_string('color-shading-type',
            this._settings.get_string('previous-lock-color-shading-type'));
        lock.set_string('primary-color',
            this._settings.get_string('previous-lock-primary-color'));
        lock.set_string('secondary-color',
            this._settings.get_string('previous-lock-secondary-color'));
        this._settings.set_boolean('lock-settings-owned', false);
    }

    _applyWorkspaceSetting() {
        const mutter = this._schema('org.gnome.mutter');
        const wm = this._schema('org.gnome.desktop.wm.preferences');
        if (this._settings.get_boolean('force-single-workspace')) {
            mutter.set_boolean('dynamic-workspaces', false);
            wm.set_int('num-workspaces', 1);
        } else if (this._settings.get_boolean('settings-owned')) {
            mutter.set_boolean('dynamic-workspaces',
                this._settings.get_boolean('previous-dynamic-workspaces'));
            wm.set_int('num-workspaces',
                this._settings.get_int('previous-num-workspaces'));
        }
    }

    _syncResourcesButton() {
        this._resourcesButton?.destroy();
        this._resourcesButton = null;
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = !this._settings.get_boolean('show-resources-button');
        if (this._settings.get_boolean('show-resources-button'))
            this._resourcesButton = new ResourcesButton();
    }

    _restoreSettings() {
        this._restoreLockBackground();
        if (!this._settings?.get_boolean('settings-owned'))
            return;
        const mutter = this._schema('org.gnome.mutter');
        const wm = this._schema('org.gnome.desktop.wm.preferences');
        const desktop = this._schema('org.gnome.desktop.interface');
        mutter.set_boolean('dynamic-workspaces',
            this._settings.get_boolean('previous-dynamic-workspaces'));
        wm.set_int('num-workspaces', this._settings.get_int('previous-num-workspaces'));
        desktop.set_boolean('enable-hot-corners',
            this._settings.get_boolean('previous-hot-corners'));
        wm.set_string('button-layout', this._settings.get_string('previous-button-layout'));
        mutter.set_string('overlay-key', this._settings.get_string('previous-overlay-key'));
        this._settings.set_boolean('settings-owned', false);
    }

    disable() {
        Main.wm.removeKeybinding('toggle-applications');
        this._signals?.clear();
        for (const panel of this._panels ?? [])
            panel.destroy();
        this._panels = [];
        this._panelState = null;
        if (Main.panel) {
            Main.panel.remove_style_class_name('gnozzard-top-panel');
            Main.panel.set_style(this._previousTopPanelStyle);
        }
        this._previousTopPanelStyle = null;
        this._resourcesButton?.destroy();
        this._resourcesButton = null;
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = true;
        this._restoreSettings();
        this._settings = null;
    }
}
