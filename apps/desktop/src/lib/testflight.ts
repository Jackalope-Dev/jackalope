/** The app a task's Xcode project builds, as the upload would send it. */
export interface TestflightInfo {
  container: string;
  scheme: string;
  appName: string;
  bundleId: string;
  version: string;
  build: string;
  suggestedBuild: string;
  /** The newest build number App Store Connect has for this app, when it could be read. */
  latestUploaded: string | null;
  /** Why App Store Connect was not read, or what it said. */
  remoteNote: string | null;
  developmentTeam: string | null;
  /** Why this project cannot be uploaded; no upload is offered while set. */
  blocked: string | null;
}

export type UploadPhase = 'archiving' | 'exporting' | 'processing' | 'done' | 'failed' | 'canceled';

export interface UploadState {
  runId: string;
  phase: UploadPhase;
  appName: string;
  bundleId: string;
  version: string;
  build: string;
  startedAt: string;
  finishedAt: string | null;
  /** The newest lines of the xcodebuild output. */
  log: string[];
  error: string | null;
  /** App Store Connect's processing state, described. */
  processing: string | null;
  logPath: string;
}

export const PHASE_LABELS: Record<UploadPhase, string> = {
  archiving: 'Archiving',
  exporting: 'Uploading',
  processing: 'Processing on App Store Connect',
  done: 'Uploaded',
  failed: 'Failed',
  canceled: 'Canceled',
};

export const isUploading = (upload: Pick<UploadState, 'phase'> | null | undefined) =>
  upload?.phase === 'archiving' || upload?.phase === 'exporting' || upload?.phase === 'processing';

/** The action the person confirms, naming exactly what is sent. */
export const uploadLabel = (app: Pick<TestflightInfo, 'appName' | 'version' | 'build'>) =>
  `Upload ${app.appName} ${app.version} (${app.build}) to TestFlight`;

/** Compares build numbers of up to three dot-separated integers, as App Store Connect does. */
export function compareBuilds(a: string, b: string) {
  const parts = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

/** Whether the project's build number must rise before App Store Connect accepts it. */
export const needsNewBuild = (info: Pick<TestflightInfo, 'build' | 'latestUploaded'>) =>
  !!info.latestUploaded && compareBuilds(info.build, info.latestUploaded) <= 0;

export const BUILD_PATTERN = /^\d+(\.\d+){0,2}$/;

/** What an agent preparing a TestFlight upload checks and reports; it never uploads. */
export const TESTFLIGHT_PREPARATION = `For TestFlight, check and fix in the workspace where you can: signing settings (development team, automatic signing, and a bundle identifier that matches the app in App Store Connect); MARKETING_VERSION and CURRENT_PROJECT_VERSION, where the build number must be higher than the last uploaded build; the privacy manifest PrivacyInfo.xcprivacy, including required-reason API declarations for the APIs the app and its dependencies use; an Info.plist usage-description string for every protected API the app uses; app icons and the launch screen. Never archive, export or upload the app, and never ask for the App Store Connect API key. For anything only the person can do in Xcode, on the Apple Developer site or in App Store Connect, use request_human_action with kind "signing". Finish with exactly what the person must do before uploading with Jackalope's Upload to TestFlight.`;

/** The delivery goal an agent prepares for TestFlight with. */
export const TESTFLIGHT_GOAL = 'a TestFlight upload';
