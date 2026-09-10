import { Play } from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { setInitialVideoVolume } from './video-volume';

export function WorkspaceClip({
  scene,
  dark,
}: {
  scene: { id: string; label: string; walkthrough: string };
  dark: boolean;
}) {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const descriptionId = useId();
  const focusPlayer = useCallback((element: HTMLVideoElement | null) => element?.focus(), []);
  const source = `/media/workspace/${scene.id}${dark ? '' : '-light'}`;
  return (
    <div className="product-capture">
      <span id={descriptionId} className="sr-only">
        Silent demo with fictional Atlas project data. {scene.walkthrough}
      </span>
      {started ? (
        <video
          onLoadedMetadata={setInitialVideoVolume}
          ref={focusPlayer}
          controls
          playsInline
          autoPlay
          preload="none"
          width={1440}
          height={840}
          poster={`${source}.jpg`}
          src={`${source}.mp4`}
          aria-label={`${scene.label} demo`}
          aria-describedby={descriptionId}
          tabIndex={failed ? -1 : 0}
          aria-hidden={failed || undefined}
          onError={() => setFailed(true)}
        >
          <track kind="captions" src={`${source}.vtt`} srcLang="en" label="English" default />
        </video>
      ) : (
        <button
          type="button"
          onClick={() => setStarted(true)}
          aria-label={`Play ${scene.label.toLowerCase()} demo`}
          aria-describedby={descriptionId}
        >
          <img
            src={`${source}.jpg`}
            width={1440}
            height={840}
            loading="lazy"
            alt={`Jackalope ${scene.label.toLowerCase()} with sample project data`}
          />
          <span className="capture-play">
            <Play size={15} fill="currentColor" aria-hidden="true" />
            See it in motion
          </span>
        </button>
      )}
      {failed && (
        <div className="capture-error" role="status">
          <p>This demo couldn’t load.</p>
          <a href={`${source}.mp4`}>Open video directly</a>
        </div>
      )}
    </div>
  );
}
