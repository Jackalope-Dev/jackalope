import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Whether the module that passes its `import.meta` is the script Node was started with. */
export function isMain(meta) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(meta.url);
}

/**
 * `--name value` / `--name=value` options and positionals, rejecting unknown
 * options. `spec` maps each option to `'string'`, `'boolean'` or a full
 * `node:util` parseArgs option.
 */
export function cliOptions(spec, args = process.argv.slice(2)) {
  const options = Object.fromEntries(
    Object.entries(spec).map(([name, type]) => [name, typeof type === 'string' ? { type } : type]),
  );
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true });
  return { ...values, positionals };
}
