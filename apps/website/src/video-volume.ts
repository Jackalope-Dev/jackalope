import type { SyntheticEvent } from 'react';

export function setInitialVideoVolume(event: SyntheticEvent<HTMLVideoElement>) {
  event.currentTarget.volume = 0.25;
}
