import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ExtensionPackagingTests(unittest.TestCase):
    def test_supported_shell_and_libadwaita_versions_cover_target_desktops(self):
        metadata = (
            ROOT / "extension/gnozzard@openresearchtools/metadata.json"
        ).read_text()
        control = (ROOT / "debian/control").read_text()
        cargo = (ROOT / "third_party/resources/Cargo.toml").read_text()
        meson = (ROOT / "third_party/resources/meson.build").read_text()
        self.assertIn('"shell-version": ["46", "47", "48", "49", "50"]', metadata)
        self.assertIn(" gnome-shell (>= 46),", control)
        self.assertIn(" gnome-shell (<< 51),", control)
        self.assertIn(" libadwaita-1-dev (>= 1.5)", control)
        self.assertIn('features = ["v1_5"]', cargo)
        self.assertIn("dependency('libadwaita-1', version: '>= 1.5.0')", meson)

    def test_gnome_46_missing_accent_key_is_feature_detected(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        self.assertIn("settings_schema.has_key('accent-color')", source)
        self.assertIn("desktop.set_string('accent-color', 'orange')", source)

    def test_native_application_view_binding_is_restored_on_disable(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        schema = (
            ROOT
            / "extension/gnozzard@openresearchtools/schemas/"
            "org.openresearchtools.gnozzard.gschema.xml"
        ).read_text()
        self.assertIn("shellKeybindings.set_strv('toggle-application-view', [])", source)
        self.assertIn("previous-application-view-keybinding", source)
        self.assertIn('name="application-view-keybinding-owned"', schema)
        self.assertIn('name="previous-application-view-keybinding"', schema)

    def test_bundled_resources_fork_coexists_with_the_stock_package(self):
        control = (ROOT / "debian/control").read_text()
        resources_meson = (ROOT / "third_party/resources/meson.build").read_text()
        resources_cargo = (ROOT / "third_party/resources/Cargo.toml").read_text()
        resources_desktop = (
            ROOT / "third_party/resources/data/net.nokyan.Resources.desktop.in.in"
        ).read_text()
        resources_schema = (
            ROOT / "third_party/resources/data/net.nokyan.Resources.gschema.xml.in"
        ).read_text()
        resources_policy = (
            ROOT / "third_party/resources/data/net.nokyan.Resources.policy.in.in"
        ).read_text()
        extension = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()

        self.assertNotIn("Provides:\n resources,\n", control)
        self.assertNotIn("Conflicts:\n resources,\n", control)
        self.assertNotIn("Replaces:\n resources,\n", control)
        self.assertIn("'gnozzard-resources'", resources_meson)
        self.assertIn("base_id = 'org.openresearchtools.GnozzardResources'", resources_meson)
        self.assertIn('name = "gnozzard-resources"', resources_cargo)
        self.assertIn("Name=Resources", resources_desktop)
        self.assertIn("Exec=gnozzard-resources", resources_desktop)
        self.assertIn("/org/openresearchtools/GnozzardResources/", resources_schema)
        self.assertIn('<action id="@app-id@.kill">', resources_policy)
        self.assertIn("org.openresearchtools.GnozzardResources.desktop", extension)
        self.assertIn("org.openresearchtools.GnozzardResources-symbolic", extension)

    def test_resources_uses_symbolic_icon_and_links_to_bundled_fork(self):
        application = (
            ROOT / "third_party/resources/src/application.rs"
        ).read_text()
        resources_meson = (
            ROOT / "third_party/resources/data/meson.build"
        ).read_text()
        resources_window = (
            ROOT / "third_party/resources/data/resources/ui/window.ui"
        ).read_text()
        resources_readme = (
            ROOT / "third_party/resources/README.md"
        ).read_text()
        symbolic_icon = (
            ROOT
            / "third_party/resources/data/icons/net.nokyan.Resources-symbolic.svg"
        ).read_text()
        self.assertIn('fill="white"', symbolic_icon)
        self.assertIn('format!("{APP_ID}-symbolic")', application)
        self.assertIn(
            'application_icon(format!("{}-symbolic", config::APP_ID))',
            application,
        )
        self.assertIn(
            "Gnozzard’s fork of Resources supporting disk usage",
            application,
        )
        self.assertIn(
            "https://github.com/openresearchtools/gnozzard/tree/main/third_party/resources",
            application,
        )
        self.assertIn(
            'developer_name(i18n(FORK_ATTRIBUTION))',
            application,
        )
        self.assertIn("make_about_attribution_clickable(&about)", application)
        self.assertIn(
            '&lt;a href="https://github.com/openresearchtools/gnozzard/tree/main/third_party/resources"&gt;Gnozzard’s fork&lt;/a&gt;',
            resources_window,
        )
        self.assertIn(
            '&lt;a href="https://github.com/nokyan/resources"&gt;Resources&lt;/a&gt;',
            resources_window,
        )
        self.assertIn("> **Gnozzard fork**", resources_readme)
        self.assertIn(
            "experimental per-process and per-application disk I/O reporting",
            resources_readme,
        )
        self.assertIn(
            "desktop_conf.set('icon', '@0@-symbolic'.format(application_id))",
            resources_meson,
        )

    def test_required_extension_tools_are_debian_dependencies(self):
        control = (ROOT / "debian/control").read_text()
        self.assertNotIn(" gnome-extensions-app,\n", control)
        self.assertIn(" gnome-shell-extension-appindicator,\n", control)
        self.assertIn(" gir1.2-gtk-4.0,\n", control)
        self.assertIn(" gir1.2-adw-1,\n", control)

    def test_native_settings_app_controls_extension_components(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        settings_app = (ROOT / "data/gnozzard-settings").read_text()
        desktop_entry = (
            ROOT / "data/com.openresearchtools.GnozzardSettings.desktop"
        ).read_text()
        install = (ROOT / "debian/gnozzard.install").read_text()
        self.assertIn("com.openresearchtools.GnozzardSettings.desktop", source)
        self.assertIn("\nName=Gnozzard\n", desktop_entry)
        self.assertNotIn("Name=Gnozzard Settings", desktop_entry)
        self.assertIn('title="Gnozzard"', settings_app)
        self.assertIn('GNOZZARD_UUID = "gnozzard@openresearchtools"', settings_app)
        self.assertIn('DESKTOP_UUID = "ding@rastersoft.com"', settings_app)
        self.assertIn('TRAY_UUID = "ubuntu-appindicators@ubuntu.com"', settings_app)
        self.assertIn("Turn off Gnozzard?", settings_app)
        self.assertIn("session-initialized", settings_app)
        self.assertIn("self._refresh_failures = 0", settings_app)
        self.assertIn("self._refresh_failures += 1", settings_app)
        self.assertIn(
            "self._refresh_failures >= 3 and self._dialog is None", settings_app
        )
        self.assertIn("data/gnozzard-settings usr/bin/", install)

    def test_appimage_context_menu_reuses_extract_and_run_helper(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        context_menu = source.split("class AppContextMenu", 1)[1].split(
            "class ApplicationRow", 1
        )[0]
        self.assertIn("new PopupMenu.PopupMenuItem('Extract and Run')", context_menu)
        self.assertIn("'Extract and Run --no-sandbox'", context_menu)
        self.assertIn("get_string('X-AppImage-Path')", context_menu)
        self.assertIn(
            "['/usr/libexec/gnozzard', 'extract-and-run', appImagePath]",
            context_menu,
        )
        self.assertIn("launchGraphicalCommand(", context_menu)
        self.assertIn("'extract-and-run-no-sandbox'", context_menu)
        self.assertIn("if (isAppImage)", context_menu)

    def test_nautilus_has_shared_explicit_no_sandbox_action(self):
        source = (ROOT / "integrations/nautilus/gnozzard.py").read_text()
        self.assertIn('label="Extract and Run --no-sandbox"', source)
        self.assertIn('self._command("extract-and-run-no-sandbox", path)', source)

    def test_appimage_context_action_uses_gnome_graphical_launch_context(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        launcher = source.split("function launchGraphicalCommand", 1)[1].split(
            "function removeResourcesButtons", 1
        )[0]
        self.assertIn("Gio.AppInfo.create_from_commandline", launcher)
        self.assertIn("global.create_app_launch_context", launcher)
        self.assertIn("appInfo.launch([], context)", launcher)

    def test_capped_mode_sizes_complete_task_buttons_without_layout_callbacks(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        schema = (
            ROOT
            / "extension/gnozzard@openresearchtools/schemas/"
            "org.openresearchtools.gnozzard.gschema.xml"
        ).read_text()
        self.assertIn('name="capped-task-buttons"', schema)
        settings_app = (ROOT / "data/gnozzard-settings").read_text()
        self.assertIn("Capped task buttons", settings_app)
        self.assertIn("actorProperties.min_width = fixedWidth", source)
        self.assertIn("actorProperties.natural_width = fixedWidth", source)
        self.assertIn("const MIN_TASK_BUTTON_WIDTH = 96", source)
        self.assertIn("const TASK_PAGE_STEP = 5", source)
        self.assertIn("Previous 5 windows", source)
        self.assertIn("Next 5 windows", source)
        self.assertIn("windows.slice(this._taskOffset", source)
        self.assertIn("count * MIN_TASK_BUTTON_WIDTH", source)
        capped_schema = schema.split('name="capped-task-buttons"', 1)[1].split(
            "</key>", 1
        )[0]
        self.assertIn("<default>true</default>", capped_schema)
        self.assertNotIn("'notify::width'", source)

    def test_capped_overflow_is_local_to_each_monitor_panel(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        classic_panel = source.split("class ClassicPanel", 1)[1].split(
            "class ResourcesButton", 1
        )[0]
        self.assertIn("this._taskOffset = 0", classic_panel)
        self.assertIn("this._monitorIndex", classic_panel)
        panel_state = source.split("this._panelState = {", 1)[1].split("};", 1)[0]
        self.assertNotIn("taskOffset", panel_state)

    def test_task_titles_stay_white_when_windows_are_minimized(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        stylesheet = (
            ROOT / "extension/gnozzard@openresearchtools/stylesheet.css"
        ).read_text()
        self.assertIn("style_class: 'gnozzard-task-label'", source)
        self.assertNotIn("opacity = this.window.minimized", source)
        task_label = stylesheet.split(".gnozzard-task-label", 1)[1].split(
            "}", 1
        )[0]
        self.assertIn("color: #ffffff;", task_label)

    def test_applications_search_is_cleared_when_menu_closes(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        applications_menu = source.split("class ApplicationsMenu", 1)[1].split(
            "class TaskContextMenu", 1
        )[0]
        close_method = applications_menu.split("    close() {", 1)[1].split(
            "    destroy() {", 1
        )[0]
        self.assertIn("this._search.set_text('')", close_method)
        self.assertIn("this._dirty = true", close_method)
        self.assertIn("GLib.source_remove(this._searchTimeout)", close_method)

    def test_github_artifacts_build_amd64_and_arm64_packages(self):
        workflow = (ROOT / ".github/workflows/build-deb.yml").read_text()
        self.assertIn("architecture: amd64", workflow)
        self.assertIn("architecture: arm64", workflow)
        self.assertIn("runner: ubuntu-24.04-arm", workflow)
        self.assertIn("runs-on: ${{ matrix.runner }}", workflow)
        self.assertIn("needs.build-context.result == 'success'", workflow)
        self.assertIn('--arch "$ARCHITECTURE"', workflow)
        self.assertIn("--env ARCHITECTURE", workflow)
        self.assertIn(
            'test "$(dpkg --print-architecture)" = "$ARCHITECTURE"', workflow
        )
        self.assertNotIn("qemu-user-static", workflow)
        self.assertIn(
            "name: gnozzard-debian-13-${{ matrix.architecture }}", workflow
        )
        self.assertIn("for architecture in amd64 arm64; do", workflow)
        self.assertIn(
            '"release-assets/${expected_package}_${architecture}.deb"', workflow
        )
        self.assertIn("for expected_package in gnozzard gnozzard-resources", workflow)
        self.assertIn(
            'grep --fixed-strings "gnozzard-resources (= $package_version)"',
            workflow,
        )
        self.assertIn('comm -12 "$main_files" "$resources_files"', workflow)
        self.assertIn(
            "test \"$(find release-assets -maxdepth 1 -type f -name '*.deb' | wc -l)\" -eq 4",
            workflow,
        )

    def test_resources_is_a_separate_version_locked_binary_package(self):
        control = (ROOT / "debian/control").read_text()
        desktop_install = (ROOT / "debian/gnozzard.install").read_text()
        resources_install = (ROOT / "debian/gnozzard-resources.install").read_text()
        resources_docs = (ROOT / "debian/gnozzard-resources.docs").read_text()

        self.assertIn("Package: gnozzard-resources", control)
        self.assertIn(" gnozzard-resources (= ${binary:Version}),", control)
        self.assertIn(" gnozzard (<< ${binary:Version})", control)
        resources_control = control.split("Package: gnozzard-resources", 1)[1]
        self.assertIn(" desktop-file-utils,", resources_control)
        self.assertIn(" libglib2.0-bin,", resources_control)
        self.assertNotIn("debian/tmp/", desktop_install)
        self.assertIn("debian/tmp/usr/bin/* usr/bin/", resources_install)
        self.assertIn(
            "data/sysctl/60-gnozzard-delayacct.conf usr/lib/sysctl.d/",
            resources_install,
        )
        self.assertIn("third_party/resources/LICENSE", resources_docs)
        self.assertTrue((ROOT / "debian/gnozzard-resources.manpages").is_file())
        self.assertTrue((ROOT / "debian/gnozzard.postinst").is_file())
        self.assertTrue((ROOT / "debian/gnozzard-resources.postinst").is_file())
        self.assertTrue((ROOT / "debian/gnozzard-resources.postrm").is_file())
        copyright_file = (ROOT / "debian/copyright").read_text()
        self.assertIn("Files: third_party/resources/*", copyright_file)
        self.assertIn("License: GPL-3+", copyright_file)

    def test_resources_button_sync_removes_stale_gnome_shell_actors(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        self.assertIn(
            "const RESOURCES_BUTTON_NAME = 'gnozzardResourcesButton'", source
        )
        self.assertIn("function removeResourcesButtons()", source)
        self.assertIn("child.has_style_class_name?.('gnozzard-resources-button')", source)
        self.assertIn("name: RESOURCES_BUTTON_NAME", source)
        sync = source.split("_syncResourcesButton() {", 1)[1].split(
            "_restoreSettings()", 1
        )[0]
        self.assertIn("removeResourcesButtons();", sync)

    def test_paginated_reorder_and_show_desktop_use_all_windows(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        self.assertIn("const order = this._sharedState.windowOrder", source)
        self.assertIn("const windows = this._eligibleWindows();", source)
        self.assertIn("for (const window of windows)", source)

    def test_session_bootstrap_enables_once_and_preserves_later_choices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            log = root / "commands.log"
            for command in ("gnome-extensions", "xdg-mime"):
                executable = fake_bin / command
                executable.write_text(
                    "#!/bin/sh\n"
                    f"printf '%s\\n' \"{command} $*\" >> \"$GNOZZARD_TEST_LOG\"\n"
                    "exit 0\n"
                )
                executable.chmod(0o755)

            environment = os.environ.copy()
            environment.update({
                "HOME": str(root / "home"),
                "XDG_STATE_HOME": str(root / "state"),
                "GNOZZARD_TEST_LOG": str(log),
                "PATH": f"{fake_bin}:/usr/bin:/bin",
            })
            script = ROOT / "data/gnozzard-session"
            subprocess.run([str(script)], env=environment, check=True)
            first_run = log.read_text()
            self.assertIn(
                "gnome-extensions enable gnozzard@openresearchtools", first_run
            )
            self.assertIn(
                "gnome-extensions enable ubuntu-appindicators@ubuntu.com", first_run
            )
            self.assertIn(
                "gnome-extensions disable ubuntu-dock@ubuntu.com", first_run
            )
            self.assertTrue(
                (root / "state/gnozzard/session-initialized").is_file()
            )
            self.assertTrue(
                (root / "state/gnozzard/ubuntu-dock-disabled").is_file()
            )

            subprocess.run([str(script)], env=environment, check=True)
            second_run = log.read_text()
            self.assertEqual(
                second_run.count(
                    "gnome-extensions enable gnozzard@openresearchtools"
                ),
                1,
            )
            self.assertEqual(
                second_run.count(
                    "gnome-extensions disable ubuntu-dock@ubuntu.com"
                ),
                1,
            )

    def test_ubuntu_24_ding_backing_window_is_not_a_task(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        self.assertIn("startsWith('Desktop Icons ')", source)
        self.assertIn("'notify::skip-taskbar'", source)
        self.assertIn("this._schedulePanelRefresh()", source)
        self.assertIn("GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250", source)


if __name__ == "__main__":
    unittest.main()
