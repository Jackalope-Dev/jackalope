import { fileURLToPath } from 'node:url';

/** The repository root, with a trailing separator. */
export const root = fileURLToPath(new URL('../../', import.meta.url));
