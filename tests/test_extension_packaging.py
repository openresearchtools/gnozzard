import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ExtensionPackagingTests(unittest.TestCase):
    def test_required_extension_tools_are_debian_dependencies(self):
        control = (ROOT / "debian/control").read_text()
        self.assertIn(" gnome-extensions-app,\n", control)
        self.assertIn(" gnome-shell-extension-appindicator,\n", control)

    def test_turn_off_action_explains_reenable_path(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        self.assertIn("Turn Off Gnozzard", source)
        self.assertIn("open Extensions and enable Gnozzard", source)
        self.assertIn("'disable', EXTENSION_UUID", source)
        self.assertIn("session-initialized", source)

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
        self.assertIn("Capped task buttons", source)
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
