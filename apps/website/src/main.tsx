import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyThemeTokens, PRESET_THEMES } from '../../desktop/src/lib/theme-engine';
import { App } from './App';
import './styles.css';

applyThemeTokens({ ...PRESET_THEMES[0], isDark: false, atmosphere: 18 });

const root = document.getElementById('root');
if (!root) throw new Error('Missing website root');
createRoot(root).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </StrictMode>,
);
