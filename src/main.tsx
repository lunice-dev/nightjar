import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';
import { startNavHistory } from './lib/navHistory';
import { startSwipeNav } from './lib/swipeNav';
import { watchViewport } from './lib/viewport';

startNavHistory();
startSwipeNav();
watchViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
