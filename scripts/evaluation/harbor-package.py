import argparse
import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def source_hashes(source):
    files = subprocess.check_output(['git', '-C', str(source), 'ls-files', '-co', '--exclude-standard', '-z']).decode().split('\0')
    return {name: digest(source / name) for name in sorted(set(filter(None, files))) if (source / name).is_file()}


def package(source, binary, node, opencode, manifest, destination):
    if sys.platform != 'linux':
        raise ValueError('The current Harbor payload targets Linux containers.')
    if destination.exists():
        raise ValueError('Use a new output directory; existing receipts are never overwritten.')
    frozen = json.loads(manifest.read_text())
    native = lambda files: {name: value for name, value in files.items() if name.startswith(('apps/desktop/src-tauri/', 'patches/'))}
    if native(source_hashes(source)) != native(frozen):
        raise ValueError('Native source changed since the build snapshot; freeze and rebuild.')
    destination.mkdir(parents=True)
    payload = destination / 'payload'
    (payload / 'bin').mkdir(parents=True)
    (payload / 'lib').mkdir()
    shutil.copyfile(binary, payload / 'jackalope-native')
    (payload / 'jackalope-native').chmod(0o755)
    libraries = subprocess.check_output(['ldd', str(binary)], text=True)
    if 'not found' in libraries:
        raise ValueError('Native runner has unresolved libraries.')
    for line in libraries.splitlines():
        match = re.search(r'(/[^\s]+)', line)
        if match and pathlib.Path(match[1]).is_file():
            library = pathlib.Path(match[1])
            shutil.copyfile(library, payload / 'lib' / library.name)
    loader = payload / 'lib/ld-linux-x86-64.so.2'
    if not loader.is_file():
        raise ValueError('Current payload packaging supports Linux x86_64 only.')
    loader.chmod(0o755)
    wrapper = payload / 'bin/jackalope-test'
    wrapper.write_text('#!/bin/sh\nexec /opt/jackalope-eval/lib/ld-linux-x86-64.so.2 --library-path /opt/jackalope-eval/lib /opt/jackalope-eval/jackalope-native "$@"\n')
    wrapper.chmod(0o755)
    for name, binary_path in [('node', node), ('opencode', opencode)]:
        shutil.copyfile(binary_path, payload / 'bin' / name)
        (payload / 'bin' / name).chmod(0o755)
    files = [
        'scripts/evaluation/harbor-run.mjs', 'scripts/evaluation/attempts.mjs',
        'scripts/evaluation/experiments.mjs', 'scripts/evaluation/provider-meter.mjs',
        'apps/desktop/src/lib/task-effort.ts', 'apps/desktop/src-tauri/src/commands/experiments.json',
    ]
    for name in files:
        target = payload / 'source' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
    shutil.copytree(source / 'apps/desktop/src/lib/skills', payload / 'source/apps/desktop/src/lib/skills')
    shutil.copyfile(manifest, payload / 'source-manifest.json')
    artifact = destination / 'payload.tar.gz'
    with tarfile.open(artifact, 'w:gz') as stream:
        for file in sorted(payload.iterdir()):
            stream.add(file, arcname=file.name)
    provenance = {
        'payloadSha256': digest(artifact),
        'nativeBinarySha256': digest(binary),
        'sourceManifestSha256': digest(manifest),
        'files': {str(p.relative_to(payload)): digest(p) for p in sorted(payload.rglob('*')) if p.is_file()},
    }
    (destination / 'manifest.json').write_text(json.dumps(provenance, indent=2))
    print(json.dumps({'payload': str(artifact), 'sha256': provenance['payloadSha256']}))


if __name__ == '__main__':
    source = pathlib.Path(__file__).resolve().parents[2]
    if len(sys.argv) == 3 and sys.argv[1] == 'freeze':
        with pathlib.Path(sys.argv[2]).open('x') as stream:
            json.dump(source_hashes(source), stream, indent=2)
        sys.exit(0)
    parser = argparse.ArgumentParser(description='Package a prebuilt native test runner for private Harbor evaluations.')
    for name in ['binary', 'node', 'opencode', 'source-manifest', 'output']:
        parser.add_argument('--' + name, type=pathlib.Path, required=True)
    args = parser.parse_args()
    package(source, args.binary.resolve(strict=True),
            args.node.resolve(strict=True), args.opencode.resolve(strict=True),
            args.source_manifest.resolve(strict=True), args.output.resolve())
