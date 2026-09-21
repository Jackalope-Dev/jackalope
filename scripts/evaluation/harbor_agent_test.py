import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from harbor.models.agent.context import AgentContext
from harbor.models.task.config import NetworkMode

from harbor_agent import JackalopeAgent

package_spec = importlib.util.spec_from_file_location('harbor_package', Path(__file__).with_name('harbor-package.py'))
packaging = importlib.util.module_from_spec(package_spec)
package_spec.loader.exec_module(packaging)


class FrozenSourceTests(unittest.TestCase):
    def test_missing_or_stale_compiled_fingerprint_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text('{}')
            for output, code in [('', 0), ('JACKALOPE_EVALUATION_BUILD_SHA256=' + '0' * 64, 0), ('', 101)]:
                with self.subTest(output=output, code=code), patch.object(packaging.subprocess, 'run',
                        return_value=SimpleNamespace(returncode=code, stdout=output)):
                    with self.assertRaisesRegex(ValueError, 'compiled source fingerprint'):
                        packaging.verify_build(Path(directory) / 'binary', manifest)

    def test_matching_compiled_fingerprint_is_verified_by_the_binary(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / 'manifest.json'
            manifest.write_text('{}')
            expected = packaging.digest(manifest)
            with patch.object(packaging.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout='JACKALOPE_EVALUATION_BUILD_SHA256=' + expected + '\n')) as run:
                packaging.verify_build(Path(directory) / 'binary', manifest)
                self.assertEqual(run.call_args.kwargs['env']['JACKALOPE_EXPECTED_SOURCE_SHA256'], expected)
                self.assertIn('--exact', run.call_args.args[0])

    def test_changed_native_prompt_or_packaged_runtime_rejected_before_packaging(self):
        paths = ['apps/desktop/src-tauri/src/commands/tasks/efficiency.rs',
                 'apps/desktop/src/lib/skills/context-assembler.ts',
                 'apps/desktop/src/lib/task-effort.ts', *packaging.RUNTIME_FILES]
        for name in paths:
            with self.subTest(path=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                manifest = root / 'manifest.json'
                manifest.write_text(json.dumps({name: 'frozen'}))
                with patch.object(packaging.sys, 'platform', 'linux'), \
                        patch.object(packaging, 'source_hashes', return_value={name: 'changed'}):
                    with self.assertRaisesRegex(ValueError, 'prompt source changed'):
                        packaging.package(root, root/'binary', root/'node', root/'opencode', manifest, root/'output')
                self.assertFalse((root/'output').exists())


class Environment:
    def __init__(self, mode=NetworkMode.ALLOWLIST, source_reachable=False,
                 probe_command_seconds=0, probe_error=None):
        self.network_policy = SimpleNamespace(
            network_mode=mode, allowed_hosts=['api.deepseek.com']
        )
        self.source_reachable = source_reachable
        self.probe_command_seconds = probe_command_seconds
        self.probe_error = probe_error
        self.commands = []
        self.request = None

    async def exec(self, command, **kwargs):
        self.commands.append(command)
        if command.startswith('curl '):
            if self.probe_error:
                raise self.probe_error
            if kwargs.get('timeout_sec', 0) < self.probe_command_seconds:
                raise RuntimeError('Container command timed out before returning the probe result')
        code = 0 if not command.startswith('curl ') or self.source_reachable else 28
        return SimpleNamespace(return_code=code, stdout='', stderr='')

    async def upload_file(self, source, destination):
        self.request = json.loads(Path(source).read_text())

    async def download_file(self, source, destination):
        Path(destination).write_text(json.dumps({
            'accountingComplete': False, 'status': 'review',
            'budgetStopped': False, 'elapsedMs': 100, 'usage': None,
        }))


class SourceAccessTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.agent = JackalopeAgent(
            logs_dir=Path(self.directory.name), model_name='deepseek/deepseek-v4-flash',
            payload='/private/payload.tar.gz', payload_sha256='0' * 64,
        )
        self.agent.workspace = '/prepared-repository'

    async def test_public_network_fails_before_launch_or_upload(self):
        environment = Environment(mode=NetworkMode.PUBLIC)
        with self.assertRaisesRegex(ValueError, 'network allowlist'):
            await self.agent.run('Original task', environment, AgentContext())
        self.assertEqual(environment.commands, [])
        self.assertIsNone(environment.request)

    async def test_reachable_source_host_fails_before_launch(self):
        environment = Environment(source_reachable=True)
        with self.assertRaisesRegex(ValueError, 'remains reachable'):
            await self.agent.run('Original task', environment, AgentContext())
        self.assertIsNone(environment.request)
        self.assertFalse(any('/bin/node' in command for command in environment.commands))

    async def test_dependency_mirror_allowlist_fails_before_launch(self):
        environment = Environment()
        environment.network_policy.allowed_hosts.append('proxy.golang.org')
        with self.assertRaisesRegex(ValueError, 'only supported inference API'):
            await self.agent.run('Original task', environment, AgentContext())
        self.assertEqual(environment.commands, [])
        self.assertIsNone(environment.request)

    async def test_probe_allows_container_transport_overhead_without_extending_network_deadline(self):
        environment = Environment(probe_command_seconds=10)
        await self.agent.run('Original task', environment, AgentContext())
        probes = [command for command in environment.commands if command.startswith('curl ')]
        self.assertEqual(len(probes), 6)
        self.assertTrue(all('--max-time 4' in command for command in probes))
        self.assertIsNotNone(environment.request)

    async def test_probe_transport_failure_never_becomes_a_successful_access_guard(self):
        environment = Environment(probe_error=RuntimeError('Container transport timed out'))
        with self.assertRaisesRegex(RuntimeError, 'transport timed out'):
            await self.agent.run('Original task', environment, AgentContext())
        self.assertIsNone(environment.request)
        self.assertFalse((Path(self.directory.name) / 'source-access-guard.json').exists())
        self.assertFalse(any('/bin/node' in command for command in environment.commands))

    async def test_guarded_launch_keeps_original_task_and_unknown_usage(self):
        environment = Environment()
        context = AgentContext()
        instruction = 'Original task\nwith unchanged whitespace.\n'
        await self.agent.run(instruction, environment, context)
        self.assertEqual(environment.request['instruction'], instruction)
        self.assertEqual(sum(command.startswith('curl ') for command in environment.commands), 6)
        self.assertIsNone(context.n_input_tokens)
        guard = json.loads((Path(self.directory.name) / 'source-access-guard.json').read_text())
        self.assertTrue(guard['githubBlocked'])
        launch = next(command for command in environment.commands if '/bin/node' in command)
        self.assertIn('PATH=/opt/jackalope-eval/agent-bin:$PATH', launch)
        self.assertNotIn('PATH=/opt/jackalope-eval/bin:$PATH', launch)


if __name__ == '__main__':
    unittest.main()
