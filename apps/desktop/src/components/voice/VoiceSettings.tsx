import { describeError } from '@jackalope/contracts/errors';
import { Badge, Button, InlineNotice } from '@jackalope/ui';
import { useCallback, useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { deleteVoiceModel, formatSize, type VoiceModels, voiceModels } from '../../lib/voice';
import { useSettingsStore } from '../../stores/settingsStore';
import { VoiceSetupDialog } from './VoiceSetupDialog';
import './voice.css';

/** Installed and available voice models, with which one dictation uses. */
export function VoiceSettings() {
  const current = useSettingsStore((state) => state.voiceModel);
  const [catalog, setCatalog] = useState<VoiceModels | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    if (!isTauriEnvironment()) return;
    voiceModels().then(setCatalog, (reason) => setError(describeError(reason)));
  }, []);
  useEffect(refresh, [refresh]);

  if (!isTauriEnvironment()) {
    return <p className="voice-settings-detail">Voice models are available in the desktop app.</p>;
  }
  return (
    <div className="voice-settings-models">
      {catalog?.models.map((model) => (
        <div
          key={model.id}
          className="voice-settings-model"
          data-current={model.id === current || undefined}
        >
          <div>
            <div className="voice-settings-model-name">
              {model.label}
              <span className="voice-setup-size">{formatSize(model.bytes)}</span>
              {model.id === current && model.installed && <Badge>In use</Badge>}
              {model.id === catalog.recommended && <Badge>Recommended</Badge>}
            </div>
            <p className="voice-settings-detail">{model.detail}</p>
          </div>
          <div className="voice-settings-model-actions">
            {model.installed ? (
              <>
                {model.id !== current && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      useSettingsStore.getState().updateSettings({ voiceModel: model.id })
                    }
                  >
                    Use
                  </Button>
                )}
                <Button
                  variant="outline"
                  aria-label={`Delete ${model.label} voice model`}
                  onClick={() => {
                    setError('');
                    deleteVoiceModel(model.id).then(
                      () => {
                        if (useSettingsStore.getState().voiceModel === model.id)
                          useSettingsStore.getState().updateSettings({ voiceModel: '' });
                        refresh();
                      },
                      (reason) => setError(describeError(reason)),
                    );
                  }}
                >
                  Delete
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setInstalling(model.id)}>
                {model.partial > 0 ? 'Resume download' : 'Install'}
              </Button>
            )}
          </div>
        </div>
      ))}
      {error && <InlineNotice tone="error">{error}</InlineNotice>}
      {installing && (
        <VoiceSetupDialog
          initialModel={installing}
          onClose={() => {
            setInstalling(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
