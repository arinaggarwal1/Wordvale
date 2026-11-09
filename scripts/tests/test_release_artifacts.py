import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("release_artifacts", Path(__file__).parents[1] / "release-artifacts.py")
release_artifacts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release_artifacts)


class FakeGitHub:
    """Exercise publication logic without touching a real release or account."""

    def __init__(self, current=None, contents=None):
        self.current = copy.deepcopy(current)
        self.contents = dict(contents or {})
        self.calls = []
        self.create_race = None
        self.api_failure = None
        self.list_failure = None
        self.list_pages = None

    def __call__(self, *args, check=True):
        self.calls.append(args)
        code, output, error = 0, "", ""
        if args[0] == "api":
            if self.api_failure:
                code, error = 1, self.api_failure
            elif "/releases/tags/" in args[1]:
                if self.current is None or self.current.get("draft"):
                    code, error = 1, "gh: Not Found (HTTP 404)"
                else:
                    output = json.dumps(self.current)
            elif args[1].endswith("/releases?per_page=100"):
                assert "--paginate" in args and "--slurp" in args
                if self.list_failure:
                    code, error = 1, self.list_failure
                else:
                    pages = self.list_pages if self.list_pages is not None else [[self.current] if self.current else []]
                    output = json.dumps(pages)
            else:
                raise AssertionError(args)
        elif args[:2] == ("release", "create"):
            if self.create_race:
                self.current, self.contents = copy.deepcopy(self.create_race)
                code, error = 1, "release already exists"
            else:
                body = Path(args[args.index("--notes-file") + 1]).read_text()
                self.current = {"tag_name": args[2], "draft": True, "prerelease": False, "body": body, "assets": []}
        elif args[:2] == ("release", "upload"):
            self.assert_no_clobber(args)
            path = Path(args[3])
            self.contents[path.name] = path.read_bytes()
            self.current["assets"].append(asset(path.name, self.contents[path.name]))
        elif args[:2] == ("release", "download"):
            name = args[args.index("--pattern") + 1]
            directory = Path(args[args.index("--dir") + 1])
            (directory / name).write_bytes(self.contents[name])
        elif args[:2] == ("release", "edit"):
            assert "--draft=false" in args and "--prerelease=false" in args and "--latest" in args
            self.current.update(draft=False, prerelease=False, latest=True)
        else:
            raise AssertionError(args)
        if check and code:
            raise RuntimeError(error)
        return subprocess.CompletedProcess(args, code, output, error)

    @staticmethod
    def assert_no_clobber(args):
        assert "--clobber" not in args


def asset(name, data):
    return {"name": name, "size": len(data), "state": "uploaded",
            "digest": "sha256:" + hashlib.sha256(data).hexdigest()}


def existing_release(draft=False, complete=True, managed=False):
    contents = {name: ("remote " + name).encode() for name in release_artifacts.BINARIES}
    if complete:
        for name, data in list(contents.items()):
            contents[name + ".sha256"] = f"{hashlib.sha256(data).hexdigest()}  {name}\n".encode()
    return {"tag_name": "v0.4.0-alpha.1", "draft": draft, "body": release_artifacts.WORKFLOW_MARKER if managed else "Manual release notes",
            "assets": [asset(name, data) for name, data in contents.items()]}, contents


class ReleaseArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        for name in release_artifacts.BINARIES:
            (self.root / name).write_bytes(("new CI build " + name).encode())

    def publish(self, fake):
        with patch.object(release_artifacts, "gh", fake), contextlib.redirect_stdout(io.StringIO()):
            release_artifacts.publish("owner/repo", "v0.4.0-alpha.1", self.root)

    def test_new_release_attaches_both_platforms_then_publishes_as_latest(self):
        fake = FakeGitHub()
        self.publish(fake)
        self.assertEqual(set(fake.contents), set(release_artifacts.REQUIRED))
        self.assertFalse(fake.current["draft"])
        self.assertFalse(fake.current["prerelease"])
        self.assertTrue(fake.current["latest"])
        mutations = [call[1] for call in fake.calls if call[0] == "release" and call[1] != "download"]
        self.assertEqual(mutations, ["create", "upload", "upload", "upload", "upload", "edit"])

    def test_complete_manual_draft_and_published_release_are_untouched(self):
        for draft in (True, False):
            with self.subTest(draft=draft):
                current, contents = existing_release(draft=draft)
                fake = FakeGitHub(current, contents)
                self.publish(fake)
                self.assertEqual(fake.current, current)
                self.assertEqual(len(fake.calls), 2 if draft else 1)

    def test_partial_existing_release_keeps_binaries_and_hashes_remote_bytes(self):
        for draft in (True, False):
            with self.subTest(draft=draft):
                current, contents = existing_release(draft=draft, complete=False)
                fake = FakeGitHub(current, contents)
                self.publish(fake)
                self.assertEqual(fake.current["draft"], draft)
                self.assertEqual(fake.current["body"], current["body"])
                for name, data in contents.items():
                    self.assertEqual(fake.contents[name], data)
                    self.assertEqual(fake.contents[name + ".sha256"], f"{hashlib.sha256(data).hexdigest()}  {name}\n".encode())
                self.assertFalse(any(call[:2] == ("release", "edit") for call in fake.calls))

    def test_concurrent_manual_creation_wins_and_stays_draft(self):
        fake = FakeGitHub()
        fake.create_race = existing_release(draft=True)
        self.publish(fake)
        self.assertTrue(fake.current["draft"])
        self.assertFalse(any(call[:2] in (("release", "edit"), ("release", "upload")) for call in fake.calls))

    def test_complete_workflow_draft_resumes_publication_without_build_files(self):
        current, contents = existing_release(draft=True, managed=True)
        fake = FakeGitHub(current, contents)
        for name in release_artifacts.BINARIES:
            (self.root / name).unlink()
        self.publish(fake)
        self.assertFalse(fake.current["draft"])
        self.assertFalse(any(call[:2] == ("release", "upload") for call in fake.calls))

    def test_older_assets_without_api_digest_are_downloaded_for_hashing(self):
        current, contents = existing_release(complete=False)
        for entry in current["assets"]:
            entry.pop("digest")
        fake = FakeGitHub(current, contents)
        self.publish(fake)
        self.assertEqual(fake.contents[release_artifacts.BINARIES[0]], contents[release_artifacts.BINARIES[0]])
        self.assertTrue(any(call[:2] == ("release", "download") and call[call.index("--pattern") + 1].endswith(".dmg") for call in fake.calls))

    def test_mismatched_existing_checksum_is_not_overwritten_or_published(self):
        current, contents = existing_release(draft=True, managed=True)
        contents[release_artifacts.BINARIES[0] + ".sha256"] = b"invalid checksum"
        fake = FakeGitHub(current, contents)
        with self.assertRaisesRegex(RuntimeError, "does not match"):
            self.publish(fake)
        self.assertTrue(fake.current["draft"])
        self.assertFalse(any(call[:2] == ("release", "upload") for call in fake.calls))

    def test_api_failure_does_not_create_a_release(self):
        fake = FakeGitHub()
        fake.api_failure = "gh: server unavailable (HTTP 503)"
        with self.assertRaisesRegex(RuntimeError, "503"):
            self.publish(fake)
        self.assertTrue(all(call[0] == "api" for call in fake.calls))

    def test_inspect_skips_complete_manual_drafts_but_resumes_managed_drafts(self):
        for managed in (False, True):
            with self.subTest(managed=managed):
                fake = FakeGitHub(*existing_release(draft=True, managed=managed))
                output = self.root / (str(managed) + ".txt")
                with patch.object(release_artifacts, "gh", fake), contextlib.redirect_stdout(io.StringIO()):
                    release_artifacts.inspect("owner/repo", "v0.4.0-alpha.1", output)
                self.assertIn("build_required=false", output.read_text())
                self.assertIn(f"publish_required={str(managed).lower()}", output.read_text())

    def test_tag_404_finds_manual_draft_on_later_release_page_and_skips_it(self):
        current, contents = existing_release(draft=True)
        fake = FakeGitHub(current, contents)
        other = dict(current, tag_name="v0.3.0-alpha.1")
        fake.list_pages = [[other], [current]]
        output = self.root / "outputs.txt"
        with patch.object(release_artifacts, "gh", fake), contextlib.redirect_stdout(io.StringIO()):
            release_artifacts.inspect("owner/repo", "v0.4.0-alpha.1", output)
        self.assertEqual(output.read_text(), "build_required=false\npublish_required=false\n")
        self.publish(fake)
        self.assertEqual(fake.current, current)
        self.assertTrue(all(call[0] == "api" for call in fake.calls))

    def test_tag_404_with_no_matching_release_in_list_returns_none(self):
        fake = FakeGitHub()
        other, _ = existing_release(draft=True)
        other["tag_name"] = "v0.3.0-alpha.1"
        fake.list_pages = [[other], []]
        with patch.object(release_artifacts, "gh", fake):
            self.assertIsNone(release_artifacts.release("owner/repo", "v0.4.0-alpha.1"))

    def test_tag_404_then_list_forbidden_fails_without_creating_release(self):
        fake = FakeGitHub()
        fake.list_failure = "gh: Forbidden (HTTP 403)"
        with self.assertRaisesRegex(RuntimeError, "403"):
            self.publish(fake)
        self.assertTrue(all(call[0] == "api" for call in fake.calls))


if __name__ == "__main__":
    unittest.main()
