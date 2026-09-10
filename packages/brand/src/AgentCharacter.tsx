import './agent-character.css';

const silhouettes: Record<string, string> = {
  codex:
    'M24 21V14H29V21H47V14H52V21C60 23 64 29 64 37V49C64 60 56 66 44 66H30C18 66 12 59 12 48V38C12 29 16 23 24 21Z',
  claude:
    'M38 10L44 24L57 17L54 32L68 35L57 44L64 57L49 56L45 70L36 58L24 67L23 52L8 51L19 40L11 28L27 29L27 14L38 23Z',
  grok: 'M38 17C52 17 62 27 62 41C62 55 52 65 38 65C24 65 14 55 14 41C14 27 24 17 38 17Z',
  antigravity: 'M10 62L28 19C32 9 43 9 48 19L65 62C48 55 27 55 10 62Z',
  opencode: 'M24 18H52L65 31V54L52 67H24L11 54V31Z',
};

export function AgentCharacter({
  provider,
  state = 'idle',
}: {
  provider: string;
  state?: 'idle' | 'working' | 'waiting';
}) {
  const silhouette = silhouettes[provider] ?? silhouettes.codex;
  return (
    <svg
      className="brand-agent-character"
      data-state={state}
      viewBox="0 0 88 88"
      fill="none"
      aria-hidden="true"
    >
      {[4, 3, 2, 1].map((layer) => (
        <path
          key={layer}
          d={silhouette}
          transform={`translate(${layer * 3} ${layer * 1.5})`}
          className="brand-agent-echo"
        />
      ))}
      <path d={silhouette} fill="currentColor" />
      {provider === 'grok' && <path d="M12 57C26 54 51 33 64 20" className="brand-agent-orbit" />}
      <g className="brand-agent-face" strokeLinecap="round" strokeWidth="3.5">
        <path d={state === 'working' ? 'M29 39h4m12 0h4' : 'M31 37v4m16-4v4'} />
        {state === 'waiting' && <path d="M45 30l5-2" strokeWidth="2" />}
      </g>
    </svg>
  );
}
