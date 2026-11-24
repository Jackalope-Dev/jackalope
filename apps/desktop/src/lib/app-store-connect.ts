import { invokeNative } from './native/transport.ts';
import type { TestflightInfo, UploadState } from './testflight.ts';

/** A project's App Store Connect API key and app details. The key itself never returns to the app. */
export interface AppStoreConnection {
  issuerId: string;
  keyId: string;
  keyFileName: string | null;
  developmentTeam: string;
  bundleId: string | null;
  scheme: string | null;
  exportMethod: string | null;
  updatedAt: string;
  validatedAt: string | null;
}

/** What is saved. `key` is the .p8 text; null keeps the saved key and is refused the first time. */
export interface AppStoreConnectionInput {
  issuerId: string;
  keyId: string;
  key: string | null;
  keyFileName: string | null;
  developmentTeam: string;
  bundleId: string | null;
  scheme: string | null;
  exportMethod: string | null;
}

export interface TestflightAvailability {
  /** The Xcode project or workspace found in the task's workspace. */
  xcodeProject: string | null;
  connection: boolean;
  upload: UploadState | null;
}

export const appStoreConnection = (projectId: string) =>
  invokeNative<AppStoreConnection | null>('app_store_connect_status', { projectId });

export const saveAppStoreConnection = (projectId: string, connection: AppStoreConnectionInput) =>
  invokeNative<AppStoreConnection>('app_store_connect_save', { projectId, connection });

export const removeAppStoreConnection = (projectId: string) =>
  invokeNative<null>('app_store_connect_remove', { projectId });

/** Signs in to App Store Connect with the saved key; rejects with Apple's own error. */
export const validateAppStoreConnection = (projectId: string) =>
  invokeNative<{ summary: string; connection: AppStoreConnection }>('app_store_connect_validate', {
    projectId,
  });

export const testflightAvailability = (id: string) =>
  invokeNative<TestflightAvailability>('task_testflight_available', { id });

/** Reads the app's identity and version from the task's Xcode project. Takes seconds. */
export const testflightInfo = (id: string) =>
  invokeNative<TestflightInfo>('task_testflight_info', { id });

/** Changes the build number in the task's workspace, where it shows in review. */
export const setTestflightBuild = (id: string, build: string) =>
  invokeNative<TestflightInfo>('task_testflight_set_build', { id, build });

/** Starts the upload the person confirmed; refused when the project no longer matches it. */
export const startTestflightUpload = (
  id: string,
  confirmed: { bundleId: string; version: string; build: string },
) => invokeNative<UploadState>('task_testflight_upload', { id, ...confirmed });

export const testflightStatus = (id: string) =>
  invokeNative<UploadState | null>('task_testflight_status', { id });

export const cancelTestflightUpload = (id: string) =>
  invokeNative<UploadState | null>('task_testflight_cancel', { id });
