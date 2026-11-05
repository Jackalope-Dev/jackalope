"""Tests for the bot computer agent's run protocol (POSIX only).

  python3 apps/desktop/scripts/computer-agent.test.py
"""

import base64
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

AGENT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "src-tauri", "resources", "computer", "agent.py",
)


def load(runs):
    os.environ["JACKALOPE_RUNS"] = runs
    os.environ["JACKALOPE_RUN_ORPHAN_SECONDS"] = "3"
    spec = importlib.util.spec_from_file_location("computer_agent", AGENT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def archive(files, links=None):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w") as bundle:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            bundle.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            bundle.addfile(info)
    return buffer.getvalue()


class RunProtocol(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.agent = load(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def call(self, **request):
        response = self.agent.respond(request)
        if not response["ok"]:
            raise AssertionError(response["error"])
        return response["result"]

    def fails(self, **request):
        response = self.agent.respond(request)
        self.assertFalse(response["ok"], response)
        return response["error"]

    def upload(self, run, data):
        size = len(data)
        step = 7  # several chunks, to exercise offsets
        offset = 0
        result = None
        while True:
            piece = data[offset:offset + step]
            final = offset + len(piece) >= size
            result = self.call(
                action="workspace_put", run=run, offset=offset,
                data=base64.b64encode(piece).decode(), final=final,
                sha256=hashlib.sha256(data).hexdigest() if final else None,
            )
            offset += len(piece)
            if final:
                return result

    def finish(self, run):
        out = err = 0
        stdout = b""
        stderr = b""
        deadline = time.time() + 20
        while time.time() < deadline:
            page = self.call(action="run_read", run=run, out=out, err=err, wait_ms=500)
            stdout += base64.b64decode(page["stdout"])
            stderr += base64.b64decode(page["stderr"])
            out, err = page["out"], page["err"]
            if page["exit"] is not None:
                return page["exit"], stdout, stderr
        self.fail("The run did not finish.")

    def test_round_trip_returns_patch_of_changes(self):
        base = self.upload("r1", archive({"a.txt": b"one\n", "dir/b.txt": b"keep\n"}))
        self.assertEqual(len(base["base"]), 40)
        script = (
            "import sys,os;data=sys.stdin.read();print('got', data.strip());"
            "open('a.txt','w').write('two\\n');open('new.bin','wb').write(bytes(range(256)));"
            "os.remove('dir/b.txt');print('err', file=sys.stderr)"
        )
        started = self.call(action="run_start", run="r1", argv=[sys.executable, "-c", script],
                            env={"EXAMPLE": "1"}, stdin="hello")
        self.assertTrue(started["started"])
        exit, stdout, stderr = self.finish("r1")
        self.assertEqual(exit["code"], 0)
        self.assertEqual(stdout, b"got hello\n")
        self.assertEqual(stderr, b"err\n")
        diff = self.call(action="workspace_diff", run="r1")
        self.assertEqual(sorted(diff["files"]), ["a.txt", "dir/b.txt", "new.bin"])
        patch = b""
        while len(patch) < diff["size"]:
            page = self.call(action="workspace_get", run="r1", offset=len(patch))
            patch += base64.b64decode(page["data"])
        self.assertEqual(hashlib.sha256(patch).hexdigest(), diff["sha256"])
        # The patch applies to a copy of the original files.
        target = os.path.join(self.temp.name, "local")
        os.makedirs(os.path.join(target, "dir"))
        open(os.path.join(target, "a.txt"), "wb").write(b"one\n")
        open(os.path.join(target, "dir", "b.txt"), "wb").write(b"keep\n")
        subprocess.run(["git", "init", "-q"], cwd=target, check=True)
        subprocess.run(["git", "apply", "--binary", "-"], cwd=target, input=patch, check=True)
        self.assertEqual(open(os.path.join(target, "a.txt"), "rb").read(), b"two\n")
        self.assertEqual(open(os.path.join(target, "new.bin"), "rb").read(), bytes(range(256)))
        self.assertFalse(os.path.exists(os.path.join(target, "dir", "b.txt")))
        self.call(action="run_remove", run="r1")
        self.assertFalse(os.path.exists(os.path.join(self.temp.name, "r1")))

    def test_committed_changes_are_included(self):
        self.upload("r2", archive({"a.txt": b"one\n"}))
        script = (
            "import subprocess;open('a.txt','w').write('two\\n');"
            "subprocess.run(['git','-c','user.name=x','-c','user.email=x@x','commit','-qam','x'],check=True)"
        )
        self.call(action="run_start", run="r2", argv=[sys.executable, "-c", script])
        self.assertEqual(self.finish("r2")[0]["code"], 0)
        self.assertEqual(self.call(action="workspace_diff", run="r2")["files"], ["a.txt"])

    def test_stop_ends_the_run(self):
        self.upload("r3", archive({"a.txt": b"x"}))
        self.call(action="run_start", run="r3",
                  argv=[sys.executable, "-c", "import time;time.sleep(60)"])
        self.assertTrue(self.call(action="run_stop", run="r3")["stopping"])
        exit, _, _ = self.finish("r3")
        self.assertEqual(exit["reason"], "stopped")

    def test_unread_run_is_stopped_as_orphan(self):
        self.upload("r4", archive({"a.txt": b"x"}))
        self.call(action="run_start", run="r4",
                  argv=[sys.executable, "-c", "import time;time.sleep(60)"])
        deadline = time.time() + 20
        path = os.path.join(self.temp.name, "r4", "exit.json")
        while not os.path.exists(path) and time.time() < deadline:
            time.sleep(0.2)
        self.assertEqual(json.load(open(path))["reason"], "orphaned")

    def test_spec_with_credentials_is_removed(self):
        self.upload("r5", archive({"a.txt": b"x"}))
        self.call(action="run_start", run="r5", argv=[sys.executable, "-c", "import os;print(os.environ['SECRET'])"],
                  env={"SECRET": "s3cret"})
        exit, stdout, _ = self.finish("r5")
        self.assertEqual(stdout, b"s3cret\n")
        self.assertFalse(os.path.exists(os.path.join(self.temp.name, "r5", "spec.json")))

    def test_rejects_unsafe_uploads(self):
        for files, links in (
            ({"../escape": b"x"}, None),
            ({"/abs": b"x"}, None),
            ({".git/config": b"x"}, None),
            ({}, {"link": "/etc/passwd"}),
            ({}, {"link": "../../outside"}),
        ):
            data = archive(files, links)
            error = self.fails(action="workspace_put", run="bad", offset=0,
                               data=base64.b64encode(data).decode(), final=True)
            self.assertIn("upload", error)

    def test_validates_requests(self):
        self.assertIn("Name the run", self.fails(action="run_read", run="../x"))
        self.assertIn("does not exist", self.fails(action="run_read", run="missing"))
        self.upload("r6", archive({"a.txt": b"x"}))
        self.assertIn("offset", self.fails(action="workspace_put", run="r6", offset=99,
                                           data="", final=False))
        self.assertIn("not installed", self.fails(action="run_start", run="r6",
                                                  argv=["no-such-program-xyz"]))
        self.assertIn("at most", self.fails(
            action="workspace_put", run="r6", offset=0,
            data=base64.b64encode(b"x" * (self.agent.CHUNK_LIMIT + 1)).decode()))


if __name__ == "__main__":
    unittest.main()
