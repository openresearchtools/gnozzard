import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ExtensionPackagingTests(unittest.TestCase):
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
        install = (ROOT / "debian/install").read_text()
        self.assertIn("com.openresearchtools.GnozzardSettings.desktop", source)
        self.assertIn("\nName=Gnozzard\n", desktop_entry)
        self.assertNotIn("Name=Gnozzard Settings", desktop_entry)
        self.assertIn('title="Gnozzard"', settings_app)
        self.assertIn('GNOZZARD_UUID = "gnozzard@openresearchtools"', settings_app)
        self.assertIn('DESKTOP_UUID = "ding@rastersoft.com"', settings_app)
        self.assertIn('TRAY_UUID = "ubuntu-appindicators@ubuntu.com"', settings_app)
        self.assertIn("Turn off Gnozzard?", settings_app)
        self.assertIn("session-initialized", settings_app)
        self.assertIn("data/gnozzard-settings usr/bin/", install)

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
            self.assertTrue(
                (root / "state/gnozzard/session-initialized").is_file()
            )

            subprocess.run([str(script)], env=environment, check=True)
            second_run = log.read_text()
            self.assertEqual(
                second_run.count(
                    "gnome-extensions enable gnozzard@openresearchtools"
                ),
                1,
            )


if __name__ == "__main__":
    unittest.main()
