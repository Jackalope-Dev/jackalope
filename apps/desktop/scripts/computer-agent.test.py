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
    # No agent-browser here unless a test provides one.
    os.environ["JACKALOPE_AGENT_BROWSER_HOME"] = os.path.join(runs, "no-agent-browser")
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


class SharedProtocol(Harness):
    def test_named_keys_have_an_xdotool_name(self):
        self.assertEqual(set(self.agent.KEYS), set(self.agent.SHARED["namedKeys"]))

    def test_local_routes_name_served_tools(self):
        served = set(self.agent.WORKSPACE_TOOLS) | set(self.agent.BROWSER_TOOLS)
        self.assertTrue(set(self.agent.LOCAL_ROUTES.values()) <= served)

    def test_failures_carry_a_shared_code(self):
        codes = {self.agent.FAILED, self.agent.UNSUPPORTED, self.agent.PERMANENT}
        self.assertEqual(codes, set(self.agent.SHARED["errorCodes"]))
        missing = self.agent.respond({"id": 1, "action": "artifact_get", "sha256": "0" * 64})
        self.assertEqual((missing["ok"], missing["code"]), (False, self.agent.PERMANENT))
        invalid = self.agent.respond({"id": 2, "action": "artifact_get", "sha256": "x"})
        self.assertEqual((invalid["ok"], invalid["code"]), (False, self.agent.FAILED))


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
                          "capabilities": self.agent.capabilities(),
                          "slots": self.agent.slots()})
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

    def test_uv_is_pinned_and_a_mismatched_download_is_refused(self):
        agent = self.agent
        self.assertRegex(agent.UV_VERSION, r"^\d+\.\d+\.\d+$")
        self.assertEqual(sorted(agent.UV_SHA256), ["aarch64", "x86_64"])
        for digest in agent.UV_SHA256.values():
            self.assertRegex(digest, r"^[0-9a-f]{64}$")
        good = archive({"uv-x86_64-unknown-linux-gnu/uv": b"#!/bin/sh\n",
                        "uv-x86_64-unknown-linux-gnu/uvx": b"#!/bin/sh\n"})
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as bundle:
            with tarfile.open(fileobj=io.BytesIO(good)) as source:
                for member in source.getmembers():
                    bundle.addfile(member, source.extractfile(member))
        good = buffer.getvalue()
        fetched = []

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.close()

        def fake_open(url, timeout=None):
            fetched.append(url)
            return Response(good)

        local = os.path.join(self.temp.name, "uv-home")
        machine = agent.platform.machine
        urlopen = agent.urllib.request.urlopen
        try:
            agent.LOCAL_PREFIX = local
            agent.platform.machine = lambda: "x86_64"
            agent.urllib.request.urlopen = fake_open
            # The real recorded hash does not match this stand-in archive.
            with self.assertRaises(agent.Failure) as refused:
                agent.install_uv()
            self.assertIn("did not match", str(refused.exception))
            self.assertFalse(os.path.exists(os.path.join(local, "bin", "uv")))
            self.assertEqual(fetched, [
                f"https://github.com/astral-sh/uv/releases/download/{agent.UV_VERSION}/"
                "uv-x86_64-unknown-linux-gnu.tar.gz"])
            # Only the archive is fetched: no published checksum is trusted.
            agent.UV_SHA256 = dict(agent.UV_SHA256, x86_64=hashlib.sha256(good).hexdigest())
            agent.install_uv()
            self.assertEqual(len(fetched), 2)
            for name in ("uv", "uvx"):
                self.assertTrue(os.access(os.path.join(local, "bin", name), os.X_OK))
            agent.UV_LIMIT = len(good) - 1
            with self.assertRaises(agent.Failure):
                agent.install_uv()
            agent.platform.machine = lambda: "riscv64"
            with self.assertRaises(agent.Failure):
                agent.install_uv()
        finally:
            agent.platform.machine = machine
            agent.urllib.request.urlopen = urlopen

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


