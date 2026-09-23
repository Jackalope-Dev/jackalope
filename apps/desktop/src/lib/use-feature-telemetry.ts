import { useEffect, useRef } from 'react';
import { telemetry, useCommunityStore } from '../stores/communityStore';
import type { Feature } from './telemetry';

export function useFeatureTelemetry(feature: Feature | undefined) {
  const enabled = useCommunityStore(
    (state) => !!state.settings?.configured && state.settings.reviewed && state.settings.telemetry,
  );
  const previous = useRef<Feature | undefined>(undefined);
  useEffect(() => {
    if (!enabled) {
      previous.current = undefined;
      return;
    }
    if (feature && feature !== previous.current) telemetry.track({ name: 'feature_used', feature });
    previous.current = feature;
  }, [enabled, feature]);
}
