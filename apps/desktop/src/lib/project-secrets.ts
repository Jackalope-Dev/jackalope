import { invokeNative } from './native/transport.ts';

/** Where agents receive a project secret. */
export type SecretAvailability = 'both' | 'local' | 'computers';

/** A saved project secret. Its value never reaches the app after it is saved. */
export interface ProjectSecret {
  name: string;
  availableTo: SecretAvailability;
  updatedAt: string;
}

export const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;
export const SECRET_VALUE_MAX_CHARS = 16_000;

export const projectSecrets = (projectId: string) =>
  invokeNative<ProjectSecret[]>('project_secrets', { projectId });

/** Saves a value and availability, or only the availability when `value` is null. */
export const setProjectSecret = (
  projectId: string,
  name: string,
  value: string | null,
  availableTo: SecretAvailability,
) => invokeNative<ProjectSecret[]>('project_secret_set', { projectId, name, value, availableTo });

export const removeProjectSecret = (projectId: string, name: string) =>
  invokeNative<ProjectSecret[]>('project_secret_remove', { projectId, name });
