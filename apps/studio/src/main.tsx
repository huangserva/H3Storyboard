import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/tokens.css';
import './styles/base.css';
import './styles/workbench.css';
import './styles/components.css';
import './styles/panels.css';
import './styles/drawers.css';
import './styles/overlays.css';
import './styles/responsive.css';
import './styles/canvas.css';
import './styles/characters.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root mount point');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
