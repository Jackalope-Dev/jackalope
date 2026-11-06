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


class Harness(unittest.TestCase):
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


class RunProtocol(Harness):
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

    def test_relay_hands_bridge_calls_over_and_returns_answers(self):
        self.upload("r7", archive({"a.txt": b"x"}))
        script = (
            "import os,urllib.request;"
            "url=os.environ['JACKALOPE_BRIDGE_URL'];token=os.environ['JACKALOPE_BRIDGE_TOKEN'];"
            "assert url.startswith('http://127.0.0.1:') and '@@' not in token;"
            "bad=urllib.request.Request(url+'/mcp',data=b'{}',method='POST');"
            "exec('try:\\n urllib.request.urlopen(bad)\\nexcept Exception as e:\\n print(\"denied\",e.code)');"
            "req=urllib.request.Request(url+'/mcp',data=b'{\"x\":1}',method='POST',"
            "headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'});"
            "print(urllib.request.urlopen(req).read().decode())"
        )
        self.call(action="run_start", run="r7", argv=[sys.executable, "-c", script],
                  env={"JACKALOPE_BRIDGE_URL": self.agent.RELAY_URL,
                       "JACKALOPE_BRIDGE_TOKEN": self.agent.RELAY_TOKEN},
                  relay=True)
        deadline = time.time() + 20
        calls = []
        while not calls and time.time() < deadline:
            calls = self.call(action="run_read", run="r7", out=0, err=0, wait_ms=500)["bridge"]
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual((call["method"], call["path"]), ("POST", "/mcp"))
        self.assertEqual(base64.b64decode(call["body"]), b'{"x":1}')
        self.assertNotIn("authorization", {k.lower() for k in call["headers"]})
        # Handed over once, again only when reclaimed.
        self.assertEqual(self.call(action="run_read", run="r7", out=0, err=0)["bridge"], [])
        self.assertEqual(len(self.call(action="run_read", run="r7", out=0, err=0,
                                       reclaim=True)["bridge"]), 1)
        answered = self.call(action="run_answer", run="r7", call=call["id"], status=200,
                             contentType="application/json",
                             body=base64.b64encode(b'{"ok":true}').decode())
        self.assertTrue(answered["delivered"])
        exit, stdout, _ = self.finish("r7")
        self.assertEqual(exit["code"], 0)
        self.assertEqual(stdout, b'denied 401\n{"ok":true}\n')
        self.assertFalse(self.call(action="run_answer", run="r7", call=call["id"],
                                   status=200, body="")["delivered"])

    def test_relay_answers_an_oversized_tool_call_with_a_tool_error(self):
        self.upload("r9", archive({"a.txt": b"x"}))
        script = (
            "import json,os,urllib.request;"
            "url=os.environ['JACKALOPE_BRIDGE_URL'];token=os.environ['JACKALOPE_BRIDGE_TOKEN'];"
            "body=json.dumps({'jsonrpc':'2.0','id':5,'method':'tools/call',"
            "'params':{'name':'execute_tool','arguments':{'text':'x'*70000}}}).encode();"
            "req=urllib.request.Request(url+'/mcp',data=body,method='POST',"
            "headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'});"
            "print(urllib.request.urlopen(req).read().decode())"
        )
        self.call(action="run_start", run="r9", argv=[sys.executable, "-c", script],
                  env={"JACKALOPE_BRIDGE_URL": self.agent.RELAY_URL,
                       "JACKALOPE_BRIDGE_TOKEN": self.agent.RELAY_TOKEN},
                  relay=True)
        exit, stdout, _ = self.finish("r9")
        self.assertEqual(exit["code"], 0)
        answer = json.loads(stdout)
        self.assertEqual(answer["id"], 5)
        self.assertTrue(answer["result"]["isError"])
        self.assertIn("nothing ran", answer["result"]["content"][0]["text"])
        self.assertEqual(self.call(action="run_read", run="r9", out=0, err=0)["bridge"], [])

    def test_status_reports_a_run_whose_supervisor_died(self):
        self.assertEqual(self.call(action="run_status", run="r8"),
                         {"exists": False, "runs": self.agent.RUNS_PROTOCOL,
                          "capabilities": self.agent.CAPABILITIES})
        self.upload("r8", archive({"a.txt": b"x"}))
        self.assertFalse(self.call(action="run_status", run="r8")["started"])
        self.call(action="run_start", run="r8",
                  argv=[sys.executable, "-c", "import time;time.sleep(60)"])
        status = self.call(action="run_status", run="r8")
        self.assertTrue(status["started"])
        self.assertIsNone(status["exit"])
        pid = int(open(os.path.join(self.temp.name, "r8", "pid")).read())
        supervisor = self.agent.SUPERVISORS[-1]
        supervisor.kill()
        supervisor.wait()
        os.kill(pid, 9)
        self.assertEqual(self.call(action="run_status", run="r8")["exit"]["reason"], "interrupted")
        self.assertIsNotNone(self.call(action="workspace_diff", run="r8"))

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

    def test_on_demand_cli_is_installed_into_the_home(self):
        tools = os.path.join(self.temp.name, "tools")
        os.makedirs(tools)
        npm = os.path.join(tools, "npm")
        # A stand-in npm that installs a program into --prefix's bin folder.
        with open(npm, "w") as handle:
            handle.write(
                '#!/bin/sh\nset -e\nprefix=$4\nmkdir -p "$prefix/bin"\n'
                'printf "#!/bin/sh\\nexit 0\\n" > "$prefix/bin/fake-agent-cli"\n'
                'chmod +x "$prefix/bin/fake-agent-cli"\n'
            )
        os.chmod(npm, 0o755)
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = tools + os.pathsep + path
        try:
            self.agent.LOCAL_PREFIX = os.path.join(self.temp.name, "home-local")
            self.agent.ON_DEMAND["fake-agent-cli"] = "fake-agent-package"
            self.agent.ensure_program("fake-agent-cli")
            self.assertTrue(os.path.exists(
                os.path.join(self.agent.LOCAL_PREFIX, "bin", "fake-agent-cli")))
            with self.assertRaises(self.agent.Failure):
                self.agent.ensure_program("not-on-demand-xyz")
        finally:
            os.environ["PATH"] = path

    def test_connections_start_from_private_files_and_leave_no_credentials(self):
        self.upload("m1", archive({"a.txt": b"x"}))
        server = ("import os;print(os.environ['CONN_TOKEN']=='conn-secret', os.getcwd(),"
                  "'JACKALOPE_BRIDGE_TOKEN' in os.environ)")
        # A stand-in CLI: prints its command line, then starts the connection
        # from its MCP configuration the way Claude Code would.
        script = (
            "import json,os,stat,subprocess,sys;"
            "print(json.dumps(sys.argv[1:]));"
            "config=json.loads(sys.argv[sys.argv.index('--mcp-config')+1]);"
            "entry=config['mcpServers']['docs'];"
            "print(oct(stat.S_IMODE(os.stat(entry['args'][-1]).st_mode)));"
            "out=subprocess.run([entry['command'],*entry['args']],capture_output=True,text=True);"
            "print(out.stdout.strip());print(sys.stdin.read())"
        )
        bridge = json.dumps({"mcpServers": {"jackalope": {"type": "http", "url": "x"}}})
        mcp = {"config": "claude", "approve": True, "servers": [
            {"key": "docs", "name": "Docs", "command": "python3", "args": ["-c", server],
             "env": {"CONN_TOKEN": "conn-secret"}},
            {"key": "gone", "name": "Gone", "command": "no-such-runtime-xyz", "args": [], "env": {}},
        ]}
        started = self.call(
            action="run_start", run="m1", argv=[sys.executable, "-c", script, "--mcp-config", bridge],
            env={"JACKALOPE_BRIDGE_URL": self.agent.RELAY_URL,
                 "JACKALOPE_BRIDGE_TOKEN": self.agent.RELAY_TOKEN},
            stdin="task", relay=True, mcp=mcp)
        self.assertEqual(started["mcp"]["unavailable"], [
            {"name": "Gone", "reason": "no-such-runtime-xyz is not installed in this computer."}])
        exit, stdout, _ = self.finish("m1")
        self.assertEqual(exit["code"], 0)
        lines = stdout.decode().splitlines()
        argv = json.loads(lines[0])
        config = json.loads(argv[argv.index("--mcp-config") + 1])
        self.assertEqual(sorted(config["mcpServers"]), ["docs", "jackalope"])
        settings = json.loads(argv[argv.index("--settings") + 1])
        rule = settings["hooks"]["PreToolUse"][0]
        self.assertEqual(rule["matcher"], "mcp__(docs)__.*")
        self.assertIn("mcp-approve", rule["hooks"][0]["command"])
        self.assertEqual(lines[1], "0o600")
        workspace = os.path.realpath(os.path.join(self.temp.name, "m1", "workspace"))
        self.assertEqual(lines[2], f"True {workspace} False")
        self.assertIn("could not start on this computer: Gone (no-such-runtime-xyz", stdout.decode())
        # The credential reached only the server: not the command line, the
        # run's files once it ended, or the patch.
        self.assertFalse(os.path.exists(os.path.join(self.temp.name, "m1", "mcp")))
        self.assertEqual(self.call(action="workspace_diff", run="m1")["fileCount"], 0)
        for folder, _, files in os.walk(os.path.join(self.temp.name, "m1")):
            for name in files:
                with open(os.path.join(folder, name), "rb") as handle:
                    self.assertNotIn(b"conn-secret", handle.read(), name)

    def test_codex_connections_extend_the_bridge_table(self):
        self.upload("m2", archive({"a.txt": b"x"}))
        bridge = 'mcp_servers={ jackalope = { url = "x" } }'
        mcp = {"config": "codex", "servers": [
            {"key": "docs", "name": "Docs", "command": "python3", "args": [], "env": {"K": "v-secret"}}]}
        self.call(action="run_start", run="m2", mcp=mcp, argv=[
            sys.executable, "-c", "import json,sys;print(json.dumps(sys.argv[1:]))",
            "exec", "-c", bridge, "--json", "-"])
        exit, stdout, _ = self.finish("m2")
        self.assertEqual(exit["code"], 0)
        self.assertNotIn(b"v-secret", stdout)
        args = json.loads(stdout)
        index = args.index(bridge)
        self.assertEqual(args[index + 1:index + 3],
                         ["-c", f"mcp_servers.docs.command={json.dumps(sys.executable)}"])
        self.assertTrue(args[index + 4].startswith("mcp_servers.docs.args=["))
        self.assertEqual(args[index + 6], "mcp_servers.docs.startup_timeout_sec=120")
        self.assertEqual(args[-2:], ["--json", "-"])

    def test_connection_requests_are_validated(self):
        self.upload("m3", archive({"a.txt": b"x"}))
        for server in (
            {"key": "jackalope", "name": "x", "command": "python3", "args": [], "env": {}},
            {"key": "x", "name": "x", "command": "/usr/bin/python3", "args": [], "env": {}},
            {"key": "x", "name": "x", "command": "python3", "args": [], "env": {"1BAD": "v"}},
        ):
            self.assertIn("Supply each connection", self.fails(
                action="run_start", run="m3", argv=[sys.executable, "-c", "pass"],
                mcp={"config": "claude", "servers": [server]}))
        self.assertIn("Supply connections", self.fails(
            action="run_start", run="m3", argv=[sys.executable, "-c", "pass"],
            mcp={"config": "gemini", "servers": []}))
        # Claude Code's approvals need the relay; without it nothing starts.
        started = self.call(
            action="run_start", run="m3", argv=[sys.executable, "-c", "pass"],
            mcp={"config": "claude", "approve": True, "servers": [
                {"key": "x", "name": "X", "command": "python3", "args": [], "env": {"T": "s"}}]})
        self.assertIn("bridge", started["mcp"]["unavailable"][0]["reason"])
        self.assertFalse(os.path.exists(os.path.join(self.temp.name, "m3", "mcp")))

    def test_missing_uv_is_installed_and_python_means_python3(self):
        tools = os.path.join(self.temp.name, "tools")
        os.makedirs(tools)
        with open(os.path.join(tools, "python3"), "w") as handle:
            handle.write("#!/bin/sh\nexit 0\n")
        os.chmod(os.path.join(tools, "python3"), 0o755)
        path = os.environ.get("PATH", "")
        os.environ["PATH"] = tools
        local = os.path.join(self.temp.name, "home-local")
        installed = []

        def fake_install():
            os.makedirs(os.path.join(local, "bin"), exist_ok=True)
            for name in ("uv", "uvx"):
                target = os.path.join(local, "bin", name)
                with open(target, "w") as handle:
                    handle.write("#!/bin/sh\nexit 0\n")
                os.chmod(target, 0o755)
            installed.append(True)

        try:
            self.agent.LOCAL_PREFIX = local
            self.agent.install_uv = fake_install
            self.assertEqual(self.agent.ensure_runtime("python"), os.path.join(tools, "python3"))
            self.assertEqual(self.agent.ensure_runtime("uvx"), os.path.join(local, "bin", "uvx"))
            self.assertEqual(self.agent.ensure_runtime("uv"), os.path.join(local, "bin", "uv"))
            self.assertEqual(installed, [True])
            with self.assertRaises(self.agent.Failure):
                self.agent.ensure_runtime("docker")
        finally:
            os.environ["PATH"] = path

    def test_approval_hook_allows_only_an_explicit_allow(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        import threading
        answers = []
        seen = []

        class Bridge(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                seen.append((self.path, self.headers.get("Authorization"), body))
                data = json.dumps(answers.pop(0)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Bridge)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_address[1]}"

        def hook(event, answer=None):
            if answer is not None:
                answers.append(answer)
            done = subprocess.run(
                [sys.executable, AGENT, "mcp-approve"], input=json.dumps(event),
                capture_output=True, text=True, timeout=30,
                env=dict(os.environ, JACKALOPE_BRIDGE_URL=url, JACKALOPE_BRIDGE_TOKEN="relay-secret"))
            self.assertEqual(done.returncode, 0, done.stderr)
            return json.loads(done.stdout)["hookSpecificOutput"]

        event = {"tool_name": "mcp__docs__write", "tool_input": {"text": "hi"}}
        self.assertEqual(hook(event, {"behavior": "allow"})["permissionDecision"], "allow")
        denied = hook(event, {"behavior": "deny", "message": "No."})
        self.assertEqual((denied["permissionDecision"], denied["permissionDecisionReason"]),
                         ("deny", "No."))
        self.assertEqual(hook(event, {"unexpected": True})["permissionDecision"], "deny")
        large = hook({"tool_name": "mcp__docs__write", "tool_input": {"text": "x" * 70000}},
                     {"behavior": "allow"})
        self.assertEqual(large["permissionDecision"], "allow")
        path, authorization, body = seen[0]
        self.assertEqual((path, authorization), ("/v1/tools/approve", "Bearer relay-secret"))
        self.assertEqual(json.loads(body), {"tool_name": "mcp__docs__write", "input": {"text": "hi"}})
        self.assertLess(len(seen[-1][2]), self.agent.RELAY_BODY_LIMIT)
        self.assertTrue(json.loads(seen[-1][2])["input"]["truncated"])
        server.shutdown()
        server.server_close()
        # A bridge that cannot be reached denies the call.
        self.assertEqual(hook(event)["permissionDecision"], "deny")


def git(cwd, *args, env=None):
    done = subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", *args],
        cwd=cwd, capture_output=True, env=dict(os.environ, **(env or {})),
    )
    if done.returncode != 0:
        raise AssertionError(f"git {args}: {done.stderr.decode()}")
    return done.stdout.decode().strip()


