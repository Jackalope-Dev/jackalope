import { platformDownloads } from './platform-downloads';

export const desktopDownloads = platformDownloads(import.meta.env);
export const downloadsAvailable = desktopDownloads.some((platform) => platform.url);
