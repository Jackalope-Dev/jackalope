import { applyThemeTokens, DEFAULT_THEME } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { normalizePath } from './content';
import { signupCampaign } from './WaitlistPreferences';
import '@jackalope/brand/fonts.css';
import './styles.css';
import './launch.css';
import './growth.css';
import './refinement.css';

applyThemeTokens({ ...DEFAULT_THEME, isDark: false, atmosphere: 18 });
signupCampaign();

const root = document.getElementById('root');
if (!root) throw new Error('Missing website root');
const application = (
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App path={normalizePath(window.location.pathname)} />
    </MotionConfig>
  </StrictMode>
);
if (root.hasChildNodes()) hydrateRoot(root, application);
else createRoot(root).render(application);
