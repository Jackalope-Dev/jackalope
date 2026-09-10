import { useState } from 'react';
import { knowledgeClips, knowledgeScreenshots } from './knowledge-media';
import { setInitialVideoVolume } from './video-volume';

export function KnowledgeMedia({
  slug,
  section,
  dark,
}: {
  slug: string;
  section: string;
  dark: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const clip = knowledgeClips.find((item) => item.slug === slug && item.section === section);
  const shot = knowledgeScreenshots.find((item) => item.slug === slug && item.section === section);
  if (clip) {
    const base = `/media/knowledge/${clip.id}`;
    return (
      <figure className="knowledge-media">
        <div className="knowledge-media-heading">
          <strong id={`media-${clip.id}`}>{clip.title}</strong>
          <span>{clip.seconds}s · silent demo</span>
        </div>
        <video
          onLoadedMetadata={setInitialVideoVolume}
          controls
          playsInline
          preload="none"
          poster={`${base}.jpg`}
          width={1280}
          height={720}
          aria-labelledby={`media-${clip.id}`}
          onError={() => setFailed(true)}
          src={`${base}.mp4`}
        >
          <track kind="captions" src={`${base}.vtt`} srcLang="en" label="English" default />
        </video>
        <figcaption>
          <p>{clip.description} Recorded with sample data.</p>
          {failed && <p role="status">The video could not load. Read the walkthrough below.</p>}
          <details>
            <summary>Read the walkthrough</summary>
            <p>{clip.transcript}</p>
          </details>
          <a href={`${base}.mp4`}>Open video</a>
        </figcaption>
      </figure>
    );
  }
  if (shot) {
    const src = `/media/${shot.image}${dark ? '' : '-light'}.png`;
    return (
      <figure className="knowledge-media">
        <div className="knowledge-media-heading">
          <strong>{shot.title}</strong>
          <span>Sample workspace</span>
        </div>
        <a href={src} aria-label={`Open full-size screenshot: ${shot.title}`}>
          <img src={src} alt={shot.alt} loading="lazy" decoding="async" width={1440} height={840} />
        </a>
        <figcaption>
          <p>{shot.description}</p>
          <a href={src}>Open full-size screenshot</a>
        </figcaption>
      </figure>
    );
  }
  return null;
}