AGENT_SCRIPT = """
import json, os, urllib.request
url = os.environ['JACKALOPE_BRIDGE_URL']
token = os.environ['JACKALOPE_BRIDGE_TOKEN']
def call(name, arguments, number):
    body = json.dumps({'jsonrpc': '2.0', 'id': number, 'method': 'tools/call',
                       'params': {'name': name, 'arguments': arguments}}).encode()
    request = urllib.request.Request(url + '/mcp', data=body, method='POST', headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    return json.loads(urllib.request.urlopen(request).read())
verify = call('computer_verify', {}, 1)['result']
print('verify', verify['isError'], verify['structuredContent']['success'],
      verify['structuredContent']['stdout'].strip())
again = call('computer_verify', {}, 2)['result']['structuredContent']
print('reused', again['reused'])
output = call('verification_output', {}, 3)['result']['structuredContent']
print('output', output['text'].strip())
read = call('read_context', {'blocks': [{'path': 'a.txt', 'lines': 1}]}, 4)['result']
print('read', read['structuredContent']['blocks'][0]['text'].strip())
other = call('computer_verify', {'command': 'rm -rf /'}, 5)['result']
print('refused', other['isError'])
print('route', os.environ.get('JACKALOPE_POLICY_ROUTE'))
print('ask', json.dumps(call('ask_user', {'question': 'q'}, 6)['result']))
"""


