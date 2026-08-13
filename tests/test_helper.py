#!/usr/bin/python3

import importlib.machinery
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
loader = importlib.machinery.SourceFileLoader("gnozzard_helper", str(ROOT / "helper/gnozzard"))
spec = importlib.util.spec_from_loader(loader.name, loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)


def appimage(path: Path, marker: bytes = b"AI\x02") -> Path:
    path.write_bytes(b"\x7fELF\x02\x01\x01\x00" + marker + b"payload")
    path.chmod(0o600)
    return path


class HelperTests(unittest.TestCase):
    def test_validation_and_authorization(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = appimage(Path(temporary) / "Example.AppImage")
            self.assertEqual(helper.validate_appimage(str(path)), path)
            helper.authorize(path)
            self.assertTrue(path.stat().st_mode & stat.S_IXUSR)

    def test_extract_and_run_creates_persistent_sibling_and_runs_apprun(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = appimage(Path(temporary) / "Example.AppImage")
            arguments = type("Arguments", (), {"path": str(path)})()
            destination = path.with_name("Example.AppImage.extracted")

            def extract(command, **_kwargs):
                extracted = Path(command[command.index("-d") + 1])
                apprun = extracted / "AppRun"
                apprun.write_text("#!/bin/sh\n")
                apprun.chmod(0o700)
                return helper.subprocess.CompletedProcess(command, 0)

            with mock.patch.object(helper, "squashfs_offset", return_value=123):
                with mock.patch.object(helper.subprocess, "run", side_effect=extract):
                    with mock.patch.object(helper.os, "chdir"):
                        with mock.patch.object(helper.os, "execve") as execute:
                            helper.command_extract_and_run(arguments)
            self.assertTrue(path.stat().st_mode & stat.S_IXUSR)
            self.assertTrue(destination.is_dir())
            self.assertEqual(execute.call_args.args[0], destination / "AppRun")
            self.assertEqual(execute.call_args.args[1], [str(destination / "AppRun")])
            self.assertEqual(execute.call_args.args[2]["APPDIR"], str(destination))

    def test_extract_and_run_reuses_existing_persistent_sibling(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = appimage(Path(temporary) / "Existing.AppImage")
            destination = path.with_name("Existing.AppImage.extracted")
            destination.mkdir()
            apprun = destination / "AppRun"
            apprun.write_text("#!/bin/sh\n")
            apprun.chmod(0o700)
            arguments = type("Arguments", (), {"path": str(path)})()
            with mock.patch.object(helper.subprocess, "run") as extract:
                with mock.patch.object(helper.os, "chdir"):
                    with mock.patch.object(helper.os, "execve"):
                        helper.command_extract_and_run(arguments)
            extract.assert_not_called()

    def test_rejects_extension_only_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "Fake.AppImage"
            path.write_text("not an executable")
            with self.assertRaises(helper.UserInputError):
                helper.validate_appimage(str(path))

    def test_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = appimage(root / "target")
            link = root / "Link.AppImage"
            link.symlink_to(target)
            with self.assertRaises(helper.UserInputError):
                helper.validate_appimage(str(link))

    def test_debian_package_validation_and_privileged_install_command(self):
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / "example.deb"
            package.write_bytes(b"valid package placeholder")
            inspected = helper.subprocess.CompletedProcess(
                [], 0, "Package: example\nVersion: 1.2.3\n", ""
            )
            confirmed = helper.subprocess.CompletedProcess([], 0)
            installed = helper.subprocess.CompletedProcess([], 0)
            with mock.patch.object(
                helper.subprocess,
                "run",
                side_effect=[inspected, confirmed, installed, installed],
            ) as run:
                arguments = type("Arguments", (), {"path": str(package)})()
                helper.command_install_deb(arguments)
            self.assertEqual(
                run.call_args_list[2].args[0],
                ["pkexec", "/usr/libexec/gnozzard-deb-installer", str(package)],
            )

    def test_exec_quote_escapes_field_codes_and_shell_characters(self):
        quoted = helper.desktop_exec_quote('/tmp/100% "cash$" `tick` \\ app')
        self.assertEqual(quoted, '"/tmp/100%% \\"cash\\$\\" \\`tick\\` \\\\ app"')

    def test_registration_does_not_execute_appimage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = appimage(root / "Research Tool.AppImage")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                entry = helper.register_appimage(path)
            content = entry.read_text()
            self.assertIn("Name=Research Tool", content)
            self.assertIn("X-Gnozzard-Managed=true", content)
            self.assertIn(str(path), content)
            self.assertTrue(path.stat().st_mode & stat.S_IXUSR)

    def test_registration_uses_extracted_icon(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = appimage(root / "Icon Test.AppImage")
            icon = root / "icon.png"
            icon.write_bytes(b"PNG")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                with mock.patch.object(helper, "extract_appimage_icon", return_value=icon):
                    entry = helper.register_appimage(path)
            self.assertIn(f"Icon={icon}\n", entry.read_text())

    def test_desktop_registration_localizes_sibling_executable_and_icon(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher = root / "blender.desktop"
            launcher.write_text(
                "[Desktop Entry]\nType=Application\nName=Blender\n"
                "Exec=blender %f\nIcon=blender\nTerminal=false\n"
            )
            executable = root / "blender"
            executable.write_text("#!/bin/sh\n")
            executable.chmod(0o700)
            icon = root / "blender.svg"
            icon.write_text("<svg/>\n")
            completed = helper.subprocess.CompletedProcess([], 0, "", "")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                with mock.patch.object(helper.subprocess, "run", return_value=completed):
                    path, content = helper.validate_desktop_file(str(launcher))
                    entry = helper.register_desktop_file(path, content)
            installed = entry.read_text()
            self.assertIn(f'Exec="{executable}" %f\n', installed)
            self.assertIn(f"Icon={icon}\n", installed)
            self.assertIn(f"X-Gnozzard-Desktop-Source={launcher}\n", installed)
            self.assertTrue(launcher.exists())

    def test_desktop_launch_uses_validated_temporary_launcher(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher = root / "Tool.desktop"
            launcher.write_text(
                "[Desktop Entry]\nType=Application\nName=Tool\n"
                "Exec=/usr/bin/true\nTerminal=false\n"
            )
            arguments = type("Arguments", (), {"path": str(launcher)})()
            completed = helper.subprocess.CompletedProcess([], 0, "", "")
            with mock.patch.dict(os.environ, {"XDG_RUNTIME_DIR": str(root / "runtime")}):
                with mock.patch.object(helper.subprocess, "run", return_value=completed) as run:
                    helper.command_desktop_launch(arguments)
            self.assertTrue(
                any(call.args[0][:2] == ["gio", "launch"] for call in run.call_args_list)
            )

    def test_desktop_registration_localizes_relative_png_icon(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            icons = root / "icons"
            icons.mkdir()
            icon = icons / "tool.png"
            icon.write_bytes(b"\x89PNG\r\n\x1a\n")
            launcher = root / "Tool.desktop"
            launcher.write_text(
                "[Desktop Entry]\nType=Application\nName=Tool\n"
                "Exec=/usr/bin/true\nIcon=icons/tool.png\nTerminal=false\n"
            )
            completed = helper.subprocess.CompletedProcess([], 0, "", "")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                with mock.patch.object(helper.subprocess, "run", return_value=completed):
                    path, content = helper.validate_desktop_file(str(launcher))
                    entry = helper.register_desktop_file(path, content)
            self.assertIn(f"Icon={icon.resolve()}\n", entry.read_text())

    def test_managed_desktop_launcher_can_be_renamed_and_removed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "Original.desktop"
            source.write_text(
                "[Desktop Entry]\nType=Application\nName=Original\n"
                "Exec=/usr/bin/true\nTerminal=false\n"
            )
            completed = helper.subprocess.CompletedProcess([], 0, "", "")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                with mock.patch.object(helper.subprocess, "run", return_value=completed):
                    path, content = helper.validate_desktop_file(str(source))
                    entry = helper.register_desktop_file(path, content)
                    rename = type(
                        "Arguments", (), {"desktop_id": entry.name, "name": "Better Name"}
                    )()
                    helper.command_rename_desktop(rename)
                    self.assertIn("Name=Better Name\n", entry.read_text())
                    remove = type("Arguments", (), {"desktop_id": entry.name})()
                    helper.command_remove_desktop(remove)
            self.assertFalse(entry.exists())
            self.assertTrue(source.exists())

    def test_remove_managed_entry_keeps_appimage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = appimage(root / "Removable.AppImage")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                entry = helper.register_appimage(path)
                arguments = type("Arguments", (), {"desktop_id": entry.name})()
                helper.command_remove_appimage(arguments)
            self.assertFalse(entry.exists())
            self.assertTrue(path.exists())

    def test_remove_rejects_unmanaged_entry(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            applications = root / "data/applications"
            applications.mkdir(parents=True)
            entry = applications / "gnozzard-appimage-not-managed.desktop"
            entry.write_text("[Desktop Entry]\nType=Application\nName=Not managed\n")
            arguments = type("Arguments", (), {"desktop_id": entry.name})()
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                with self.assertRaises(helper.UserInputError):
                    helper.command_remove_appimage(arguments)
            self.assertTrue(entry.exists())

    def test_rename_changes_launcher_name_not_appimage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = appimage(root / "Long-Ugly-Version-Name.AppImage")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                entry = helper.register_appimage(path)
                arguments = type(
                    "Arguments", (), {"desktop_id": entry.name, "name": "Useful Name"}
                )()
                helper.command_rename_appimage(arguments)
            self.assertIn("Name=Useful Name\n", entry.read_text())
            self.assertTrue(path.exists())

    def test_reregister_preserves_custom_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            path = appimage(root / "Long-Versioned-Name.AppImage")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                entry = helper.register_appimage(path)
                arguments = type(
                    "Arguments", (), {"desktop_id": entry.name, "name": "Short Name"}
                )()
                helper.command_rename_appimage(arguments)
                helper.register_appimage(path)
            self.assertIn("Name=Short Name\n", entry.read_text())

    def test_desktop_copy_is_updated_in_place(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            desktop = root / "Desktop"
            path = appimage(root / "Versioned.AppImage")
            with mock.patch.dict(os.environ, {"XDG_DATA_HOME": str(root / "data")}):
                entry = helper.register_appimage(path)
                with mock.patch.object(helper, "desktop_directory", return_value=desktop):
                    first = helper.trusted_desktop_copy(entry, "Versioned")
                    arguments = type(
                        "Arguments", (), {"desktop_id": entry.name, "name": "Normal Name"}
                    )()
                    helper.command_rename_appimage(arguments)
                    second = helper.trusted_desktop_copy(entry, "Normal Name")
            self.assertEqual(first, second)
            self.assertEqual(len(list(desktop.glob("*.desktop"))), 1)
            self.assertIn("Name=Normal Name\n", second.read_text())


if __name__ == "__main__":
    unittest.main()
