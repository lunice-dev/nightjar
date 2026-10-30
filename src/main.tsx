import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';
import { startNavHistory } from './lib/navHistory';
import { startSwipeNav } from './lib/swipeNav';
import { watchViewport } from './lib/viewport';

// The saved theme applies from the very first screen (the sign-in screen included), not only once the app itself has loaded.
try {
  const saved = localStorage.getItem('ssk-lite.theme');
  if (saved === 'light' || saved === 'dark' || saved === 'oled') document.documentElement.dataset.theme = saved;
  if (saved === 'oled') document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.dataset.original ??= m.content;
    m.content = '#000000';
  });
} catch {
  /* storage unavailable: the system's theme it is */
}

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
