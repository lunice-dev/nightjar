import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/app.css';
import { startNavHistory } from './lib/navHistory';
import { startSwipeNav } from './lib/swipeNav';

startNavHistory();
startSwipeNav();

/**
 * Marks <html> with "safe-top" when the page really runs under the device's status bar (an installed iPhone/iPad app
 * with the translucent status bar), so the large player can reach the very top edge only there.
 */
function watchSafeTop() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
  document.body.appendChild(probe);
  const update = () => document.documentElement.classList.toggle('safe-top', (parseFloat(getComputedStyle(probe).paddingTop) || 0) > 0);
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
}
watchSafeTop();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
