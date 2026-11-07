/**
 * The environment without the repository a Git hook exported (GIT_DIR and its
 * relatives), so a command acts on its `cwd` rather than on the repository
 * whose hook launched the script. Without this, a script that builds a fixture
 * repository while running from a hook writes into the real one.
 */
export function gitEnvironment(base = process.env) {
  const env = { ...base };
  for (const key of Object.keys(env))
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|PREFIX)$/.test(key))
      delete env[key];
  return env;
}
