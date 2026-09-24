import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { recordingWave } from '../../lib/dictation';
import { nativeTask } from '../../lib/task-runtime';
import { isTauriEnvironment } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

export function DictationButton({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const endpoint = useSettingsStore((state) => state.dictationEndpoint);
  const model = useSettingsStore((state) => state.dictationModel);
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const canceled = useRef(false);
  const recording = useRef(false);
  const receiveText = useRef(onText);
  receiveText.current = onText;
  useEffect(
    () => () => {
      canceled.current = true;
      clearTimeout(timer.current);
      const current = recorder.current;
      if (current?.state === 'recording') current.stop();
      current?.stream.getTracks().forEach((track) => {
        track.stop();
      });
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    },
    [],
  );
  if (!endpoint || !isTauriEnvironment()) return null;
  const start = async () => {
    if (recording.current) return;
    recording.current = true;
    canceled.current = false;
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      if (canceled.current) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      const media = new MediaRecorder(stream);
      recorder.current = media;
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      media.onstop = () => {
        clearTimeout(timer.current);
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        if (canceled.current) return;
        setState('processing');
        void recordingWave(new Blob(chunks, { type: media.mimeType }))
          .then((bytes) =>
            canceled.current
              ? null
              : nativeTask<string>('desktop_transcribe', {
                  endpoint,
                  model,
                  audio: Array.from(bytes),
                }),
          )
          .then((text) => {
            if (!canceled.current && text) receiveText.current(text);
          })
          .catch((reason) => {
            if (!canceled.current) setError(String(reason));
          })
          .finally(() => {
            recording.current = false;
            if (!canceled.current) setState('idle');
          });
      };
      media.onerror = () => {
        canceled.current = true;
        recording.current = false;
        clearTimeout(timer.current);
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        setState('idle');
        setError('Microphone recording failed. Check system permissions and try again.');
        if (media.state === 'recording') media.stop();
      };
      media.start();
      setState('recording');
      timer.current = setTimeout(() => {
        if (media.state === 'recording') media.stop();
      }, 59_000);
    } catch (reason) {
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
      recording.current = false;
      if (!canceled.current) {
        setError(String(reason));
        setState('idle');
      }
    }
  };
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={disabled || state === 'processing'}
        aria-pressed={state === 'recording'}
        onClick={() => (state === 'recording' ? recorder.current?.stop() : void start())}
      >
        {state === 'recording' ? <Square size={16} /> : <Mic size={16} />}
        {state === 'recording'
          ? 'Stop dictation'
          : state === 'processing'
            ? 'Transcribing locally…'
            : 'Dictate'}
      </Button>
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
    </>
  );
}
