// Names the computer image that .github/workflows/computer-image.yml publishes.
// The repository and the definition files come from the desktop source, so the
// app (commands/computers/image.rs) and the workflow cannot disagree.
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isMain } from '../lib/cli.mjs';
import { root } from './catalog.mjs';

const tauri = resolve(root, 'apps/desktop/src-tauri');
export const imageDirectory = resolve(tauri, 'resources/computer');

/** Reads `pattern`'s first group from a source file, failing loudly when it moved. */
async function sourceValue(path, pattern) {
  const match = (await readFile(resolve(tauri, path), 'utf8')).match(pattern);
  if (!match) throw new Error(`${path} no longer matches ${pattern}`);
  return match[1];
}

export const repository = () =>
  sourceValue('src/commands/computers/image.rs', /const REPOSITORY: &str = "([^"]+)";/);

export const appVersion = () => sourceValue('Cargo.toml', /^version = "([^"]+)"$/m);

export async function imageFiles() {
  const list = await sourceValue(
    'src/commands/computers/docker.rs',
    /const IMAGE_FILES: &\[&str\] = &\[([^\]]+)\];/,
  );
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Mirrors docker::image_tag: each file's name, its length as a little-endian u64, then its bytes. */
export function definitionDigest(files) {
  const hash = createHash('sha256');
  for (const [name, bytes] of files) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64LE(BigInt(bytes.length));
    hash.update(Buffer.from(name, 'utf8'));
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0, 12);
}

/** Mirrors image::reference: characters a tag cannot hold become `-`. */
export const tag = (value) => value.replace(/[^A-Za-z0-9_.-]/g, '-');

export function tags({ repository, version, definition, sha }) {
  return [
    `${repository}:${tag(`${version}-${definition}`)}`,
    `${repository}:${tag(version)}`,
    `${repository}:sha-${sha.slice(0, 12)}`,
  ];
}

export async function plan(sha) {
  const names = await imageFiles();
  const files = await Promise.all(
    names.map(async (name) => [name, await readFile(resolve(imageDirectory, name))]),
  );
  const values = {
    repository: await repository(),
    version: await appVersion(),
    definition: definitionDigest(files),
    sha,
  };
  return { ...values, tags: tags(values) };
}

if (isMain(import.meta)) {
  const sha = process.env.GITHUB_SHA;
  if (!/^[0-9a-f]{40}$/.test(sha ?? '')) throw new Error('GITHUB_SHA must be a commit SHA');
  const result = await plan(sha);
  const lines = [
    `repository=${result.repository}`,
    `version=${result.version}`,
    `definition=${result.definition}`,
    `tags=${result.tags.join(' ')}`,
  ];
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
}
