import { applyThemeTokens } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { normalizePath } from './content';
import { readWebsiteTheme } from './theme';
import { signupCampaign } from './WaitlistPreferences';
import '@jackalope/brand/fonts.css';
import './styles.css';
import './launch.css';
import './growth.css';
import './refinement.css';
import './landing-story.css';

applyThemeTokens(readWebsiteTheme());
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
