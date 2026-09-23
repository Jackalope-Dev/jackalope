import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const registry = JSON.parse(
  readFileSync(
    new URL('../../apps/desktop/src-tauri/src/commands/experiments.json', import.meta.url),
    'utf8',
  ),
);
export const registrySha256 = createHash('sha256').update(JSON.stringify(registry)).digest('hex');

export function validateExperiments(options) {
  for (const name of Object.keys(options)) {
    if (!Object.hasOwn(registry.fields, name)) throw new Error(`Unknown experiment: ${name}.`);
  }
  for (const [name, field] of Object.entries(registry.fields)) {
    const value = options[name] ?? field.default;
    if (!field.values.includes(value)) throw new Error(`Invalid ${name}.`);
    for (const [dependency, required] of Object.entries(field.requires?.[value] ?? {})) {
      if ((options[dependency] ?? registry.fields[dependency].default) !== required)
        throw new Error(`${name}=${value} requires ${dependency}=${required}.`);
    }
  }
}

export function experimentOptions(args, variants) {
  const fields = registry.fields;
  for (const variant of variants) {
    const seen = new Set();
    for (const arg of args.filter((arg) => arg.startsWith(`--${variant}-`))) {
      if (arg.startsWith('--control-prompts=')) continue;
      const name = arg.slice(variant.length + 3).split('=')[0];
      if (!Object.hasOwn(fields, name) && !['model', 'effort', 'codex-speed'].includes(name))
        throw new Error(`Unknown ${variant} experiment: ${name}.`);
      if (seen.has(name)) throw new Error(`Duplicate ${variant} option: ${name}.`);
      seen.add(name);
    }
  }
  return Object.fromEntries(
    variants.map((variant) => [
      variant,
      Object.fromEntries(
        Object.entries(fields).map(([name, field]) => {
          const value =
            args
              .find((arg) => arg.startsWith(`--${variant}-${name}=`))
              ?.split('=')
              .slice(1)
              .join('=') ?? field.default;
          if (!field.values.includes(value)) throw new Error(`Invalid ${variant} ${name}.`);
          return [name, value];
        }),
      ),
    ]),
  );
}

export function experimentEnvironment(options) {
  validateExperiments(options);
  return Object.fromEntries(
    Object.entries(registry.fields)
      .filter(([, field]) => field.environment)
      .map(([name, field]) => [field.environment, options[name] ?? field.default]),
  );
}

export function variantOrder(variants, id, repetition, seed) {
  const initial =
    seed === null ? 0 : createHash('sha256').update(`${seed}:${id}`).digest().readUInt32LE(0);
  const offset = (initial + repetition - 1) % variants.length;
  return [...variants.slice(offset), ...variants.slice(0, offset)];
}
