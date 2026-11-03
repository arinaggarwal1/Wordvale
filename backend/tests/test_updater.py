import hashlib
import io
import json
import pathlib
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import updater


def release(tag="v0.1.2", content=b"installer"):
    return {"tag_name": tag, "draft": False, "prerelease": False, "assets": [{
        "name": updater.ASSET_NAME,
        "browser_download_url": f"https://github.com/{updater.REPOSITORY}/releases/download/{tag}/{updater.ASSET_NAME}",
        "digest": "sha256:" + hashlib.sha256(content).hexdigest(), "size": len(content),
    }]}


class UpdateTests(unittest.TestCase):
    def test_version_order_and_invalid_versions(self):
        self.assertGreater(updater.version_tuple("v0.10.0"), updater.version_tuple("0.9.9"))
        self.assertLess(updater.version_tuple("1.0.0-alpha.2"), updater.version_tuple("1.0.0-alpha.10"))
        self.assertLess(updater.version_tuple("1.0.0-rc.1"), updater.version_tuple("1.0.0"))
        for value in ("v0.1", "0.1.1-alpha.01", "0.01.1", "v1.0.0/../../x"):
            with self.subTest(value=value), self.assertRaises(ValueError): updater.version_tuple(value)

    def test_reject_untrusted_assets_and_bad_metadata(self):
        item = release()
        item["assets"][0]["browser_download_url"] = "https://evil.example/a.dmg"
        with self.assertRaises(ValueError): updater.select_asset(item)
        for field, value in (("digest", None), ("digest", "sha256:bad"), ("size", updater.MAX_DOWNLOAD + 1), ("size", 0)):
            item = release(); item["assets"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError): updater.select_asset(item)
        self.assertIsNone(updater.select_asset({"tag_name": "v0.1.2", "assets": [{"name": "windows.msi"}]}))

    def test_reject_untrusted_redirect(self):
        handler = updater.GitHubRedirect()
        request = updater.urllib.request.Request("https://github.com/example")
        with self.assertRaises(ValueError):
            handler.redirect_request(request, None, 302, "", {}, "https://evil.example/update")

    def test_no_downgrade_and_prereleases(self):
        for candidates, current, expected, latest in (([release("v0.1.0")], "0.1.1", "current", "0.1.0"), ([release("v0.1.1")], "0.1.1", "current", "0.1.1"), ([release(), {**release("v0.2.0-alpha.1"), "prerelease": True}], "0.1.1", "available", "0.2.0-alpha.1"), ([release("v0.2.0-alpha.2"), release("v0.2.0-alpha.10"), {**release("v9.0.0"), "draft": True}], "0.2.0-alpha.2", "available", "0.2.0-alpha.10"), ([release("v0.2.0-alpha.1")], "0.2.0", "current", "0.2.0-alpha.1")):
            with self.subTest(candidates=candidates), patch.object(updater.urllib.request, "build_opener") as factory:
                factory.return_value.open.return_value = io.BytesIO(json.dumps(candidates).encode())
                obj = updater.AppUpdater()
                result = obj.check(current)
                self.assertEqual(result["status"], expected)
                self.assertEqual(result["latest_version"], latest)

    def test_paginates_and_ignores_invalid_tags(self):
        first = [release("v0.1.0")] * 99 + [release("not-a-version")]
        second = [release("v0.3.0-beta.1")]
        with patch.object(updater.urllib.request, "build_opener") as factory:
            factory.return_value.open.side_effect = [io.BytesIO(json.dumps(first).encode()), io.BytesIO(json.dumps(second).encode())]
            result = updater.AppUpdater().check("0.2.0")
        self.assertEqual(result["latest_version"], "0.3.0-beta.1")
        self.assertEqual(result["status"], "available")

    def test_bad_checksum_and_wrong_size_leave_installation_untouched(self):
        for content in (b"tampered!", b"short"):
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory, patch.object(updater.urllib.request, "build_opener") as factory:
                target = pathlib.Path(directory) / "Wordvale.app"
                target.mkdir()
                obj = updater.AppUpdater(); obj.target = target; obj.asset = release()["assets"][0]
                factory.return_value.open.return_value = io.BytesIO(content)
                obj._download()
                self.assertEqual(obj.snapshot()["status"], "error")
                self.assertTrue(target.is_dir())
                self.assertIsNone(obj.staged)

    def test_verified_download_is_staged_before_installation(self):
        content = b"a verified dmg"
        with tempfile.TemporaryDirectory() as directory, patch.object(updater.urllib.request, "build_opener") as factory:
            target = pathlib.Path(directory) / "Wordvale.app"
            target.mkdir(); (target / "old").write_text("original")
            obj = updater.AppUpdater(); obj.target = target; obj.asset = release("v0.1.2-alpha.1", content)["assets"][0]
            obj.state["latest_version"] = "0.1.2-alpha.1"
            factory.return_value.open.return_value = io.BytesIO(content)
            def fake_run(command, **_kwargs):
                if command[0].endswith("hdiutil") and command[1] == "attach":
                    mount = pathlib.Path(command[command.index("-mountpoint") + 1])
                    contents = mount / "Wordvale.app" / "Contents"
                    (contents / "MacOS").mkdir(parents=True)
                    (contents / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "com.wordvale.app", "CFBundleShortVersionString": "0.1.2-alpha.1"}))
                    (contents / "MacOS" / "Wordvale").write_text("binary")
                elif command[0].endswith("ditto"):
                    pathlib.Path(command[2]).mkdir()
                return subprocess.CompletedProcess(command, 0)
            with patch.object(updater.subprocess, "run", side_effect=fake_run): obj._download()
            self.assertEqual(obj.snapshot()["status"], "ready")
            self.assertTrue(obj.staged.is_dir())
            self.assertEqual((target / "old").read_text(), "original")
            updater.shutil.rmtree(obj.folder)

    def test_handoff_keeps_backup_and_rolls_back_if_relaunch_fails(self):
        for launch_ok in (True, False):
            with self.subTest(launch_ok=launch_ok), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                target, staged, backup = (root / "installed.app", root / "staged.app", root / "backup.app")
                target.mkdir(); (target / "version").write_text("old")
                staged.mkdir(); (staged / "version").write_text("new")
                fake_open = root / "open"
                fake_open.write_text("#!/bin/sh\nexit " + ("0" if launch_ok else "1") + "\n")
                fake_open.chmod(0o700)
                helper = root / "install.sh"
                helper.write_text(updater.HELPER.replace("/usr/bin/open", str(fake_open)).replace("/usr/bin/osascript", "/usr/bin/true"))
                result = subprocess.run(["/bin/sh", str(helper), "99999999", str(staged), str(target), str(backup)], capture_output=True)
                self.assertEqual((target / "version").read_text(), "new" if launch_ok else "old")
                if launch_ok:
                    self.assertEqual((backup / "version").read_text(), "old")
                    self.assertEqual(result.returncode, 0)
                else:
                    self.assertEqual(result.returncode, 1)

    def test_install_requires_ready_verified_app(self):
        obj = updater.AppUpdater()
        with self.assertRaises(ValueError): obj.install(123)
        with self.assertRaises(ValueError): obj.start_download()

    def test_install_does_not_pass_pyinstaller_state_to_relaunch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            obj = updater.AppUpdater()
            obj.folder = root
            obj.staged = root / "staged.app"
            obj.target = root / "installed.app"
            obj.state["status"] = "ready"
            with patch.object(updater, "app_target", return_value=obj.target), \
                 patch.dict(updater.os.environ, {"_PYI_APPLICATION_HOME_DIR": "/stale", "WORDVALE_TEST": "kept"}), \
                 patch.object(updater.subprocess, "Popen") as spawn:
                obj.install(123)
            env = spawn.call_args.kwargs["env"]
            self.assertNotIn("_PYI_APPLICATION_HOME_DIR", env)
            self.assertEqual(env["WORDVALE_TEST"], "kept")


if __name__ == "__main__": unittest.main()
