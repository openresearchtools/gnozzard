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
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PANEL_HEIGHT = 40;
const MENU_WIDTH_RATIO = 0.28;
const MENU_MIN_WIDTH = 320;
const MENU_MAX_WIDTH = 480;
const CAPPED_TASK_BUTTON_WIDTH = 260;
const MIN_TASK_BUTTON_WIDTH = 96;
const TASK_PAGE_STEP = 5;
const TASK_PAGE_BUTTON_WIDTH = 28;
const RESOURCES_BUTTON_NAME = 'gnozzardResourcesButton';
function stopEvent() {
    return Clutter.EVENT_STOP;
}

function launchGraphicalCommand(commandArguments, name) {
    const commandLine = commandArguments
        .map(argument => GLib.shell_quote(argument)).join(' ');
    const appInfo = Gio.AppInfo.create_from_commandline(
        commandLine,
        name,
        Gio.AppInfoCreateFlags.SUPPORTS_STARTUP_NOTIFICATION
    );
    const context = global.create_app_launch_context(global.get_current_time(), -1);
    appInfo.launch([], context);
}

function removeResourcesButtons() {
    for (const child of Main.panel?._leftBox?.get_children() ?? []) {
        const isGnozzardButton = child.get_name?.() === RESOURCES_BUTTON_NAME ||
            child.has_style_class_name?.('gnozzard-resources-button');
        if (isGnozzardButton)
            child.destroy();
    }
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

        const isAppImage = desktopId.startsWith('gnozzard-appimage-');
        const isDesktopLauncher = desktopId.startsWith('gnozzard-launcher-');
        if (isAppImage) {
            const appImagePath = this._app.get_app_info()?.get_string('X-AppImage-Path');
            if (appImagePath) {
                const extractAndRun = new PopupMenu.PopupMenuItem('Extract and Run');
                extractAndRun.connect('activate', () => {
                    this._refresh(true);
                    try {
                        launchGraphicalCommand(
                            ['/usr/libexec/gnozzard', 'extract-and-run', appImagePath],
                            'Gnozzard AppImage'
                        );
                    } catch (error) {
                        logError(error, `Could not extract and run ${desktopId}`);
                    }
                });
                this.menu.addMenuItem(extractAndRun);

                const extractAndRunNoSandbox = new PopupMenu.PopupMenuItem(
                    'Extract and Run --no-sandbox');
                extractAndRunNoSandbox.connect('activate', () => {
                    this._refresh(true);
                    try {
                        launchGraphicalCommand(
                            [
                                '/usr/libexec/gnozzard',
                                'extract-and-run-no-sandbox',
                                appImagePath,
                            ],
                            'Gnozzard AppImage'
                        );
                    } catch (error) {
                        logError(error,
                            `Could not extract and run ${desktopId} without sandboxing`);
                    }
                });
                this.menu.addMenuItem(extractAndRunNoSandbox);
            }
        }

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
            accessible_name: 'Open Gnozzard',
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
            const app = Shell.AppSystem.get_default()
                .lookup_app('com.openresearchtools.GnozzardSettings.desktop');
            if (app)
                app.activate();
            else
                Main.notifyError('Gnozzard', 'The Gnozzard app is not installed correctly.');
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
    constructor(window, onChanged, onReorder, fixedWidth = null) {
        this.window = window;
        this._onReorder = onReorder;
        this._signals = new SignalStore();
        const actorProperties = {
            style_class: 'gnozzard-task-button',
            can_focus: true,
            reactive: true,
            x_expand: fixedWidth === null,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.THREE,
        };
        if (fixedWidth !== null) {
            actorProperties.min_width = fixedWidth;
            actorProperties.min_width_set = true;
            actorProperties.natural_width = fixedWidth;
            actorProperties.natural_width_set = true;
        }
        this.actor = new St.Button(actorProperties);
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
        this._taskOffset = 0;
        this._taskCapacity = 0;
        this._taskWindowCount = 0;
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
        this._taskNavigation = new St.BoxLayout({
            style_class: 'gnozzard-task-navigation',
            visible: false,
        });
        this._taskPrevious = this._createTaskPageButton('<', 'Previous 5 windows');
        this._taskNext = this._createTaskPageButton('>', 'Next 5 windows');
        this._taskNavigation.add_child(this._taskPrevious);
        this._taskNavigation.add_child(this._taskNext);
        this.actor.add_child(this._taskNavigation);
        this._taskBox = new St.BoxLayout({x_expand: true});
        this._taskBox.layout_manager.homogeneous =
            !settings.get_boolean('capped-task-buttons');
        this.actor.add_child(this._taskBox);
        this._showDesktop = new St.Button({
            style_class: 'gnozzard-show-desktop',
            accessible_name: 'Show Desktop',
            can_focus: true,
        });
        this.actor.add_child(this._showDesktop);
        this._menu = new ApplicationsMenu(settings, this, monitorIndex);
        this.applicationsButton.connect('clicked', () => this._menu.toggle());
        this._taskPrevious.connect('clicked', () => this._moveTaskPage(-TASK_PAGE_STEP));
        this._taskNext.connect('clicked', () => this._moveTaskPage(TASK_PAGE_STEP));
        this._showDesktop.connect('clicked', () => this._toggleDesktop());

        Main.layoutManager.addChrome(this.actor, {
            affectsStruts: true,
            trackFullscreen: true,
        });
        this._signals.connect(settings, 'changed::panel-color', () => this._updateColour());
        this._updateColour();
        this.relayout();
        this._refreshTasks();
    }

    _createTaskPageButton(label, accessibleName) {
        return new St.Button({
            style_class: 'gnozzard-task-page-button',
            label,
            accessible_name: accessibleName,
            can_focus: true,
            reactive: true,
            min_width: TASK_PAGE_BUTTON_WIDTH,
            min_width_set: true,
            natural_width: TASK_PAGE_BUTTON_WIDTH,
            natural_width_set: true,
        });
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
                !(window.get_title() ?? '').startsWith('@!') &&
                !(window.get_title() ?? '').startsWith('Desktop Icons '))
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
        const windows = this._eligibleWindows();
        const layout = this._taskLayout(windows);
        for (const window of layout.windows) {
            const task = new TaskButton(
                window,
                () => this._onWindowsChanged(),
                (source, target, after) => this._reorderTask(source, target, after),
                layout.taskWidth
            );
            this._tasks.push(task);
            this._taskBox.add_child(task.actor);
        }
        this._updateFocus();
    }

    _taskLayout(windows) {
        const count = windows.length;
        this._taskWindowCount = count;
        if (!this._settings.get_boolean('capped-task-buttons') || count === 0) {
            this._taskOffset = 0;
            this._taskCapacity = count;
            this._taskNavigation.hide();
            return {windows, taskWidth: null};
        }
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor) {
            this._taskOffset = 0;
            this._taskCapacity = count;
            this._taskNavigation.hide();
            return {windows, taskWidth: CAPPED_TASK_BUTTON_WIDTH};
        }
        const [, applicationsWidth] = this.applicationsButton.get_preferred_width(-1);
        const [, desktopWidth] = this._showDesktop.get_preferred_width(-1);
        const availableWithoutNavigation = Math.max(MIN_TASK_BUTTON_WIDTH,
            monitor.width - applicationsWidth - desktopWidth);
        const overflow = count * MIN_TASK_BUTTON_WIDTH > availableWithoutNavigation;
        const available = Math.max(MIN_TASK_BUTTON_WIDTH,
            availableWithoutNavigation - (overflow ? TASK_PAGE_BUTTON_WIDTH * 2 : 0));
        const capacity = overflow
            ? Math.max(1, Math.floor(available / MIN_TASK_BUTTON_WIDTH))
            : count;
        const maxOffset = Math.max(0, count - capacity);
        this._taskOffset = Math.min(this._taskOffset, maxOffset);
        this._taskCapacity = capacity;
        this._taskNavigation.visible = overflow;
        this._updateTaskPageButtons();
        const visibleWindows = overflow
            ? windows.slice(this._taskOffset, this._taskOffset + capacity)
            : windows;
        const taskWidth = Math.max(MIN_TASK_BUTTON_WIDTH, Math.min(
            CAPPED_TASK_BUTTON_WIDTH,
            Math.floor(available / visibleWindows.length)
        ));
        return {windows: visibleWindows, taskWidth};
    }

    _moveTaskPage(delta) {
        const maxOffset = Math.max(0, this._taskWindowCount - this._taskCapacity);
        const nextOffset = Math.max(0, Math.min(maxOffset, this._taskOffset + delta));
        if (nextOffset === this._taskOffset)
            return;
        this._taskOffset = nextOffset;
        this._refreshTasks();
    }

    _updateTaskPageButtons() {
        const maxOffset = Math.max(0, this._taskWindowCount - this._taskCapacity);
        this._setTaskPageButtonEnabled(this._taskPrevious, this._taskOffset > 0);
        this._setTaskPageButtonEnabled(this._taskNext, this._taskOffset < maxOffset);
    }

    _setTaskPageButtonEnabled(button, enabled) {
        button.reactive = enabled;
        button.can_focus = enabled;
        button.opacity = enabled ? 255 : 90;
    }

    _reorderTask(source, target, after) {
        const order = this._sharedState.windowOrder;
        const sourceIndex = order.indexOf(source.window);
        if (sourceIndex < 0 || !order.includes(target.window))
            return;
        const [window] = order.splice(sourceIndex, 1);
        const targetIndex = order.indexOf(target.window);
        order.splice(targetIndex + (after ? 1 : 0), 0, window);
        this._refreshTasks();
        this._onOrderChanged(this);
    }

    _updateFocus() {
        for (const task of this._tasks)
            task.updateState();
    }

    _toggleDesktop() {
        const windows = this._eligibleWindows();
        const restorable = [...this._desktopWindows].filter(window =>
            windows.includes(window) && window.minimized);
        if (restorable.length > 0) {
            for (const window of restorable)
                window.unminimize();
            restorable.at(-1)?.activate(global.get_current_time());
            this._desktopWindows.clear();
            return;
        }
        this._desktopWindows.clear();
        for (const window of windows) {
            if (!window.minimized) {
                this._desktopWindows.add(window);
                window.minimize();
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
            name: RESOURCES_BUTTON_NAME,
            style_class: 'panel-button gnozzard-resources-button',
            reactive: true,
            can_focus: true,
            accessible_name: 'Open Resources',
        });
        const content = new St.BoxLayout({style_class: 'gnozzard-resources-content'});
        content.add_child(new St.Icon({
            icon_name: 'org.openresearchtools.GnozzardResources-symbolic',
            icon_size: 16,
        }));
        content.add_child(new St.Label({
            text: 'Resources',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.actor.set_child(content);
        this.actor.connect('clicked', () => {
            const app = Shell.AppSystem.get_default().lookup_app(
                'org.openresearchtools.GnozzardResources.desktop');
            if (app)
                app.activate();
            else
                Main.notifyError('Gnozzard', 'Resources is not installed correctly.');
        });
        Main.panel._leftBox.insert_child_at_index(this.actor, 0);
    }

    destroy() {
        if (this.actor?.get_parent())
            this.actor.destroy();
        this.actor = null;
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
        this._refreshSource = 0;
        this._applyClassicSettings();
        this._rebuildPanels();
        Main.wm.addKeybinding(
            'toggle-applications',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._primaryPanel()?.toggleApplications()
        );
        this._signals.connect(global.display, 'window-created', (_display, window) =>
            this._watchWindow(window));
        for (const actor of global.get_window_actors())
            this._watchWindow(actor.meta_window);
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
        this._signals.connect(this._settings, 'changed::capped-task-buttons', () =>
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

    _watchWindow(window) {
        if (!window)
            return;
        this._signals.connect(window, 'notify::skip-taskbar', () =>
            this._schedulePanelRefresh());
        this._schedulePanelRefresh();
    }

    _schedulePanelRefresh() {
        if (this._refreshSource)
            return;
        this._refreshSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._refreshSource = 0;
            this._refreshPanels();
            return GLib.SOURCE_REMOVE;
        });
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
        const shellKeybindings = this._schema('org.gnome.shell.keybindings');
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
        if (desktop.settings_schema.has_key('accent-color'))
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
        if (shellKeybindings.settings_schema.has_key('toggle-application-view')) {
            if (!this._settings.get_boolean('application-view-keybinding-owned')) {
                this._settings.set_strv('previous-application-view-keybinding',
                    shellKeybindings.get_strv('toggle-application-view'));
                this._settings.set_boolean('application-view-keybinding-owned', true);
            }
            shellKeybindings.set_strv('toggle-application-view', []);
        }
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
        removeResourcesButtons();
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = !this._settings.get_boolean('show-resources-button');
        if (this._settings.get_boolean('show-resources-button'))
            this._resourcesButton = new ResourcesButton();
    }

    _restoreSettings() {
        this._restoreLockBackground();
        const shellKeybindings = this._schema('org.gnome.shell.keybindings');
        if (this._settings?.get_boolean('application-view-keybinding-owned') &&
            shellKeybindings.settings_schema.has_key('toggle-application-view')) {
            shellKeybindings.set_strv('toggle-application-view',
                this._settings.get_strv('previous-application-view-keybinding'));
            this._settings.set_boolean('application-view-keybinding-owned', false);
        }
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
        if (this._refreshSource)
            GLib.source_remove(this._refreshSource);
        this._refreshSource = 0;
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
        removeResourcesButtons();
        const activities = Main.panel.statusArea.activities?.container ??
            Main.panel.statusArea.activities;
        if (activities)
            activities.visible = true;
        this._restoreSettings();
        this._settings = null;
    }
}
