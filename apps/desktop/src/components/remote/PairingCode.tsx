import { CopyButton, Disclosure, DisclosureBody, DisclosureSummary } from '@jackalope/ui';
import { useEffect, useState } from 'react';

/** A pairing code as the host creates it, for this computer's Remote access or an invite. */
export interface PairingCode {
  /** The short code for typing, grouped as ABCDE-FGHJK. */
  code: string;
  link: string | null;
  /** The link as QR rows, '1' for a dark module; present when there is a link. */
  qr: string[] | null;
  expiresIn: number;
}

/** Scannable from the companion app. Always dark on white so phone cameras read it in any theme. */
function PairingQr({ rows }: { rows: string[] }) {
  const size = rows.length + 8;
  const path = rows
    .flatMap((row, y) =>
      [...row].flatMap((module, x) => (module === '1' ? [`M${x + 4} ${y + 4}h1v1h-1z`] : [])),
    )
    .join('');
  return (
    <svg
      className="remote-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for the pairing link"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
/** The typed code, large enough to read across a desk, with copy and the address. */
function TypedCode({ pair, origin }: { pair: PairingCode; origin: string }) {
  return (
    <div className="remote-pair-code">
      <output className="remote-code" aria-label={`Pairing code ${[...pair.code].join(' ')}`}>
        {pair.code}
      </output>
      {origin && (
        <p className="task-muted">
          Address: <span className="font-mono">{origin}</span>
        </p>
      )}
      <div className="remote-toolbar">
        <CopyButton size="sm" variant="outline" text={pair.code} label="Copy code" />
        {pair.link && (
          <CopyButton size="sm" variant="outline" text={pair.link} label="Copy phone link" />
        )}
      </div>
    </div>
  );
}
/**
 * A new pairing: the QR code to scan with the phone app, with the typed code folded away
 * for when the camera can't be used. Without an HTTPS address there is no QR code, and the
 * typed code is for connecting another computer over SSH.
 */
export function PairingView({
  pair,
  expires,
  origin,
  scanHint = 'Scan this with the Jackalope app on your phone.',
}: {
  pair: PairingCode;
  expires: number;
  origin: string;
  scanHint?: string;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const left = Math.max(0, Math.ceil((expires - now) / 1000));
  const remaining = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  if (!pair.qr)
    return (
      <div className="remote-pair px-5 py-4">
        <TypedCode pair={pair} origin={origin} />
        <p className="task-muted">
          Enter it where you connect this computer. It works once and expires in {remaining}.
        </p>
      </div>
    );
  return (
    <div className="remote-pair remote-pair-hero px-5 py-4">
      <PairingQr rows={pair.qr} />
      <p>{scanHint}</p>
      <p className="task-muted">Works once · expires in {remaining}</p>
      <Disclosure className="remote-pair-manual">
        <DisclosureSummary>Can't scan? Enter a code</DisclosureSummary>
        <DisclosureBody>
          <TypedCode pair={pair} origin={origin} />
        </DisclosureBody>
      </Disclosure>
    </div>
  );
}
