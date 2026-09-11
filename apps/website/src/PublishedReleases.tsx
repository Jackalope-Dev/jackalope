import { Button } from '@jackalope/ui';
import { useEffect, useState } from 'react';

const service = 'https://api.jackalope.dev';
type Release = { version: string; date: string; notes: string };

function Notes({ text }: { text: string }) {
  return text.split(/\r?\n\r?\n/).map((block, index) => {
    const key = `${index}-${block.slice(0, 30)}`;
    if (/^#{1,3} /.test(block)) return <h3 key={key}>{block.replace(/^#{1,3} /, '')}</h3>;
    if (block.split(/\r?\n/).every((line) => /^[-*] /.test(line))) {
      return (
        <ul key={key}>
          {block.split(/\r?\n/).map((line) => (
            <li key={line}>{line.slice(2)}</li>
          ))}
        </ul>
      );
    }
    return <p key={key}>{block}</p>;
  });
}

export function PublishedReleases() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let active = true;
    setError(false);
    void fetch(`${service}/updates/stable/releases.json`, {
      signal: controller.signal,
      cache: attempt ? 'reload' : 'default',
    })
      .then(async (response) => {
        if (response.status === 404) return [];
        if (!response.ok) throw new Error('Release history is unavailable');
        const text = await response.text();
        if (text.length > 3000000) throw new Error('Release history is too large');
        const data: unknown = JSON.parse(text);
        if (
          !Array.isArray(data) ||
          data.length > 100 ||
          !data.every(
            (item) =>
              typeof item?.version === 'string' &&
              /^\d+\.\d+\.\d+$/.test(item.version) &&
              typeof item.date === 'string' &&
              Number.isFinite(Date.parse(item.date)) &&
              typeof item.notes === 'string' &&
              item.notes.length <= 24000,
          )
        )
          throw new Error('Invalid release history');
        return data as Release[];
      })
      .then((data) => {
        if (active) setReleases(data);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);
  if (error)
    return (
      <p className="release-status" role="status">
        Release history is temporarily unavailable.{' '}
        <Button
          variant="ghost"
          type="button"
          className="text-link"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </Button>
      </p>
    );
  if (!releases.length) return null;
  return (
    <section aria-label="Published releases">
      <div className="journal-section-heading">
        <h2>What’s new in Jackalope</h2>
        <a className="text-link" href={`${service}/updates/stable/feed.xml`}>
          Subscribe with RSS
        </a>
      </div>
      {releases.map((release) => (
        <article key={release.version} id={`v${release.version}`} className="change-entry">
          <div className="change-date">
            <time dateTime={release.date}>
              {new Date(release.date).toLocaleDateString('en', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </time>
            <span>Released</span>
          </div>
          <div>
            <h2>
              <a href={`#v${release.version}`}>Jackalope {release.version}</a>
            </h2>
            <Notes text={release.notes} />
          </div>
        </article>
      ))}
    </section>
  );
}
