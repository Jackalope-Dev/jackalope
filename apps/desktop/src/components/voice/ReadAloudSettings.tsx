import { Button, InlineNotice, Select, SelectItem, SettingRow } from '@jackalope/ui';
import { Square, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AUTOMATIC_VOICE,
  readAloud,
  savedVoice,
  saveVoice,
  speechSupported,
  stopReading,
  useReading,
  useSpeechVoices,
} from '../../lib/read-aloud';
import { bestVoice, isUsableVoice } from '../../lib/speech-text';

const SAMPLE = 'The task is finished. I updated the checkout test and all of the checks pass.';

/** Rows for Settings: which system voice reads replies aloud, with a sample. */
export function ReadAloudSettings() {
  const voices = useSpeechVoices();
  const [choice, setChoice] = useState(savedVoice);
  const [sample] = useState(() => Symbol('sample'));
  const playing = useReading(sample);
  useEffect(() => () => stopReading(sample), [sample]);
  if (!speechSupported()) return null;

  const language = (navigator.language || 'en-US').split('-')[0].toLowerCase();
  const options = voices
    .filter((voice) => isUsableVoice(voice) && voice.lang.toLowerCase().startsWith(language))
    .sort((a, b) => a.name.localeCompare(b.name));
  const automatic = bestVoice(voices);
  const voice =
    (choice !== AUTOMATIC_VOICE && voices.find((item) => item.voiceURI === choice)) || automatic;
  const mac = /Mac/i.test(navigator.platform);
  const premium = options.some((item) => /premium|enhanced/i.test(item.name));

  return (
    <>
      <SettingRow
        title="Voice"
        description="Used by Read aloud on replies. Voices come from this computer."
      >
        <div className="settings-field-stack">
          <Select
            aria-label="Read aloud voice"
            value={options.some((item) => item.voiceURI === choice) ? choice : AUTOMATIC_VOICE}
            onValueChange={(value) => {
              setChoice(value);
              saveVoice(value);
              if (playing) stopReading(sample);
            }}
          >
            <SelectItem value={AUTOMATIC_VOICE}>
              {automatic ? `Automatic (${automatic.name})` : 'Automatic'}
            </SelectItem>
            {options.map((item) => (
              <SelectItem key={item.voiceURI} value={item.voiceURI}>
                {item.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={playing}
            onClick={() => (playing ? stopReading(sample) : readAloud(sample, SAMPLE, voice))}
          >
            {playing ? (
              <Square size={12} aria-hidden="true" />
            ) : (
              <Volume2 size={14} aria-hidden="true" />
            )}
            {playing ? 'Stop' : 'Play a sample'}
          </Button>
        </div>
      </SettingRow>
      {mac && !premium && (
        <InlineNotice tone="info">
          For a smoother, more natural voice, download a Premium voice in System Settings →
          Accessibility → Spoken Content → System voice → Manage Voices, then choose it here.
        </InlineNotice>
      )}
    </>
  );
}
