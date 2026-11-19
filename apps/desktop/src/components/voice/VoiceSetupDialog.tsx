import { describeError } from '@jackalope/contracts/errors';
import {
  Badge,
  Button,
  Choice,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  InlineNotice,
} from '@jackalope/ui';
import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  cancelVoiceDownload,
  downloadVoiceModel,
  formatSize,
  type VoiceDownloadProgress,
  type VoiceModels,
  voiceModels,
} from '../../lib/voice';
import { useSettingsStore } from '../../stores/settingsStore';
import { VoiceWave } from './VoiceWave';
import './voice.css';

type Phase = 'choose' | 'installing' | 'ready';

/**
 * First use of voice: pick a model, download it once, and start talking. Closing
 * during a download pauses it; installing again picks up where it stopped.
 */
export function VoiceSetupDialog({
  initialModel,
  onClose,
  onReady,
}: {
  /** Preselects a model, as Settings does for its Install buttons. */
  initialModel?: string;
  onClose: () => void;
  /** Offered once installed, to start recording straight away. */
  onReady?: () => void;
}) {
  const [catalog, setCatalog] = useState<VoiceModels | null>(null);
  const [chosen, setChosen] = useState(initialModel ?? '');
  const [phase, setPhase] = useState<Phase>('choose');
  const [progress, setProgress] = useState<VoiceDownloadProgress | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    voiceModels().then(
      (next) => {
        setCatalog(next);
        setChosen((current) => current || next.recommended);
      },
      (reason) => setError(describeError(reason)),
    );
  }, []);

  const model = catalog?.models.find((item) => item.id === chosen);
  const install = async () => {
    if (!model) return;
    setError('');
    if (model.installed) {
      useSettingsStore.getState().updateSettings({ voiceModel: model.id });
      setPhase('ready');
      return;
    }
    setPhase('installing');
    setProgress({
      id: model.id,
      received: model.partial,
      total: model.bytes,
      stage: 'downloading',
    });
    try {
      await downloadVoiceModel(model.id, setProgress);
      useSettingsStore.getState().updateSettings({ voiceModel: model.id });
      setPhase('ready');
    } catch (reason) {
      setError(describeError(reason));
      setPhase('choose');
      setCatalog(await voiceModels().catch(() => catalog));
    }
  };
  const close = () => {
    if (phase === 'installing' && model) void cancelVoiceDownload(model.id);
    onClose();
  };

  const fraction = progress?.total ? progress.received / progress.total : 0;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="voice-setup">
        <DialogHeader
          title={phase === 'ready' ? 'Voice is ready' : 'Talk instead of typing'}
          description={
            phase === 'ready'
              ? 'Click the mic, say what you need, then click again. Your words land where your cursor is, ready to edit.'
              : 'Jackalope turns speech into text on this computer with a Whisper model you download once. Recordings never leave your computer and are not saved.'
          }
        />
        <DialogCloseButton />
        <div className="voice-setup-body">
          {phase !== 'choose' && (
            <div className="voice-setup-stage">
              <VoiceWave
                progress={phase === 'ready' ? 1 : fraction}
                active={phase === 'installing'}
                settled={phase === 'ready'}
              />
              {phase === 'ready' ? (
                <p className="voice-setup-status" role="status">
                  <CheckCircle2 size={16} aria-hidden="true" /> {model?.label} is installed.
                </p>
              ) : (
                <p className="voice-setup-status" role="status" aria-live="polite">
                  {progress?.stage === 'verifying'
                    ? 'Checking the download…'
                    : `Downloading ${model?.label}: ${formatSize(progress?.received ?? 0)} of ${formatSize(model?.bytes ?? 0)}`}
                </p>
              )}
            </div>
          )}
          {phase === 'choose' && (
            <fieldset className="voice-setup-models">
              <legend>Model</legend>
              {catalog?.models.map((item) => (
                <Choice
                  key={item.id}
                  selected={item.id === chosen}
                  onClick={() => setChosen(item.id)}
                  title={
                    <span className="voice-setup-model-title">
                      {item.label}
                      <span className="voice-setup-size">{formatSize(item.bytes)}</span>
                      {item.id === catalog.recommended && <Badge>Recommended</Badge>}
                      {item.installed && <Badge>Installed</Badge>}
                      {!item.installed && item.partial > 0 && (
                        <Badge>{formatSize(item.partial)} downloaded</Badge>
                      )}
                    </span>
                  }
                  description={item.detail}
                />
              ))}
            </fieldset>
          )}
          {error && <InlineNotice tone="error">{error}</InlineNotice>}
        </div>
        <DialogFooter>
          {phase === 'choose' && (
            <>
              <DialogClose asChild>
                <Button variant="outline">Not now</Button>
              </DialogClose>
              <Button disabled={!model} onClick={() => void install()}>
                {!model
                  ? 'Install'
                  : model.installed
                    ? `Use ${model.label}`
                    : model.partial > 0
                      ? 'Resume download'
                      : `Install · ${formatSize(model.bytes)}`}
              </Button>
            </>
          )}
          {phase === 'installing' && (
            <Button variant="outline" onClick={close}>
              Pause download
            </Button>
          )}
          {phase === 'ready' && (
            <>
              <DialogClose asChild>
                <Button variant="outline">Done</Button>
              </DialogClose>
              {onReady && (
                <Button
                  onClick={() => {
                    onClose();
                    onReady();
                  }}
                >
                  Start talking
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
