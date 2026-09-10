import { ArrowDown, ArrowUpRight, Play } from 'lucide-react';
import { useCallback, useState } from 'react';
import { featureMedia } from './feature-media';
import { knowledgeClips } from './knowledge-media';
import { setInitialVideoVolume } from './video-volume';
import './feature-media.css';

export function FeatureMedia({ path, dark }: { path: string; dark: boolean }) {
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const focusPlayer = useCallback((element: HTMLVideoElement | null) => element?.focus(), []);
  const media = featureMedia[path];
  if (!media) return null;
  const clip = knowledgeClips.find((item) => item.id === media.clip);
  const source = clip
    ? `/media/knowledge/${clip.id}.mp4`
    : `/media/${media.image}${dark ? '' : '-light'}.png`;
  return (
    <section
      id="feature-preview"
      className={`feature-preview${clip ? ' feature-preview-clip' : ''}`}
      aria-labelledby="feature-preview-title"
    >
      <div className="feature-preview-heading">
        <div>
          <p>Inside Jackalope</p>
          <h2 id="feature-preview-title">{media.title}</h2>
        </div>
        <span>{clip ? `${clip.seconds}s · silent demo` : 'Sample workspace'}</span>
      </div>
      <div className="feature-preview-grid">
        <figure>
          <div className="feature-preview-screen">
            {clip && !started ? (
              <button
                type="button"
                className="feature-preview-play"
                aria-label={`Play ${clip.seconds}-second demo: ${media.title}`}
                onClick={() => setStarted(true)}
              >
                <img src={`/media/knowledge/${clip.id}.jpg`} alt="" width={1280} height={720} />
                <span>
                  <Play size={18} fill="currentColor" aria-hidden="true" /> Play demo{' '}
                  <small>{clip.seconds}s</small>
                </span>
              </button>
            ) : clip ? (
              <video
                onLoadedMetadata={setInitialVideoVolume}
                controls
                playsInline
                autoPlay
                ref={focusPlayer}
                preload="none"
                poster={`/media/knowledge/${clip.id}.jpg`}
                width={1280}
                height={720}
                aria-labelledby="feature-preview-title"
                onError={() => setFailed(true)}
                src={source}
              >
                <track
                  kind="captions"
                  src={`/media/knowledge/${clip.id}.vtt`}
                  srcLang="en"
                  label="English"
                  default
                />
              </video>
            ) : (
              <a href={source} aria-label={`Open full-size screenshot: ${media.title}`}>
                <img
                  src={source}
                  alt={media.caption}
                  width={media.width ?? 1440}
                  height={media.height ?? 840}
                  decoding="async"
                />
              </a>
            )}
          </div>
          <figcaption>
            <p>{media.caption}</p>
            {failed && (
              <p role="status">
                The video couldn’t load. Read the walkthrough or open the video directly.
              </p>
            )}
            {clip && (
              <details>
                <summary>Read the walkthrough</summary>
                <p>{clip.transcript}</p>
              </details>
            )}
            <a className="feature-preview-source" href={source}>
              {clip ? 'Open video' : 'Open full-size screenshot'}{' '}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </figcaption>
        </figure>
        <nav className="feature-preview-steps" aria-label="Explore this workflow">
          {media.steps.map((step, index) => (
            <a href={`#section-${step.section}`} key={step.title}>
              <span className="feature-preview-number">0{index + 1}</span>
              <span>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </span>
              <ArrowDown size={16} aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>
    </section>
  );
}