class Runner(unittest.TestCase):
    """Runs protocol 4: capabilities, the local bridge and policy callbacks."""

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

    def upload(self, run, files):
        data = archive(files)
        return self.call(action="workspace_put", run=run, offset=0,
                         data=base64.b64encode(data).decode(), final=True,
                         sha256=hashlib.sha256(data).hexdigest())

    def drive(self, run, answer):
        """Reads the run to its end, answering each relayed bridge call."""
        out = err = 0
        stdout = b""
        calls = []
        deadline = time.time() + 60
        while time.time() < deadline:
            page = self.call(action="run_read", run=run, out=out, err=err, wait_ms=300)
            stdout += base64.b64decode(page["stdout"])
            out, err = page["out"], page["err"]
            for call in page["bridge"]:
                calls.append(call)
                status, body = answer(call)
                self.call(action="run_answer", run=run, call=call["id"], status=status,
                          contentType="application/json",
                          body=base64.b64encode(json.dumps(body).encode()).decode())
            if page["exit"] is not None:
                return page["exit"], stdout.decode(), calls
        self.fail("The run did not finish.")

    def test_capabilities_are_reported_with_the_protocol(self):
        # Without agent-browser, the browser capability is not reported.
        self.assertEqual(self.agent.capabilities(),
                         [name for name in self.agent.CAPABILITIES if name != "browser"])
        status = self.call(action="run_status", run="c1")
        self.assertEqual((status["runs"], status["capabilities"]),
                         (self.agent.RUNS_PROTOCOL, self.agent.capabilities()))

    def test_slots_follow_the_machine_size_unless_overridden(self):
        agent = self.agent
        gib = 1024 ** 3
        for cpus, memory, expected in [
            (1, 2 * gib, 1),      # the smallest machine still takes one run
            (2, 4 * gib, 1),
            (4, 16 * gib, 2),     # two per CPU pair
            (16, 8 * gib, 2),     # memory limits it
            (8, int(31.4 * gib), 4),  # reported memory rounds to whole GiB
            (64, 256 * gib, 8),   # derived values stop at eight
            (6, 0, 3),            # unknown memory limits nothing
        ]:
            self.assertEqual(agent.slots_for(cpus, memory), expected, (cpus, memory))
        # Container limits apply over the host's size.
        cgroup = os.path.join(self.temp.name, "cgroup")
        os.makedirs(cgroup)
        open(os.path.join(cgroup, "cpu.max"), "w").write("200000 100000\n")
        open(os.path.join(cgroup, "memory.max"), "w").write(f"{8 * gib}\n")
        agent.CGROUP = cgroup
        cpus, memory = agent.machine_size()
        self.assertLessEqual(cpus, 2)
        self.assertLessEqual(memory, 8 * gib)
        open(os.path.join(cgroup, "cpu.max"), "w").write("max 100000\n")
        open(os.path.join(cgroup, "memory.max"), "w").write("max\n")
        self.assertGreaterEqual(agent.machine_size()[0], 1)
        # cgroup v1 on older hosts.
        legacy = os.path.join(self.temp.name, "cgroup-v1")
        os.makedirs(os.path.join(legacy, "cpu"))
        os.makedirs(os.path.join(legacy, "memory"))
        open(os.path.join(legacy, "cpu", "cpu.cfs_quota_us"), "w").write("100000\n")
        open(os.path.join(legacy, "cpu", "cpu.cfs_period_us"), "w").write("100000\n")
        open(os.path.join(legacy, "memory", "memory.limit_in_bytes"), "w").write(f"{2 * gib}\n")
        agent.CGROUP = legacy
        cpus, memory = agent.machine_size()
        self.assertEqual(cpus, 1)
        self.assertLessEqual(memory, 2 * gib)
        open(os.path.join(legacy, "cpu", "cpu.cfs_quota_us"), "w").write("-1\n")
        self.assertGreaterEqual(agent.machine_size()[0], 1)
        agent.CGROUP = cgroup
        derived = agent.slots_for(*agent.machine_size())
        old = os.environ.pop("JACKALOPE_RUNNER_SLOTS", None)
        try:
            self.assertEqual(agent.slots(), derived)
            status = self.call(action="run_status", run="c2")
            self.assertEqual(status["slots"], derived)
            os.environ["JACKALOPE_RUNNER_SLOTS"] = "12"
            self.assertEqual(agent.slots(), 12)
            self.assertEqual(self.call(action="run_status", run="c2")["slots"], 12)
            for bad in ("0", "33", "-2", "two", "1.5", ""):
                os.environ["JACKALOPE_RUNNER_SLOTS"] = bad
                self.assertEqual(agent.slots(), derived, bad)
        finally:
            os.environ.pop("JACKALOPE_RUNNER_SLOTS", None)
            if old is not None:
                os.environ["JACKALOPE_RUNNER_SLOTS"] = old

    def test_local_requests_are_validated(self):
        spec = self.agent.local_spec
        self.assertIsNone(spec(None))
        self.assertEqual(spec({"tools": ["computer_verify", "browser_tabs", "computer_verify"],
                               "check": "make test"}),
                         {"tools": ["computer_verify"], "check": "make test"})
        for bad in ({"tools": ["ask_user"]}, {"tools": "computer_verify"}, [],
                    {"tools": [], "check": " "}, {"tools": [], "check": "x" * 4001}):
            with self.assertRaises(self.agent.Failure):
                spec(bad)

    def test_workspace_tools_run_here_and_control_tools_are_relayed(self):
        self.upload("l1", {"a.txt": b"first line\nsecond\n"})
        started = self.call(
            action="run_start", run="l1", argv=[sys.executable, "-c", AGENT_SCRIPT],
            env={"JACKALOPE_BRIDGE_URL": self.agent.RELAY_URL,
                 "JACKALOPE_BRIDGE_TOKEN": self.agent.RELAY_TOKEN},
            relay=True, local={"tools": ["computer_verify", "verification_output", "read_context",
                                         "browser_navigate"], "check": "echo checked"})
        # The browser tools are dropped where agent-browser is missing.
        self.assertEqual(started["local"]["tools"],
                         ["computer_verify", "verification_output", "read_context"])

        def answer(call):
            if call["path"] == "/v1/runner/event":
                return 200, {"recorded": True}
            request = json.loads(base64.b64decode(call["body"]))
            return 200, {"jsonrpc": "2.0", "id": request["id"],
                         "result": {"content": [{"type": "text", "text": "answered"}]}}

        exit, stdout, calls = self.drive("l1", answer)
        self.assertEqual(exit["code"], 0, stdout)
        lines = stdout.splitlines()
        self.assertEqual(lines[0], "verify False True checked")
        self.assertEqual(lines[1], "reused True")
        self.assertEqual(lines[2], "output checked")
        self.assertEqual(lines[3], "read first line")
        self.assertEqual(lines[4], "refused True")
        self.assertEqual(lines[5], "route /v1/policy")
        self.assertIn("answered", lines[6])
        # Only the control tool reached the device's queue, besides the runner's events.
        relayed = [json.loads(base64.b64decode(call["body"])) for call in calls
                   if call["path"] == "/mcp"]
        self.assertEqual([request["params"]["name"] for request in relayed], ["ask_user"])
        events = [json.loads(base64.b64decode(call["body"])) for call in calls
                  if call["path"] == "/v1/runner/event"]
        self.assertTrue(events)
        self.assertTrue(all(event["tool"] == "computer_verify" for event in events))
        self.assertEqual(events[0]["check"]["success"], True)
        # The stored check stays outside the workspace, so it is not in the patch.
        self.assertNotIn("verification.json", self.call(action="workspace_diff", run="l1")["files"])

    def test_policy_allows_only_an_explicit_allow(self):
        directory = os.path.join(self.temp.name, "p1")
        os.makedirs(os.path.join(directory, "bridge"))
        runner = self.agent.Runner(directory, directory, {"tools": [], "check": None})
        answers = []
        seen = []

        def answering():
            queue = os.path.join(directory, "bridge")
            while answers:
                for name in os.listdir(queue):
                    if name.endswith(".req"):
                        request = json.load(open(os.path.join(queue, name)))
                        seen.append((request["path"], json.loads(base64.b64decode(request["body"]))))
                        status, body = answers.pop(0)
                        with open(os.path.join(queue, name[:-4] + ".res"), "w") as handle:
                            json.dump({"status": status, "contentType": "application/json",
                                       "body": base64.b64encode(json.dumps(body).encode()).decode()},
                                      handle)
                time.sleep(0.02)

        import threading
        for status, body, expected in (
            (200, {"behavior": "allow"}, True),
            (200, {"behavior": "deny", "message": "Not that site."}, False),
            (200, {"behavior": "Allow"}, False),
            (400, {"error": "Ask about a tool, site or secret."}, False),
            (200, ["allow"], False),
        ):
            answers.append((status, body))
            worker = threading.Thread(target=answering)
            worker.start()
            allowed, message = runner.policy("site", url="https://example.com/", host="example.com")
            worker.join()
            self.assertEqual(allowed, expected, body)
            if not expected:
                self.assertTrue(message)
        self.assertEqual(seen[0], ("/v1/policy", {"kind": "site", "url": "https://example.com/",
                                                  "host": "example.com"}))
        # No answer in time, or no run at all, denies.
        self.agent.APPROVAL_SECONDS = 0.3
        allowed, message = runner.policy("tool", tool_name="mcp__x__y", input={})
        self.assertFalse(allowed)
        self.assertIn("could not be asked", message)
        queue = os.path.join(directory, "bridge")
        for name in os.listdir(queue):
            os.unlink(os.path.join(queue, name))
        os.rmdir(queue)
        self.assertFalse(runner.policy("secret", name="API_KEY")[0])

    def test_sites_are_asked_about_except_this_computers_own(self):
        asked = []
        verdicts = {"example.com": (True, None), "blocked.example": (False, "Declined.")}

        class Stub:
            allowed_sites = set()

            def policy(self, kind, **fields):
                asked.append((kind, fields["host"], fields["login"]))
                return verdicts[fields["host"]]

        browser = self.agent.Browser(Stub())
        for url in ("http://localhost:5173/", "http://127.0.0.1:8080/x", "about:blank",
                    "file:///home/bot/a.html", ""):
            browser.site(url)
        self.assertEqual(asked, [])
        browser.site("https://example.com/a")
        browser.site("https://EXAMPLE.com/b")
        self.assertEqual(asked, [("site", "example.com", False)])
        # A page asking for a password is always asked about.
        browser.site("https://example.com/login", login=True)
        self.assertEqual(len(asked), 2)
        with self.assertRaises(self.agent.Failure) as raised:
            browser.site("https://blocked.example/")
        self.assertEqual(str(raised.exception), "Declined.")

    def test_screenshots_are_saved_in_the_workspace(self):
        workspace = os.path.join(self.temp.name, "w")
        os.makedirs(workspace)
        events = []
        png = (b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (640).to_bytes(4, "big")
               + (480).to_bytes(4, "big") + b"\x08\x06\x00\x00\x00")

        class Stub:
            def __init__(self):
                self.workspace = workspace

            def notify(self, event):
                events.append(event)

        browser = self.agent.Browser(Stub())
        browser.directory = os.path.join(self.temp.name, "session")
        os.makedirs(browser.directory)

        def send(request):
            if request["action"] == "url":
                return {"url": "http://localhost:3000/"}
            if request["action"] == "screenshot":
                self.assertTrue(request["fullPage"])
                open(request["path"], "wb").write(png)
                return {}
            self.fail(request)

        browser.send = send
        browser.guarded = lambda target, work: work()
        artifact = browser.screenshot({"name": "Home"})
        relative = os.path.join(".jackalope", "artifacts", "screenshots", artifact["id"] + ".png")
        self.assertEqual(artifact["relativePath"], relative)
        self.assertEqual(artifact["filePath"], os.path.join(workspace, relative))
        self.assertEqual(open(artifact["filePath"], "rb").read(), png)
        self.assertEqual((artifact["width"], artifact["height"], artifact["name"]), (640, 480, "Home"))
        self.assertEqual(os.listdir(browser.directory), [])
        self.assertEqual(events[0]["screenshot"]["relativePath"], relative)
        self.assertNotIn("filePath", events[0]["screenshot"])

    def test_screenshots_come_back_even_when_ignored(self):
        self.upload("s1", {".gitignore": b".jackalope/\n", "a.txt": b"x"})
        script = ("import os;d='.jackalope/artifacts/screenshots';os.makedirs(d);"
                  "open(d+'/0f8fad5b-d9cb-469f-a165-70867728950e.png','wb').write(b'png');"
                  "open('.jackalope/other.txt','w').write('kept out')")
        self.call(action="run_start", run="s1", argv=[sys.executable, "-c", script])
        self.drive("s1", lambda call: (500, {}))
        files = self.call(action="workspace_diff", run="s1")["files"]
        self.assertEqual(files, [".jackalope/artifacts/screenshots/0f8fad5b-d9cb-469f-a165-70867728950e.png"])

    def test_source_reads_stay_inside_the_workspace(self):
        workspace = os.path.join(self.temp.name, "src")
        os.makedirs(workspace)
        open(os.path.join(workspace, "a.ts"), "w").write("export const a = 1;\nexport const b = 2;\n")
        runner = self.agent.Runner(os.path.join(self.temp.name, "d"), workspace,
                                   {"tools": ["read_context"], "check": None})
        first = runner.read_context({"blocks": [{"path": "a.ts", "startLine": 1, "lines": 1}]})
        block = first["blocks"][0]
        self.assertEqual((block["text"], block["nextLine"], block["endLine"]),
                         ("export const a = 1;\n", 2, 1))
        same = runner.read_context({"blocks": [{"path": "a.ts", "startLine": 1, "lines": 1,
                                                 "knownHash": block["blockHash"]}]})["blocks"][0]
        self.assertTrue(same["unchanged"])
        self.assertIsNone(same["text"])
        open(os.path.join(workspace, "a.ts"), "w").write("export const a = 3;\n")
        changed = runner.read_context({"blocks": [{"path": "a.ts", "startLine": 1, "lines": 1,
                                                    "knownHash": block["blockHash"]}]})["blocks"][0]
        self.assertFalse(changed["unchanged"])
        for path in ("../a.ts", ".env", "C:/a.ts", "a.ts:stream", "\\a.ts", "/etc/passwd.txt", "a.bin"):
            result = runner.read_context({"blocks": [{"path": path}]})
            self.assertIn("error", result["blocks"][0], path)
        with self.assertRaises(self.agent.Failure):
            runner.read_context({})

    def test_declarations_are_found_in_common_languages(self):
        found = lambda language, text: [(s["name"], s["line"], s["kind"])
                                        for s in self.agent.declarations(language, text)]
        self.assertEqual(found("rust", "\n".join([
            "pub(crate) async fn load_rows() {}",
            "struct Row;", "pub enum Kind {}", "trait Store {}", "type Id = u64;",
            "const LIMIT: usize = 4;", "pub const fn tiny() {}", "    fn method(&self) {}",
            "// fn commented() {}", "impl Row {}",
        ])), [("load_rows", 1, "function"), ("Row", 2, "struct"), ("Kind", 3, "enum"),
              ("Store", 4, "interface"), ("Id", 5, "type"), ("LIMIT", 6, "binding"),
              ("tiny", 7, "function"), ("method", 8, "function")])
        self.assertEqual(found("script", "\n".join([
            "export async function fetchRows() {", "  if (x) {", "  }", "}",
            "export default class Grid {", "  private render(row: Row): void {", "  }", "}",
            "export interface Props {}", "type Mode<T> = T;", "export const enum Side {}",
            "export const useGrid = () => 1;", "let count: number;",
        ])), [("fetchRows", 1, "function"), ("Grid", 5, "class"), ("render", 6, "method"),
              ("Props", 9, "interface"), ("Mode", 10, "type"), ("Side", 11, "enum"),
              ("useGrid", 12, "binding"), ("count", 13, "binding")])
        self.assertEqual(found("python", "\n".join([
            "LIMIT = 3", "class Store:", "    def load(self):", "        def inner():",
            "            pass", "async def main():", "    value = 1", "x == 2",
        ])), [("LIMIT", 1, "binding"), ("Store", 2, "class"), ("load", 3, "method"),
              ("inner", 4, "function"), ("main", 6, "function")])
        self.assertEqual(found("go", "\n".join([
            "func Load() error {", "func (s *Store) Save() {", "type Store struct {",
            "\tName string", "}", "type (", "\tReader interface {", "\t\tRead()", "\t}",
            "\tID int", ")", "const (", "\tA = 1", "\tB", ")", "var Default = 3",
        ])), [("Load", 1, "function"), ("Save", 2, "method"), ("Store", 3, "struct"),
              ("Reader", 7, "interface"), ("ID", 10, "type"), ("A", 13, "binding"),
              ("B", 14, "binding"), ("Default", 16, "binding")])
        many = "\n".join(f"fn f{i}() {{}}" for i in range(100))
        self.assertEqual(len(self.agent.declarations("rust", many)), self.agent.FILE_SYMBOLS)

    def test_repository_search_ranks_declarations_above_plain_text(self):
        workspace = os.path.join(self.temp.name, "repo")
        files = {
            "src/billing.rs": "pub fn compute_invoice() {}\n",
            "src/notes.md": "We compute the invoice by hand here.\n",
            "src/view.ts": "export const label = 'compute invoice';\n",
            "src/invoice.py": "def total():\n    pass\n",
            "node_modules/pkg/compute_invoice.js": "function computeInvoice() {}\n",
            "README.md": "unrelated\n",
        }
        for name, text in files.items():
            os.makedirs(os.path.dirname(os.path.join(workspace, name)), exist_ok=True)
            open(os.path.join(workspace, name), "w").write(text)
        subprocess.run(["git", "init", "-q", workspace], check=True)
        runner = self.agent.Runner(os.path.join(self.temp.name, "d"), workspace,
                                   {"tools": ["read_context"], "check": None})
        result = runner.read_context({"query": "compute invoice"})["candidates"]
        paths = [item["path"] for item in result["items"]]
        self.assertEqual(result["ranking"], "symbols")
        self.assertFalse(result["scanTruncated"])
        # The declaration first, then the path match, then files that only say it.
        self.assertEqual(paths[:2], ["src/billing.rs", "src/invoice.py"])
        self.assertEqual(result["items"][0]["symbols"],
                         [{"name": "compute_invoice", "line": 1, "kind": "function"}])
        text = [item for item in result["items"] if item.get("match") == "text"]
        self.assertEqual({item["path"] for item in text}, {"src/notes.md", "src/view.ts"})
        self.assertEqual(paths[2:], [item["path"] for item in text])
        self.assertEqual(text[0]["line"], 1)
        self.assertNotIn("node_modules/pkg/compute_invoice.js", paths)
        self.assertNotIn("README.md", paths)
        # The same scoring as this device's ranking.
        ranked = self.agent.search_rank("quota reset", ["Tasks and preferences",
                                                        "Check the quota reset time"])
        self.assertEqual(ranked[0][0], 1)
        self.assertEqual(self.agent.search_rank("the", ["the task"]), [])
        self.assertEqual(self.agent.search_rank("cat", ["concatenate"]), [])
        # An edit is seen on the next query; the file limit marks the scan truncated.
        open(os.path.join(workspace, "src/notes.md"), "w").write("fn x\n")
        open(os.path.join(workspace, "src/view.ts"), "w").write(
            "export function computeInvoiceView() {}\n")
        # Like this device's ranking, a camelCase name is one word.
        again = runner.read_context({"query": "computeInvoiceView"})["candidates"]
        self.assertEqual(again["items"][0]["path"], "src/view.ts")
        self.agent.SEARCH_FILES = 2
        self.assertTrue(runner.read_context({"query": "invoice"})["candidates"]["scanTruncated"])

    def test_stored_check_output_pages_by_character(self):
        directory = os.path.join(self.temp.name, "v")
        os.makedirs(directory)
        runner = self.agent.Runner(directory, directory, {"tools": [], "check": "x"})
        with self.assertRaises(self.agent.Failure):
            runner.verification_output({})
        json.dump({"command": "x", "checked_at": "c1", "tree": None, "result": {
            "exitCode": 1, "success": False, "timedOut": False, "truncated": False,
            "durationMs": 3, "stdout": "one\U0001F98Atwo", "stderr": "bad"}},
            open(os.path.join(directory, "verification.json"), "w"))
        page = runner.verification_output({"check_id": "c1", "offset": 3, "limit": 1})
        self.assertEqual((page["text"], page["next_offset"]), ("\U0001F98A", 4))
        self.assertEqual(runner.verification_output({"stream": "stderr"})["text"], "bad")
        for bad in ({"check_id": "older"}, {"offset": 1}, {"stream": "both"}):
            with self.assertRaises(self.agent.Failure):
                runner.verification_output(bad)

    def test_checks_stop_when_they_go_quiet(self):
        self.agent.CHECK_STALL = 1
        workspace = os.path.join(self.temp.name, "q")
        os.makedirs(workspace)
        result = self.agent.run_check("echo start; sleep 30", workspace)
        self.assertTrue(result["timedOut"])
        self.assertFalse(result["success"])
        self.assertIsNone(result["exitCode"])
        self.assertIn("start", result["stdout"])


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
        # Jackalope applies only the agent's work, compared with what it sent.
        self.assertEqual(result["snapshot"], snapshot)
        changed = git(path, "diff", "--name-status", "--no-renames", snapshot, result["result"])
        self.assertEqual(sorted(changed.splitlines()), ["A\tb.txt", "M\ta.txt"])
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