class SyncProtocol(Harness):
    """Artifacts and git-sync, with a local repository standing in for Jackalope."""

    def put(self, data, step=5):
        digest = hashlib.sha256(data).hexdigest()
        offset = 0
        while True:
            piece = data[offset:offset + step]
            result = self.call(action="artifact_put", sha256=digest, size=len(data),
                               offset=offset, data=base64.b64encode(piece).decode())
            offset += len(piece)
            if result["complete"]:
                return digest

    def get(self, digest):
        data = b""
        while True:
            page = self.call(action="artifact_get", sha256=digest, offset=len(data))
            data += base64.b64decode(page["data"])
            if len(data) >= page["size"]:
                return data

    def local(self):
        """A person's repository: a base commit, then uncommitted changes, an
        ignored setup file and Jackalope context."""
        path = os.path.join(self.temp.name, "local")
        os.makedirs(path)
        git(path, "init", "-q", "-b", "main")
        open(os.path.join(path, ".gitignore"), "w").write(".env.local\n.jackalope/\n")
        open(os.path.join(path, "a.txt"), "w").write("one\n")
        open(os.path.join(path, "gone.txt"), "w").write("bye\n")
        open(os.path.join(path, "big.bin"), "wb").write(os.urandom(200000))
        git(path, "add", "-A")
        git(path, "commit", "-qm", "base")
        open(os.path.join(path, "a.txt"), "w").write("two\n")
        open(os.path.join(path, "new.txt"), "w").write("new\n")
        os.remove(os.path.join(path, "gone.txt"))
        open(os.path.join(path, ".env.local"), "w").write("KEY=1\n")
        return path

    def snapshot(self, path, known=()):
        """What Jackalope sends: a bundle of a synthetic commit of the working tree
        on the base, without the commits the computer already has."""
        index = os.path.join(self.temp.name, "snapshot.index")
        env = {"GIT_INDEX_FILE": index}
        git(path, "read-tree", "HEAD", env=env)
        git(path, "add", "-A", env=env)
        tree = git(path, "write-tree", env=env)
        base = git(path, "rev-parse", "HEAD")
        commit = git(path, "commit-tree", tree, "-p", base, "-m", "snapshot")
        git(path, "update-ref", "refs/heads/snapshot", commit)
        bundle = os.path.join(self.temp.name, "upload.bundle")
        git(path, "bundle", "create", "-q", bundle, "refs/heads/snapshot",
            *(["--not", *known] if known else []))
        git(path, "update-ref", "-d", "refs/heads/snapshot")
        os.remove(index)
        return base, commit, open(bundle, "rb").read()

    def test_artifacts_resume_dedupe_and_check_their_hash(self):
        data = os.urandom(23)
        digest = hashlib.sha256(data).hexdigest()
        self.assertEqual(self.call(action="artifact_stat", sha256=digest)["received"], 0)
        self.call(action="artifact_put", sha256=digest, size=23, offset=0,
                  data=base64.b64encode(data[:10]).decode())
        # A lost chunk is refused; the transfer resumes from what arrived.
        self.assertIn("does not follow", self.fails(
            action="artifact_put", sha256=digest, size=23, offset=15,
            data=base64.b64encode(data[15:]).decode()))
        stat = self.call(action="artifact_stat", sha256=digest)
        self.assertEqual((stat["complete"], stat["received"]), (False, 10))
        done = self.call(action="artifact_put", sha256=digest, size=23, offset=10,
                         data=base64.b64encode(data[10:]).decode())
        self.assertTrue(done["complete"])
        self.assertEqual(self.get(digest), data)
        # A stored artifact is not sent again.
        self.assertTrue(self.call(action="artifact_put", sha256=digest, size=23, offset=0,
                                  data="")["complete"])
        wrong = hashlib.sha256(b"other").hexdigest()
        self.assertIn("SHA-256 mismatch", self.fails(
            action="artifact_put", sha256=wrong, size=5, offset=0,
            data=base64.b64encode(b"bytes").decode()))
        self.assertEqual(self.call(action="artifact_stat", sha256=wrong)["received"], 0)
        self.assertIn("not on this computer", self.fails(action="artifact_get", sha256=wrong))
        self.assertIn("SHA-256", self.fails(action="artifact_stat", sha256="../x"))
        big = os.urandom(self.agent.CHUNK_LIMIT * 2 + 3)
        self.assertEqual(self.get(self.put(big, step=self.agent.CHUNK_LIMIT)), big)

    def test_git_sync_round_trip_keeps_context_out_and_returns_artifacts(self):
        status = self.call(action="run_status", run="s1")
        self.assertIn("git-sync", status["capabilities"])
        self.assertIn("artifacts", status["capabilities"])
        self.assertEqual(status["runs"], 4)
        path = self.local()
        self.assertEqual(self.call(action="sync_status", repo="p1")["have"], [])
        base, snapshot, bundle = self.snapshot(path)
        extras = archive({".env.local": b"KEY=1\n", ".jackalope/cloudflare.json": b"{}"})
        self.call(action="sync_checkout", run="s1", repo="p1", bundle=self.put(bundle, 4096),
                  base=base, snapshot=snapshot, extras=self.put(extras))
        workspace = os.path.join(self.temp.name, "s1", "workspace")
        read = lambda name: open(os.path.join(workspace, name)).read()  # noqa: E731
        self.assertEqual(read("a.txt"), "two\n")
        self.assertEqual(read("new.txt"), "new\n")
        self.assertEqual(read(".env.local"), "KEY=1\n")
        self.assertEqual(read(".jackalope/cloudflare.json"), "{}")
        self.assertFalse(os.path.exists(os.path.join(workspace, "gone.txt")))
        # The agent sees the person's history, with their changes uncommitted.
        self.assertEqual(git(workspace, "rev-parse", "HEAD"), base)
        status = subprocess.run(["git", "status", "--porcelain"], cwd=workspace,
                                capture_output=True, check=True).stdout.decode()
        self.assertEqual(sorted(status.splitlines()), [" D gone.txt", " M a.txt", "?? new.txt"])
        self.assertTrue(self.call(action="run_status", run="s1")["synced"])
        script = (
            "import os,subprocess;"
            "g=lambda *a:subprocess.run(['git','-c','user.name=x','-c','user.email=x@x',*a],check=True);"
            "open('a.txt','w').write('three\\n');g('commit','-qam','agent');"
            "open('b.txt','w').write('b\\n');open('.env.local','w').write('KEY=2\\n');"
            "open('.jackalope/cloudflare.json','w').write('changed');"
            "os.makedirs('.jackalope/artifacts/screenshots');"
            "open('.jackalope/artifacts/screenshots/s.png','wb').write(b'PNG')"
        )
        self.call(action="run_start", run="s1", argv=[sys.executable, "-c", script])
        self.assertEqual(self.finish("s1")[0]["code"], 0)
        result = self.call(action="sync_result", run="s1")
        self.assertEqual(result["base"], base)
        self.assertEqual(result["artifacts"], [{
            "path": ".jackalope/artifacts/screenshots/s.png", "size": 3,
            "sha256": hashlib.sha256(b"PNG").hexdigest()}])
        self.assertEqual(self.get(result["artifacts"][0]["sha256"]), b"PNG")
        returned = os.path.join(self.temp.name, "result.bundle")
        open(returned, "wb").write(self.get(result["bundle"]["sha256"]))
        # The result needs only the base, which Jackalope has.
        git(path, "bundle", "verify", "-q", returned)
        git(path, "fetch", "-q", returned, "+refs/*:refs/incoming/*")
        changed = git(path, "diff", "--name-status", "--no-renames", base, result["result"])
        self.assertEqual(sorted(changed.splitlines()),
                         ["A\tb.txt", "A\tnew.txt", "D\tgone.txt", "M\ta.txt"])
        self.assertEqual(git(path, "show", f"{result['result']}:a.txt"), "three")
        # Later attempts send only what the computer does not have.
        self.assertEqual(self.call(action="sync_status", repo="p1")["have"], [base])
        _, again, delta = self.snapshot(path, known=[base])
        self.assertLess(len(delta), len(bundle) // 4)
        self.call(action="sync_checkout", run="s2", repo="p1", bundle=self.put(delta, 4096),
                  base=base, snapshot=again)
        self.assertEqual(open(os.path.join(self.temp.name, "s2", "workspace", "a.txt")).read(),
                         "two\n")
        repo = os.path.join(self.temp.name, ".repos", "p1.git")
        self.call(action="run_remove", run="s1")
        self.assertNotIn("jackalope/s1", git(repo, "branch", "--list"))
        self.assertEqual(git(repo, "for-each-ref", "refs/jackalope/result/"), "")
        self.assertNotIn("s1", git(repo, "worktree", "list"))
        self.assertIn("s2", git(repo, "worktree", "list"))

    def test_sync_checkout_refuses_a_mismatched_snapshot(self):
        path = self.local()
        base, snapshot, bundle = self.snapshot(path)
        digest = self.put(bundle, 4096)
        self.assertIn("does not hold", self.fails(
            action="sync_checkout", run="s3", repo="p1", bundle=digest,
            base=snapshot, snapshot=snapshot))
        self.assertIn("Name the repository", self.fails(
            action="sync_checkout", run="s3", repo="../x", bundle=digest,
            base=base, snapshot=snapshot))
        self.assertIn("first", self.fails(
            action="sync_checkout", run="s3", repo="p1", bundle="0" * 64,
            base=base, snapshot=snapshot))
        self.assertIn("not checked out", self.fails(action="sync_result", run="s3"))

    def test_large_bridge_answers_arrive_from_an_artifact(self):
        self.upload("s4", archive({"a.txt": b"x"}))
        script = (
            "import os,urllib.request;"
            "url=os.environ['JACKALOPE_BRIDGE_URL'];token=os.environ['JACKALOPE_BRIDGE_TOKEN'];"
            "req=urllib.request.Request(url+'/mcp',data=b'{}',method='POST',"
            "headers={'Authorization':'Bearer '+token});"
            "data=urllib.request.urlopen(req).read();print(len(data),data[:3].decode())"
        )
        self.call(action="run_start", run="s4", argv=[sys.executable, "-c", script],
                  env={"JACKALOPE_BRIDGE_URL": self.agent.RELAY_URL,
                       "JACKALOPE_BRIDGE_TOKEN": self.agent.RELAY_TOKEN},
                  relay=True)
        deadline = time.time() + 20
        calls = []
        while not calls and time.time() < deadline:
            calls = self.call(action="run_read", run="s4", out=0, err=0, wait_ms=500)["bridge"]
        answer = b"abc" + b"x" * (self.agent.RELAY_ANSWER_LIMIT * 2)
        self.assertIn("Upload the answer", self.fails(
            action="run_answer", run="s4", call=calls[0]["id"], status=200,
            artifact=hashlib.sha256(answer).hexdigest()))
        digest = self.put(answer, step=self.agent.CHUNK_LIMIT)
        self.assertTrue(self.call(action="run_answer", run="s4", call=calls[0]["id"],
                                  status=200, artifact=digest)["delivered"])
        exit, stdout, _ = self.finish("s4")
        self.assertEqual(exit["code"], 0)
        self.assertEqual(stdout.decode().split(), [str(len(answer)), "abc"])
        queue = os.listdir(os.path.join(self.temp.name, "s4", "bridge"))
        self.assertFalse([name for name in queue if name.endswith(".body")])


if __name__ == "__main__":
    unittest.main()
