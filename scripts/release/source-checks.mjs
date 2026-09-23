export const requiredChecks = [
  'verify',
  'dependencies',
  'secrets',
  'codeql',
  'workflows',
  'Verify ubuntu-22.04',
  'Verify ubuntu-24.04',
  'Verify macos-15',
  'Verify macos-15-intel',
];

export async function waitForSourceChecks(
  read,
  { attempts = 80, pause = () => new Promise((resolve) => setTimeout(resolve, 15000)) } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const checks = await read();
    const pending = [];
    for (const name of requiredChecks) {
      const check = checks
        .filter((item) => item.name === name && item.app?.slug === 'github-actions')
        .sort((a, b) => b.id - a.id)[0];
      if (check?.conclusion === 'success') continue;
      if (check?.status === 'completed')
        throw new Error(`Required source check failed: ${name} (${check.conclusion})`);
      pending.push(name);
    }
    if (!pending.length) return;
    if (attempt === attempts - 1)
      throw new Error(
        `Source checks are not ready: ${pending.join(', ')}. Retry only publication after CI completes.`,
      );
    await pause();
  }
}
