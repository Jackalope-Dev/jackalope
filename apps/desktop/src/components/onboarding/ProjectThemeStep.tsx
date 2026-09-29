import type { ThemePalette } from '@jackalope/brand/theme';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';
import { Switch } from '../ui/Switch';

export function ProjectThemeStep({
  initialTheme,
  appTheme,
  busy,
  onPreview,
  onBack,
  onContinue,
}: {
  initialTheme?: ThemePalette;
  appTheme: ThemePalette;
  busy: boolean;
  onPreview: (theme: ThemePalette) => void;
  onBack: () => void;
  onContinue: (theme: ThemePalette | undefined) => void;
}) {
  const [changed, setChanged] = useState(false);
  const [draft, setDraft] = useState(initialTheme ?? appTheme);
  const showThemePicker = useSettingsStore((state) => state.showThemePickerInToolbar);
  return (
    <>
      <fieldset disabled={busy} className="onboarding-theme-editor">
        <ThemeEditor
          value={draft}
          onChange={(theme) => {
            if (busy) return;
            setDraft(theme);
            setChanged(true);
            onPreview(theme);
          }}
        />
      </fieldset>
      <div className="flex items-center justify-between gap-4 mt-5">
        <span>Theme picker in the top bar</span>
        <Switch
          label="Show theme picker in top bar"
          checked={showThemePicker}
          disabled={busy}
          onCheckedChange={(checked) =>
            useSettingsStore.getState().updateSettings({ showThemePickerInToolbar: checked })
          }
        />
      </div>
      <div className="onboarding-actions">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button disabled={busy} onClick={() => onContinue(changed ? draft : initialTheme)}>
          Continue
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}
