import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { App } from './App';

export function render(path: string) {
  return renderToString(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <App path={path} />
      </MotionConfig>
    </StrictMode>,
  );
}
