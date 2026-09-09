import type { ThemePalette } from '@jackalope/brand/theme';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { ThemeEditor } from '../theme/ThemeEditor';
import { Button } from '../ui/button';

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
  const [inherit, setInherit] = useState(!initialTheme);
  const [draft, setDraft] = useState(initialTheme ?? appTheme);
  return (
    <>
      <fieldset disabled={busy} className="onboarding-theme-editor">
        <label className="onboarding-theme-inherit">
          <input
            type="checkbox"
            checked={inherit}
            onChange={(event) => {
              setInherit(event.target.checked);
              onPreview(event.target.checked ? appTheme : draft);
            }}
          />
          Use app theme
        </label>
        <ThemeEditor
          value={inherit ? appTheme : draft}
          onChange={(theme) => {
            if (busy) return;
            setDraft(theme);
            setInherit(false);
            onPreview(theme);
          }}
        />
      </fieldset>
      <div className="onboarding-actions">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          <ArrowLeft size={16} />
          Back
        </Button>
        <Button disabled={busy} onClick={() => onContinue(inherit ? undefined : draft)}>
          Continue
          <ArrowRight size={16} />
        </Button>
      </div>
    </>
  );
}
