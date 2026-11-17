import { AsciiMark } from '@jackalope/brand/ascii-mark';

/** The launch screen: the website's ASCII mark decoding while saved hosts load. */
export function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className="mobile-splash" data-leaving={leaving || undefined} aria-hidden="true">
      <AsciiMark className="mobile-splash-mark" echoes={3} interactive={false} />
      <span className="mobile-splash-name">Jackalope</span>
    </div>
  );
}
