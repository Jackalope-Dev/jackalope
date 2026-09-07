import { applyThemeTokens, PRESET_THEMES } from '@jackalope/brand/theme';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';
import { normalizePath } from './content';
import '@jackalope/brand/fonts.css';
import './styles.css';
import './launch.css';

applyThemeTokens({ ...PRESET_THEMES[0], isDark: false, atmosphere: 18 });

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
