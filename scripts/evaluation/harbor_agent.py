import hashlib
import json
import os
import shlex
import tempfile
from pathlib import Path
from typing import Literal

from harbor.agents.base import BaseAgent
from harbor.agents.options import AgentOptions
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from pydantic import Field


class JackalopeOptions(AgentOptions):
    payload: str
    payload_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    variant: Literal["direct", "jackalope"] = "jackalope"
    agent: Literal["codex", "claude", "opencode", "antigravity"] = "opencode"
    seconds: int = Field(default=600, ge=30, le=1800)
    tokens: int = Field(default=2_000_000, ge=1000, le=10_000_000)
    provider_meter: Literal["deepseek"] | None = None
    jev_questions: bool = False


class JackalopeAgent(BaseAgent):
    options_model = JackalopeOptions

    @staticmethod
    def name() -> str:
        return "jackalope-evaluation"

    def version(self) -> str:
        return self.options.payload_sha256

    async def setup(self, environment: BaseEnvironment) -> None:
        if self.mcp_servers or self.skills_dir:
            raise ValueError("This adapter does not yet translate Harbor task MCP servers or skills.")
        if not self.model_name:
            raise ValueError("Pin an explicit model.")
        payload = Path(self.options.payload).resolve(strict=True)
        with payload.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != self.options.payload_sha256:
                raise ValueError("Evaluation payload changed after the plan was frozen.")
        await environment.upload_file(payload, "/tmp/jackalope-evaluation.tar.gz")
        result = await environment.exec(
            "mkdir -p /opt/jackalope-eval && tar -xzf /tmp/jackalope-evaluation.tar.gz -C /opt/jackalope-eval",
            timeout_sec=180,
        )
        if result.return_code:
            raise RuntimeError(f"Payload setup failed: {result.stderr}")
        result = await environment.exec("pwd -P", timeout_sec=10)
        self.workspace = (result.stdout or "").strip()
        if result.return_code or not self.workspace.startswith("/") or self.workspace == "/":
            raise ValueError("Task must provide a repository working directory below the filesystem root.")
        result = await environment.exec(
            "git rev-parse --show-toplevel", cwd=self.workspace, timeout_sec=10
        )
        if result.return_code:
            raise ValueError("Pilot adapter requires a prepared Git repository; it does not rewrite task fixtures.")
        if (result.stdout or "").strip() != self.workspace:
            raise ValueError("Task working directory must be its repository root.")
        result = await environment.exec(
            "git switch -c jackalope-evaluation && "
            "git config jackalope.commitPolicy "
            + shlex.quote(json.dumps({"attribution": "user", "cleanupAfterMerge": False, "autoCheckpoint": False})),
            cwd=self.workspace,
            timeout_sec=10,
        )
        if result.return_code:
            raise RuntimeError(f"Could not prepare matching evaluation branches: {result.stderr}")
        result = await environment.exec(
            "/opt/jackalope-eval/bin/jackalope-test --list >/dev/null && "
            "/opt/jackalope-eval/bin/node --version && "
            "/opt/jackalope-eval/bin/" + shlex.quote(self.options.agent) + " --version",
            timeout_sec=30,
        )
        if result.return_code:
            raise RuntimeError(f"Runner preflight failed: {result.stderr}")
        (self.logs_dir / "runner-versions.txt").write_text(result.stdout or "")

    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        config = {
            "id": self.session_id,
            "variant": self.options.variant,
            "agent": self.options.agent,
            "model": self.model_name,
            "instruction": instruction,
            "workspace": self.workspace,
            "seconds": self.options.seconds,
            "tokens": self.options.tokens,
            "providerMeter": self.options.provider_meter,
            "jevQuestions": self.options.jev_questions,
        }
        with tempfile.TemporaryDirectory(prefix="jackalope-harbor-") as directory:
            request = Path(directory) / "request.json"
            request.write_text(json.dumps(config))
            await environment.upload_file(request, "/tmp/jackalope-evaluation-request.json")
        env = {
            "JACKALOPE_QUALITY_BINARY": "/opt/jackalope-eval/bin/jackalope-test",
            "OPENCODE_DISABLE_AUTOUPDATE": "true",
        }
        if self.options.provider_meter:
            env["DEEPSEEK_API_KEY"] = os.environ["DEEPSEEK_API_KEY"]
        if self.options.jev_questions:
            env["JACKALOPE_JEV_TEST_KEY"] = os.environ["JACKALOPE_JEV_TEST_KEY"]
        log_dir = str(self.environment_logs_dir)
        result = await environment.exec(
            "export PATH=/opt/jackalope-eval/bin:$PATH; "
            "/opt/jackalope-eval/bin/node /opt/jackalope-eval/source/scripts/evaluation/harbor-run.mjs "
            "/tmp/jackalope-evaluation-request.json " + shlex.quote(log_dir),
            cwd=self.workspace,
            env=env,
            timeout_sec=self.options.seconds + 120,
        )
        (self.logs_dir / "launcher.log").write_text((result.stdout or "") + "\n" + (result.stderr or ""))
        report_file = self.logs_dir / "jackalope-result.json"
        await environment.download_file(log_dir + "/jackalope-result.json", report_file)
        report = json.loads(report_file.read_text())
        context.metadata = {
            "variant": self.options.variant,
            "payload_sha256": self.options.payload_sha256,
            "accounting_complete": report["accountingComplete"],
            "status": report["status"],
            "budget_stopped": report["budgetStopped"],
            "elapsed_ms": report["elapsedMs"],
        }
        if report["accountingComplete"] and report["usage"]:
            context.n_input_tokens = report["usage"]["input"]
            context.n_cache_tokens = report["usage"]["cacheRead"]
            context.n_output_tokens = report["usage"]["output"]
        if result.return_code:
            raise RuntimeError("Native launcher failed; retained launcher and native logs contain diagnostics.")
