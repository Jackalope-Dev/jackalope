import { describeError } from '@jackalope/contracts/errors';
import { IconButton } from '@jackalope/ui';
import { Loader2, Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { recordingWave } from '../../lib/dictation';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { transcribeLocally, voiceModels } from '../../lib/voice';
import { useSettingsStore } from '../../stores/settingsStore';
import { ActionError } from '../ui/ActionError';
import { VoiceSetupDialog } from './VoiceSetupDialog';
import './voice.css';
import { trackAction } from '../../lib/usage-events';

const LIMIT_MS = 59_000;

/**
 * The composer mic. It records only while on, then transcribes with the installed
 * voice model, or with the custom local server from Settings when no model is set.
 * With neither, it offers to install a model first. Escape discards a recording.
 */
export function VoiceButton({
  onText,
  disabled,
  onRecordingChange,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
  /** Recording started or stopped. While recording, the enclosing `[data-composer]`
   * form also carries the live `--voice-level` (0 to 1). */
  onRecordingChange?: (recording: boolean) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'processing'>('idle');
  const [setup, setSetup] = useState(false);
  const [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const discard = useRef(false);
  const stopMeter = useRef<() => void>(() => {});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const receiveText = useRef(onText);
  receiveText.current = onText;
  const reportRecording = useRef(onRecordingChange);
  reportRecording.current = onRecordingChange;
  const recording = state === 'recording';
  useEffect(() => {
    if (!recording) return;
    reportRecording.current?.(true);
    return () => reportRecording.current?.(false);
  }, [recording]);

  useEffect(
    () => () => {
      discard.current = true;
      clearTimeout(timer.current);
      stopMeter.current();
      const current = recorder.current;
      if (current?.state === 'recording') current.stop();
      current?.stream.getTracks().forEach((track) => {
        track.stop();
      });
    },
    [],
  );
  if (!isTauriEnvironment()) return null;

  // Settings are read when used, so a model installed from the setup dialog applies at once.
  const transcribe = (wave: Uint8Array) => {
    const settings = useSettingsStore.getState();
    return settings.voiceModel
      ? transcribeLocally(settings.voiceModel, wave)
      : invokeNative<string>('desktop_transcribe', {
          endpoint: settings.dictationEndpoint,
          model: settings.dictationModel,
          audio: Array.from(wave),
        });
  };

  /** Drives the button's level bars from the microphone, without re-rendering. */
  const meter = (stream: MediaStream) => {
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const composer = button.current?.closest<HTMLElement>('[data-composer]');
    let frame = 0;
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 6).toFixed(3);
      button.current?.style.setProperty('--voice-level', level);
      composer?.style.setProperty('--voice-level', level);
      frame = requestAnimationFrame(tick);
    };
    tick();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      composer?.style.removeProperty('--voice-level');
      void context.close();
    };
  };

  const start = async () => {
    setError('');
    const { voiceModel, dictationEndpoint } = useSettingsStore.getState();
    if (voiceModel) {
      const installed = await voiceModels()
        .then((list) => list.models.some((item) => item.id === voiceModel && item.installed))
        .catch(() => true);
      if (!installed) {
        useSettingsStore.getState().updateSettings({ voiceModel: '' });
        setSetup(true);
        return;
      }
    } else if (!dictationEndpoint.trim()) {
      setSetup(true);
      return;
    }
    discard.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (reason) {
      setError(
        `Jackalope could not use the microphone (${describeError(reason)}). Check microphone access in your system settings.`,
      );
      return;
    }
    const media = new MediaRecorder(stream);
    recorder.current = media;
    trackAction('voice_dictation');
    stopMeter.current = meter(stream);
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      clearTimeout(timer.current);
      stopMeter.current();
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      if (discard.current) {
        setState('idle');
        return;
      }
      setState('processing');
      void recordingWave(new Blob(chunks, { type: media.mimeType }))
        .then((wave) => (discard.current ? '' : transcribe(wave)))
        .then((text) => {
          if (!discard.current && text) receiveText.current(text);
        })
        .catch((reason) => {
          if (!discard.current) setError(describeError(reason));
        })
        .finally(() => {
          if (!discard.current) setState('idle');
        });
    };
    media.onerror = () => {
      discard.current = true;
      if (media.state === 'recording') media.stop();
      setError('Microphone recording failed. Check microphone access and try again.');
    };
    media.start();
    setState('recording');
    timer.current = setTimeout(() => {
      if (media.state === 'recording') media.stop();
    }, LIMIT_MS);
  };
  const stop = (keep: boolean) => {
    discard.current = !keep;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  const label =
    state === 'recording'
      ? 'Stop and transcribe'
      : state === 'processing'
        ? 'Transcribing…'
        : 'Dictate';
  return (
    <>
      <IconButton
        ref={button}
        type="button"
        variant="ghost"
        className="voice-button"
        data-state={state}
        label={label}
        title={state === 'idle' ? 'Dictate (speech to text)' : label}
        aria-pressed={state === 'recording'}
        disabled={disabled || state === 'processing'}
        onClick={() => (state === 'recording' ? stop(true) : void start())}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && state === 'recording') {
            event.preventDefault();
            stop(false);
          }
        }}
      >
        {state === 'recording' ? (
          <>
            <span className="voice-level" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </span>
            <Square size={12} aria-hidden="true" />
          </>
        ) : state === 'processing' ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : (
          <Mic size={16} aria-hidden="true" />
        )}
      </IconButton>
      <ActionError error={error} />
      {setup && <VoiceSetupDialog onClose={() => setSetup(false)} onReady={() => void start()} />}
    </>
  );
}
