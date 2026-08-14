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

    def test_capped_task_buttons_are_optional_and_responsive(self):
        source = (
            ROOT / "extension/gnozzard@openresearchtools/extension.js"
        ).read_text()
        schema = (
            ROOT
            / "extension/gnozzard@openresearchtools/schemas/"
            "org.openresearchtools.gnozzard.gschema.xml"
        ).read_text()
        self.assertIn('name="capped-task-buttons"', schema)
        self.assertIn("<default>false</default>", schema)
        self.assertIn("Capped task buttons", source)
        self.assertIn("Math.floor(available / count)", source)
        self.assertIn("CAPPED_TASK_BUTTON_WIDTH", source)

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
