import { lstat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function checkScope(fixture, workspace) {
  if (!Array.isArray(fixture.allowedFiles))
    return { passed: null, errors: ['No file scope supplied.'] };
  if (!workspace) return { passed: false, errors: ['No completed workspace.'] };
  const errors = [];
  const allowed = new Set(
    [...Object.keys(fixture.files), ...fixture.allowedFiles].map((name) =>
      name.replaceAll('\\', '/'),
    ),
  );
  try {
    const walk = async (directory, prefix = '') => {
      for (const name of await readdir(directory)) {
        if (!prefix && name === '.git') continue;
        const relative = prefix + name;
        const target = path.join(directory, name);
        const stat = await lstat(target);
        if (stat.isSymbolicLink()) errors.push(`Unexpected symbolic link: ${relative}`);
        else if (stat.isDirectory()) {
          if (![...allowed].some((file) => file.startsWith(`${relative}/`)))
            errors.push(`Unexpected directory: ${relative}`);
          else await walk(target, `${relative}/`);
        } else if (!allowed.has(relative)) errors.push(`Unexpected file: ${relative}`);
      }
    };
    await walk(workspace);
    if (errors.length) return { passed: false, errors };
    for (const [name, content] of Object.entries(fixture.files)) {
      if (
        !fixture.allowedFiles.includes(name) &&
        (await readFile(path.join(workspace, name), 'utf8')) !== content
      )
        errors.push(`Protected file changed: ${name}`);
    }
  } catch (error) {
    errors.push(`Scope inspection failed: ${error.code ?? 'unknown'}`);
  }
  return { passed: errors.length === 0, errors };
}
