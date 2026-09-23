import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { channel, origin, readNotes, releasePlan, root, sha256, version } from './catalog.mjs';

export async function publish({ receipt, notes, base, store, publicRead }) {
  const v = version(receipt.version);
  const c = channel(receipt.channel);
  origin(base);
  const current = await publicRead(`${c}/latest.json`, true);
  const previous = current?.catalog ? await publicRead(current.catalog, true) : [];
  const plan = releasePlan({ receipt, notes, base, current, previous });
  const expected = [
    `Jackalope_${v}_x64-setup.exe`,
    `Jackalope_${v}_x64-setup.exe.sig`,
    `Jackalope_${v}_x64_en-US.msi`,
    `Jackalope_${v}_x64_en-US.msi.sig`,
    'checksums.json',
  ];
  if (JSON.stringify(Object.keys(receipt.files).sort()) !== JSON.stringify(expected.sort()))
    throw new Error('Unexpected release files');
  for (const [name, hash] of Object.entries(receipt.files)) {
    const bytes = await store.read(name);
    if (!/^[a-f0-9]{64}$/.test(hash) || sha256(bytes) !== hash)
      throw new Error(`Artifact hash mismatch: ${name}`);
    await store.immutable(`${plan.directory}/${name}`, bytes);
    if (sha256(await publicRead(`${plan.directory}/${name}`)) !== hash)
      throw new Error(`Public download verification failed: ${name}`);
  }
  for (const installer of ['nsis', 'msi']) {
    const item = plan.manifest.platforms?.[`windows-x86_64-${installer}`];
    const name = `Jackalope_${v}_x64${installer === 'nsis' ? '-setup.exe' : '_en-US.msi'}`;
    if (
      item?.url !== `${base}/updates/${plan.directory}/${name}` ||
      item.signature !== (await store.read(`${name}.sig`)).toString('utf8').trim()
    )
      throw new Error('Manifest URL/signature does not match uploaded installer');
  }
  const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await store.immutable(`${plan.directory}/catalog.json`, encode(plan.releases));
  await store.immutable(`${plan.directory}/feed.xml`, Buffer.from(plan.feed));
  await store.immutable(`${plan.directory}/latest.json`, encode(plan.manifest));
  await store.put(`${c}/latest.json`, encode(plan.manifest));
  return plan;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = origin(process.env.UPDATE_BASE_URL);
  const environment = process.env.DEPLOY_ENV;
  if (!['staging', 'production'].includes(environment))
    throw new Error('Invalid deployment environment');
  const config = JSON.parse(await readFile(resolve(root, 'apps/server/wrangler.jsonc'), 'utf8'));
  const bucket = config.env[environment].r2_buckets[0].bucket_name;
  const dir = resolve(root, 'output/release');
  const receipt = JSON.parse(await readFile(resolve(dir, 'receipt.json'), 'utf8'));
  if ((environment === 'production') !== (receipt.channel === 'stable'))
    throw new Error('Stable uses production; beta uses staging');
  const notes = await readNotes(receipt.version, true);
  const fetchKey = async (key, json = false) => {
    if (
      !/^(stable|beta)\/latest\.json$/.test(key) &&
      !/^releases\/(?:beta\/)?v\d+\.\d+\.\d+\/[A-Za-z0-9_.-]+$/.test(key)
    )
      throw new Error('Invalid remote release key');
    const response = await fetch(`${base}/updates/${key}`, {
      signal: AbortSignal.timeout(120000),
      headers: { 'cache-control': 'no-cache' },
      redirect: 'error',
    });
    if (response.status === 404 && json && /^(stable|beta)\/latest\.json$/.test(key)) return null;
    if (!response.ok) throw new Error(`Download returned ${response.status} for ${key}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (json && bytes.length > 3000000) throw new Error('Catalog too large');
    return json ? JSON.parse(bytes) : bytes;
  };
  await mkdir(resolve(dir, 'upload'), { recursive: true });
  const put = async (key, bytes) => {
    const file = resolve(dir, 'upload/object');
    await writeFile(file, bytes);
    execFileSync(
      process.execPath,
      [
        resolve(root, 'apps/server/node_modules/wrangler/bin/wrangler.js'),
        'r2',
        'object',
        'put',
        `${bucket}/${key}`,
        '--file',
        file,
        '--remote',
        '--env',
        environment,
      ],
      { cwd: resolve(root, 'apps/server'), stdio: 'inherit' },
    );
  };
  const store = {
    read: (name) => readFile(resolve(dir, name)),
    put,
    immutable: async (key, bytes) => {
      const response = await fetch(`${base}/updates/${key}`, {
        signal: AbortSignal.timeout(120000),
        redirect: 'error',
      });
      if (response.status === 404) return put(key, bytes);
      if (!response.ok || sha256(Buffer.from(await response.arrayBuffer())) !== sha256(bytes))
        throw new Error(`Immutable object already exists with different bytes: ${key}`);
    },
  };
  const plan = await publish({ receipt, notes, base, store, publicRead: fetchKey });
  await writeFile(resolve(dir, 'published.json'), JSON.stringify(plan));
  console.log(
    `Published ${receipt.channel} ${receipt.version}. Allow the feed cache to expire before testing.`,
  );
}
