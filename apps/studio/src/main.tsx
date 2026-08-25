import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/workbench.css';
import './styles/components.css';
import './styles/panels.css';
import './styles/drawers.css';
import './styles/overlays.css';
import './styles/responsive.css';
import './styles/canvas.css';
import './styles/canvas-inspector.css';
import './styles/canvas-media.css';
import './styles/characters.css';
import './styles/assets.css';
import './styles/modes.css';
import './styles/production.css';
import './styles/production-board.css';
import './styles/canvas-focus.css';
import './styles/scene-director.css';
import './styles/canvas-binding.css';
import './styles/canvas-batch-progress.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount point');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
